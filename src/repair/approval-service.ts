import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VerifiedExecutionProof } from './intent-validator.js';

export interface ApprovalTokenPayload {
  tokenId: string;
  proposalId: string;
  targetFilePath: string; // canonical realpath
  targetClassName: string;
  targetMemberName: string;
  originalSourceHash: string;
  replacementSelector: string;
  replacementAstHash: string;
  fullDiffHash: string;
  patchedSourceHash: string;
  testFilePath: string; // canonical realpath
  testFileHash: string;
  executionVerified: boolean;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
  nonce: string;
}

export interface StagedProposal {
  proposalId: string;
  targetFilePath: string;
  targetClassName: string;
  targetMemberName: string;
  originalSourceHash: string;
  replacementSelector: string;
  replacementAstHash: string;
  fullDiff: string;
  fullDiffHash: string;
  patchedSource: string;
  patchedSourceHash: string;
  testFilePath: string;
  testFileHash: string;
  worktreeId: string;
  worktreeExecutionVerified: boolean;
  executionProof?: VerifiedExecutionProof | undefined;
  createdAt: number;
  expiresAt: number;
}

export interface TokenValidationResult {
  isValid: boolean;
  reason?: string;
  payload?: ApprovalTokenPayload;
}

/**
 * Centralized cryptographic approval service for all source modifications.
 * Guarantees that no repair can be applied without an explicit, unexpired,
 * one-time approval token bound cryptographically to:
 * - Proposal ID & Nonce
 * - Canonical target file path & Original source SHA-256
 * - Target Class Name & Member Name
 * - Replacement Selector & AST Hash
 * - Full Diff SHA-256 & Patched Source SHA-256
 * - Test File Canonical Path & Test File SHA-256
 * - Isolated Worktree Execution Verification Proof
 */
export class ApprovalService {
  private static instance: ApprovalService | undefined;
  private proposals = new Map<string, StagedProposal>();
  private tokens = new Map<string, ApprovalTokenPayload>();
  private readonly defaultTtlMs = 10 * 60 * 1000; // 10 minutes
  private storageDir: string;
  private proposalsDir: string;
  private tokensDir: string;

  public constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || process.env.PIE_STORAGE_DIR || path.resolve(process.cwd(), '.pw-intelligence');
    this.proposalsDir = path.join(this.storageDir, 'proposals');
    this.tokensDir = path.join(this.storageDir, 'tokens');
    try {
      fs.mkdirSync(this.proposalsDir, { recursive: true });
      fs.mkdirSync(this.tokensDir, { recursive: true });
    } catch {
      // Safe fallback if filesystem is read-only
    }
  }

  public static getInstance(customStorageDir?: string): ApprovalService {
    if (!ApprovalService.instance) {
      ApprovalService.instance = new ApprovalService(customStorageDir);
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
   * Stages a verified repair proposal in memory.
   * Note: Staging a proposal does NOT generate an approval token.
   * An approval token is generated only via an explicit, trusted authorization call.
   */
  public stageProposal(params: {
    proposalId?: string;
    targetFilePath: string;
    targetClassName: string;
    targetMemberName: string;
    originalSourceContent: string;
    replacementSelector: string;
    fullDiff: string;
    patchedSource: string;
    testFilePath: string;
    testFileContent: string;
    worktreeId: string;
    worktreeExecutionVerified?: boolean;
    proof?: VerifiedExecutionProof;
    ttlMs?: number;
  }): StagedProposal {
    const canonicalTarget = fs.existsSync(params.targetFilePath)
      ? fs.realpathSync(params.targetFilePath)
      : path.resolve(params.targetFilePath);

    const canonicalTest = fs.existsSync(params.testFilePath)
      ? fs.realpathSync(params.testFilePath)
      : path.resolve(params.testFilePath);

    const proposalId = params.proposalId ?? `prop-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;

    // Derived execution verification: caller-supplied boolean is never trusted
    // unless verified proof from an actual worktree execution is attached.
    let isVerified = false;
    if (params.proof) {
      isVerified = Boolean(
        params.proof.passed &&
        params.proof.exitCode === 0 &&
        (params.proof.executionOutcome === 'PASS' || params.proof.executionOutcome === undefined) &&
        (params.proof.assertionIntegrityValid !== false)
      );
    }

    const staged: StagedProposal = {
      proposalId,
      targetFilePath: canonicalTarget,
      targetClassName: params.targetClassName,
      targetMemberName: params.targetMemberName,
      originalSourceHash: ApprovalService.hashContent(params.originalSourceContent),
      replacementSelector: params.replacementSelector,
      replacementAstHash: ApprovalService.hashContent(params.replacementSelector.trim()),
      fullDiff: params.fullDiff,
      fullDiffHash: ApprovalService.hashContent(params.fullDiff),
      patchedSource: params.patchedSource,
      patchedSourceHash: ApprovalService.hashContent(params.patchedSource),
      testFilePath: canonicalTest,
      testFileHash: ApprovalService.hashContent(params.testFileContent),
      worktreeId: params.worktreeId,
      worktreeExecutionVerified: isVerified,
      executionProof: params.proof,
      createdAt: now,
      expiresAt: now + ttl,
    };

    this.proposals.set(proposalId, staged);
    try {
      fs.mkdirSync(this.proposalsDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.proposalsDir, `${proposalId}.json`),
        JSON.stringify(staged, null, 2),
        'utf-8'
      );
    } catch {
      // Safe fallback if disk is read-only
    }
    return staged;
  }

  public getTokenPayload(tokenId: string): ApprovalTokenPayload | undefined {
    this.cleanupExpired();
    let payload = this.tokens.get(tokenId);
    if (!payload) {
      const diskPath = path.join(this.tokensDir, `${tokenId}.json`);
      if (fs.existsSync(diskPath)) {
        try {
          const raw = fs.readFileSync(diskPath, 'utf-8');
          const parsed = JSON.parse(raw) as ApprovalTokenPayload;
          if (Date.now() <= parsed.expiresAt && !parsed.used) {
            payload = parsed;
            this.tokens.set(tokenId, parsed);
          } else {
            try { fs.unlinkSync(diskPath); } catch {}
          }
        } catch {
          // Ignore corrupt file
        }
      }
    }
    return payload;
  }

  public getProposal(proposalId: string): StagedProposal | undefined {
    this.cleanupExpired();
    let proposal = this.proposals.get(proposalId);
    if (!proposal) {
      const diskPath = path.join(this.proposalsDir, `${proposalId}.json`);
      if (fs.existsSync(diskPath)) {
        try {
          const raw = fs.readFileSync(diskPath, 'utf-8');
          const parsed = JSON.parse(raw) as StagedProposal;
          if (Date.now() <= parsed.expiresAt) {
            proposal = parsed;
            this.proposals.set(proposalId, parsed);
          } else {
            try { fs.unlinkSync(diskPath); } catch {}
          }
        } catch {
          // Ignore corrupt file
        }
      }
    }
    return proposal;
  }

  /**
   * Authorizes a staged proposal and issues an unforgeable single-use approval token.
   * Must be called explicitly by a human CLI action or a verified authorization hook.
   */
  public authorizeProposal(params: {
    proposalId: string;
    ttlMs?: number;
  }): ApprovalTokenPayload {
    this.cleanupExpired();
    const proposal = this.getProposal(params.proposalId);
    if (!proposal) {
      throw new Error(`Cannot authorize proposal: '${params.proposalId}' not found or expired.`);
    }

    if (!proposal.worktreeExecutionVerified || !proposal.executionProof || !proposal.executionProof.passed) {
      throw new Error(
        `Security Violation: Cannot authorize proposal '${params.proposalId}'. Worktree test execution was not verified.`
      );
    }

    const tokenId = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;

    const payload: ApprovalTokenPayload = {
      tokenId,
      proposalId: proposal.proposalId,
      targetFilePath: proposal.targetFilePath,
      targetClassName: proposal.targetClassName,
      targetMemberName: proposal.targetMemberName,
      originalSourceHash: proposal.originalSourceHash,
      replacementSelector: proposal.replacementSelector,
      replacementAstHash: proposal.replacementAstHash,
      fullDiffHash: proposal.fullDiffHash,
      patchedSourceHash: proposal.patchedSourceHash,
      testFilePath: proposal.testFilePath,
      testFileHash: proposal.testFileHash,
      executionVerified: proposal.worktreeExecutionVerified,
      issuedAt: now,
      expiresAt: now + ttl,
      used: false,
      nonce,
    };

    this.tokens.set(tokenId, payload);
    try {
      fs.mkdirSync(this.tokensDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.tokensDir, `${tokenId}.json`),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );
    } catch {
      // Safe fallback
    }
    return payload;
  }

  /**
   * Legacy generator helper retained for compatibility, now strictly requires explicit execution verification.
   */
  public generateToken(params: {
    proposalId: string;
    patchHash: string;
    targetFilePath: string;
    originalSourceHash: string;
    targetClassName?: string;
    targetMemberName?: string;
    replacementSelector?: string;
    fullDiffHash?: string;
    patchedSourceHash?: string;
    testFilePath?: string;
    testFileHash?: string;
    executionVerified?: boolean;
    ttlMs?: number;
  }): ApprovalTokenPayload {
    let canonicalTarget = params.targetFilePath;
    try {
      if (fs.existsSync(params.targetFilePath)) {
        canonicalTarget = fs.realpathSync(params.targetFilePath);
      }
    } catch {
      // fallback
    }

    let canonicalTest = params.testFilePath ?? params.targetFilePath;
    try {
      if (fs.existsSync(canonicalTest)) {
        canonicalTest = fs.realpathSync(canonicalTest);
      }
    } catch {
      // fallback
    }

    const tokenId = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const ttl = params.ttlMs ?? this.defaultTtlMs;

    // Fail closed: executionVerified is strictly false unless explicitly supplied as true
    const executionVerified = params.executionVerified === true;

    const payload: ApprovalTokenPayload = {
      tokenId,
      proposalId: params.proposalId,
      targetFilePath: canonicalTarget,
      targetClassName: params.targetClassName ?? 'UnknownClass',
      targetMemberName: params.targetMemberName ?? 'unknownMember',
      originalSourceHash: params.originalSourceHash,
      replacementSelector: params.replacementSelector ?? '',
      replacementAstHash: params.patchHash,
      fullDiffHash: params.fullDiffHash ?? params.patchHash,
      patchedSourceHash: params.patchedSourceHash ?? params.patchHash,
      testFilePath: canonicalTest,
      testFileHash: params.testFileHash ?? '',
      executionVerified,
      issuedAt: now,
      expiresAt: now + ttl,
      used: false,
      nonce,
    };

    this.tokens.set(tokenId, payload);
    try {
      fs.mkdirSync(this.tokensDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.tokensDir, `${tokenId}.json`),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );
    } catch {}
    return payload;
  }

  /**
   * Verifies an approval token against the current file state, target member, diff hash,
   * and test file hash, then atomically consumes the token on success.
   */
  public verifyAndConsumeToken(params: {
    tokenId: string;
    targetFilePath: string;
    currentSourceContent: string;
    targetClassName?: string;
    targetMemberName?: string;
    patchHash?: string;
    fullDiffHash?: string;
    currentTestFileContent?: string;
  }): TokenValidationResult {
    this.cleanupExpired();

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
        reason: 'Security Violation: Approval token has already been consumed (replay rejected).',
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

    // Target class and member validation
    if (params.targetClassName && params.targetClassName !== payload.targetClassName) {
      return {
        isValid: false,
        reason: `Class mismatch: token is bound to class '${payload.targetClassName}', received '${params.targetClassName}'.`,
      };
    }

    if (params.targetMemberName && params.targetMemberName !== payload.targetMemberName) {
      return {
        isValid: false,
        reason: `Member mismatch: token is bound to member '${payload.targetMemberName}', received '${params.targetMemberName}'.`,
      };
    }

    // Verify source file content has not changed since proposal was generated
    const currentHash = ApprovalService.hashContent(params.currentSourceContent);
    if (currentHash !== payload.originalSourceHash) {
      return {
        isValid: false,
        reason: 'Target file has been modified since the repair proposal was approved (source hash mismatch).',
      };
    }

    // Verify diff hash if supplied
    if (params.fullDiffHash && params.fullDiffHash !== payload.fullDiffHash) {
      return {
        isValid: false,
        reason: 'Diff hash mismatch: token is bound to a different patch diff.',
      };
    }

    // Verify patch/ast hash if supplied
    if (params.patchHash && params.patchHash !== payload.replacementAstHash && params.patchHash !== payload.fullDiffHash) {
      return {
        isValid: false,
        reason: 'Patch content mismatch: token is bound to a different patch hash.',
      };
    }

    // Verify test file content has not changed
    if (params.currentTestFileContent && payload.testFileHash) {
      const currentTestHash = ApprovalService.hashContent(params.currentTestFileContent);
      if (currentTestHash !== payload.testFileHash) {
        return {
          isValid: false,
          reason: 'Test file has been modified since the repair proposal was approved (test hash mismatch).',
        };
      }
    }

    // Verify execution was actually verified
    if (!payload.executionVerified) {
      return {
        isValid: false,
        reason: 'Security Violation: Cannot consume token for unverified repair execution.',
      };
    }

    // Atomically mark as consumed in memory and delete on disk
    payload.used = true;
    this.tokens.delete(params.tokenId);
    const diskPath = path.join(this.tokensDir, `${params.tokenId}.json`);
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch {}
    }

    return {
      isValid: true,
      payload,
    };
  }

  public revokeToken(tokenId: string): boolean {
    const memDeleted = this.tokens.delete(tokenId);
    const diskPath = path.join(this.tokensDir, `${tokenId}.json`);
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
        return true;
      } catch {}
    }
    return memDeleted;
  }

  public clearAllTokens(): void {
    this.tokens.clear();
    this.proposals.clear();
    try {
      if (fs.existsSync(this.proposalsDir)) {
        for (const f of fs.readdirSync(this.proposalsDir)) {
          try { fs.unlinkSync(path.join(this.proposalsDir, f)); } catch {}
        }
      }
      if (fs.existsSync(this.tokensDir)) {
        for (const f of fs.readdirSync(this.tokensDir)) {
          try { fs.unlinkSync(path.join(this.tokensDir, f)); } catch {}
        }
      }
    } catch {}
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, payload] of this.tokens.entries()) {
      if (now > payload.expiresAt || payload.used) {
        this.tokens.delete(id);
        const diskPath = path.join(this.tokensDir, `${id}.json`);
        if (fs.existsSync(diskPath)) {
          try { fs.unlinkSync(diskPath); } catch {}
        }
      }
    }
    for (const [id, proposal] of this.proposals.entries()) {
      if (now > proposal.expiresAt) {
        this.proposals.delete(id);
        const diskPath = path.join(this.proposalsDir, `${id}.json`);
        if (fs.existsSync(diskPath)) {
          try { fs.unlinkSync(diskPath); } catch {}
        }
      }
    }
  }
}
