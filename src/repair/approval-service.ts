import crypto from 'node:crypto';
import fs from 'node:fs';

export interface ApprovalTokenPayload {
  tokenId: string;
  proposalId: string;
  patchHash: string;
  targetFilePath: string;
  originalSourceHash: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface TokenValidationResult {
  isValid: boolean;
  reason?: string;
  payload?: ApprovalTokenPayload;
}

/**
 * Centralized cryptographic approval service for all source modifications.
 * Guarantees that no repair can be applied without an explicit, unexpired,
 * one-time approval token bound to the exact file content hash and patch hash.
 */
export class ApprovalService {
  private static instance: ApprovalService | undefined;
  private tokens = new Map<string, ApprovalTokenPayload>();
  private readonly defaultTtlMs = 10 * 60 * 1000; // 10 minutes

  public static getInstance(): ApprovalService {
    if (!ApprovalService.instance) {
      ApprovalService.instance = new ApprovalService();
    }
    return ApprovalService.instance;
  }

  /**
   * Computes SHA-256 hash of a string.
   */
  public static hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Generates a one-time cryptographic approval token for an approved repair proposal.
   */
  public generateToken(params: {
    proposalId: string;
    patchHash: string;
    targetFilePath: string;
    originalSourceHash: string;
    ttlMs?: number;
  }): ApprovalTokenPayload {
    // Canonicalize path if possible
    let canonicalPath = params.targetFilePath;
    try {
      if (fs.existsSync(params.targetFilePath)) {
        canonicalPath = fs.realpathSync(params.targetFilePath);
      }
    } catch {
      // Use original path if realpath fails
    }

    const tokenId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;

    const payload: ApprovalTokenPayload = {
      tokenId,
      proposalId: params.proposalId,
      patchHash: params.patchHash,
      targetFilePath: canonicalPath,
      originalSourceHash: params.originalSourceHash,
      issuedAt: now,
      expiresAt: now + ttl,
      used: false,
    };

    this.tokens.set(tokenId, payload);
    return payload;
  }

  /**
   * Verifies an approval token against the current file state and patch hash,
   * then marks it as used (one-time consumption).
   */
  public verifyAndConsumeToken(params: {
    tokenId: string;
    targetFilePath: string;
    currentSourceContent: string;
    patchHash: string;
  }): TokenValidationResult {
    this.cleanupExpiredTokens();

    const payload = this.tokens.get(params.tokenId);
    if (!payload) {
      return {
        isValid: false,
        reason: 'Approval token not found or already expired/consumed.',
      };
    }

    if (payload.used) {
      return {
        isValid: false,
        reason: 'Security Violation: Approval token has already been consumed (one-time use only).',
      };
    }

    if (Date.now() > payload.expiresAt) {
      this.tokens.delete(params.tokenId);
      return {
        isValid: false,
        reason: 'Approval token has expired.',
      };
    }

    let canonicalPath = params.targetFilePath;
    try {
      if (fs.existsSync(params.targetFilePath)) {
        canonicalPath = fs.realpathSync(params.targetFilePath);
      }
    } catch {
      // ignore
    }

    if (canonicalPath !== payload.targetFilePath) {
      return {
        isValid: false,
        reason: `Target file mismatch: token is bound to '${payload.targetFilePath}', received '${canonicalPath}'.`,
      };
    }

    // Verify file content has not changed since proposal was generated
    const currentHash = ApprovalService.hashContent(params.currentSourceContent);
    if (currentHash !== payload.originalSourceHash) {
      return {
        isValid: false,
        reason: 'Target file has been modified since the repair proposal was approved (source hash mismatch).',
      };
    }

    // Verify patch hash matches exactly
    if (params.patchHash !== payload.patchHash) {
      return {
        isValid: false,
        reason: 'Patch content mismatch: token is bound to a different patch hash.',
      };
    }

    // Mark as consumed
    payload.used = true;
    this.tokens.delete(params.tokenId);

    return {
      isValid: true,
      payload,
    };
  }

  public revokeToken(tokenId: string): boolean {
    return this.tokens.delete(tokenId);
  }

  public clearAllTokens(): void {
    this.tokens.clear();
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [id, payload] of this.tokens.entries()) {
      if (now > payload.expiresAt || payload.used) {
        this.tokens.delete(id);
      }
    }
  }
}

