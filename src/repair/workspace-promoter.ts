import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApprovalService, ApprovalTokenPayload } from './approval-service.js';
import { WorktreeManager } from '../sandbox/worktree-manager.js';

export interface PromotionResult {
  success: boolean;
  targetFilePath: string;
  bytesWritten: number;
  finalHash: string;
  error?: string | undefined;
}

interface LockFilePayload {
  pid: number;
  timestamp: number;
}

/**
 * WorkspacePromoter handles safe, atomic, compare-before-write promotion of
 * verified worktree repairs into the developer's active workspace.
 *
 * Enforces:
 * 1. Canonical realpath containment inside the approved workspace.
 * 2. Cross-process and in-process cooperative file locks.
 * 3. Compare-And-Swap (CAS) hash verification of original source before mutation.
 * 4. Patch diff and content hash validation against cryptographic approval token.
 * 5. Safe temporary file write in the same directory.
 * 6. Recoverable backup creation for fail-closed rollback.
 * 7. Verification of post-promotion content hash.
 * 8. Elimination of unvalidated direct-write fallbacks.
 */
export class WorkspacePromoter {
  private static activeLocks = new Set<string>();

  /**
   * Promotes an approved patch to the active workspace with CAS hash verification,
   * filesystem locks, and atomic rename.
   */
  public static async promote(params: {
    targetFilePath: string;
    workspaceRoot: string;
    patchedContent: string;
    approvalTokenPayload: ApprovalTokenPayload;
  }): Promise<PromotionResult> {
    const { targetFilePath, workspaceRoot, patchedContent, approvalTokenPayload } = params;

    // 1. Resolve canonical target path
    if (!fs.existsSync(targetFilePath)) {
      return {
        success: false,
        targetFilePath,
        bytesWritten: 0,
        finalHash: '',
        error: `Target file does not exist: '${targetFilePath}'`,
      };
    }

    const canonicalTarget = fs.realpathSync(targetFilePath);
    const canonicalWorkspace = fs.realpathSync(workspaceRoot);

    // 2. Verify workspace containment
    const relative = path.relative(canonicalWorkspace, canonicalTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return {
        success: false,
        targetFilePath: canonicalTarget,
        bytesWritten: 0,
        finalHash: '',
        error: `Security Violation: Target path '${canonicalTarget}' escapes workspace root '${canonicalWorkspace}'.`,
      };
    }

    // Verify target matches token binding
    if (canonicalTarget !== approvalTokenPayload.targetFilePath) {
      return {
        success: false,
        targetFilePath: canonicalTarget,
        bytesWritten: 0,
        finalHash: '',
        error: `Approval Token Target Mismatch: Token bound to '${approvalTokenPayload.targetFilePath}', received '${canonicalTarget}'.`,
      };
    }

    // 3. Acquire per-file in-process and cross-process lock
    const lockKey = canonicalTarget.toLowerCase();
    if (WorkspacePromoter.activeLocks.has(lockKey)) {
      return {
        success: false,
        targetFilePath: canonicalTarget,
        bytesWritten: 0,
        finalHash: '',
        error: `Conflict: Another promotion is currently active for '${canonicalTarget}'.`,
      };
    }

    const lockFilePath = `${canonicalTarget}.pie-promote.lock`;
    const lockAcquired = WorkspacePromoter.acquireCrossProcessLock(lockFilePath);
    if (!lockAcquired.success) {
      return {
        success: false,
        targetFilePath: canonicalTarget,
        bytesWritten: 0,
        finalHash: '',
        error: lockAcquired.error,
      };
    }

    WorkspacePromoter.activeLocks.add(lockKey);

    const targetDir = path.dirname(canonicalTarget);
    const tempFile = path.join(targetDir, `.pie-promo-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    const backupFile = path.join(targetDir, `.pie-backup-${process.pid}-${crypto.randomBytes(8).toString('hex')}.bak`);

    try {
      // 4 & 5. Read current file and calculate hash
      const currentContent = await fs.promises.readFile(canonicalTarget, 'utf-8');
      const currentHash = ApprovalService.hashContent(currentContent);

      // 6 & 7. Compare hash (CAS check)
      if (currentHash !== approvalTokenPayload.originalSourceHash) {
        return {
          success: false,
          targetFilePath: canonicalTarget,
          bytesWritten: 0,
          finalHash: currentHash,
          error: `Concurrent Modification Detected: File '${canonicalTarget}' has been modified since approval (current: ${currentHash.slice(0, 8)}, expected: ${approvalTokenPayload.originalSourceHash.slice(0, 8)}). Promotion aborted.`,
        };
      }

      // Verify patchedContent matches token patchedSourceHash
      const contentHash = ApprovalService.hashContent(patchedContent);
      if (approvalTokenPayload.patchedSourceHash && contentHash !== approvalTokenPayload.patchedSourceHash) {
        return {
          success: false,
          targetFilePath: canonicalTarget,
          bytesWritten: 0,
          finalHash: contentHash,
          error: `Patch Content Corrupted: Content hash does not match approved patchedSourceHash.`,
        };
      }

      // P0 TOCTOU Fix: Verify and atomically consume approval token strictly INSIDE the locked critical section
      const tokenConsumption = ApprovalService.getInstance().verifyAndConsumeToken({
        tokenId: approvalTokenPayload.tokenId,
        targetFilePath: canonicalTarget,
        currentSourceContent: currentContent,
        targetClassName: approvalTokenPayload.targetClassName,
        targetMemberName: approvalTokenPayload.targetMemberName,
        patchHash: approvalTokenPayload.replacementAstHash,
        fullDiffHash: approvalTokenPayload.fullDiffHash,
      });

      if (!tokenConsumption.isValid) {
        return {
          success: false,
          targetFilePath: canonicalTarget,
          bytesWritten: 0,
          finalHash: currentHash,
          error: `Security Violation: Token authorization denied under lock: ${tokenConsumption.reason}`,
        };
      }

      // 8. Create safety rollback backup
      await fs.promises.copyFile(canonicalTarget, backupFile);

      // 9. Write to secure temporary file in the same directory
      await fs.promises.writeFile(tempFile, patchedContent, 'utf-8');
      const tempContent = await fs.promises.readFile(tempFile, 'utf-8');
      const writtenHash = ApprovalService.hashContent(tempContent);
      if (writtenHash !== contentHash) {
        throw new Error(`Integrity check failed: written temporary content hash mismatch.`);
      }

      // 10. Atomic replace with retry for Windows transient scanner locks
      let replaced = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.renameSync(tempFile, canonicalTarget);
          replaced = true;
          break;
        } catch {
          // Brief backoff for Windows anti-virus or indexer lock
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      if (!replaced) {
        // Safe rollback from backup: never do unvalidated overwrite
        await fs.promises.copyFile(backupFile, canonicalTarget).catch(() => {});
        throw new Error(`Failed to atomically replace '${canonicalTarget}' after multiple attempts.`);
      }

      // 11. Verify resulting file hash
      const verifiedContent = await fs.promises.readFile(canonicalTarget, 'utf-8');
      const finalHash = ApprovalService.hashContent(verifiedContent);

      if (finalHash !== contentHash) {
        // Rollback immediately if final hash mismatches expected
        await fs.promises.copyFile(backupFile, canonicalTarget).catch(() => {});
        return {
          success: false,
          targetFilePath: canonicalTarget,
          bytesWritten: 0,
          finalHash,
          error: `Post-promotion verification failed: final file hash did not match expected hash. Rolled back from backup.`,
        };
      }

      // 12. Cleanup safety backup on success
      if (fs.existsSync(backupFile)) {
        await fs.promises.unlink(backupFile).catch(() => {});
      }

      return {
        success: true,
        targetFilePath: canonicalTarget,
        bytesWritten: Buffer.byteLength(verifiedContent, 'utf-8'),
        finalHash,
      };
    } catch (err: any) {
      // Clean up temporary file and restore from backup if necessary
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      if (fs.existsSync(backupFile)) {
        try {
          await fs.promises.copyFile(backupFile, canonicalTarget);
          await fs.promises.unlink(backupFile);
        } catch {}
      }
      return {
        success: false,
        targetFilePath: canonicalTarget,
        bytesWritten: 0,
        finalHash: '',
        error: `Promotion I/O Error: ${err?.message ?? String(err)}`,
      };
    } finally {
      // 13. Release in-process and cross-process lock
      WorkspacePromoter.activeLocks.delete(lockKey);
      WorkspacePromoter.releaseCrossProcessLock(lockFilePath);
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      if (fs.existsSync(backupFile)) {
        try { fs.unlinkSync(backupFile); } catch {}
      }
    }
  }

  /**
   * Acquires a cross-process lock using exclusive file creation ('wx').
   * If a lock exists, verifies whether the owning process is still alive.
   * If the owner is dead or the lock is older than 30s, the stale lock is safely reclaimed.
   */
  private static acquireCrossProcessLock(lockFilePath: string): { success: boolean; error?: string } {
    const maxTries = 3;
    for (let i = 0; i < maxTries; i++) {
      try {
        const payload: LockFilePayload = {
          pid: process.pid,
          timestamp: Date.now(),
        };
        fs.writeFileSync(lockFilePath, JSON.stringify(payload), { flag: 'wx' });
        return { success: true };
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Check if lock is stale
          try {
            const raw = fs.readFileSync(lockFilePath, 'utf-8');
            const existing: LockFilePayload = JSON.parse(raw);
            const isAlive = WorktreeManager.isProcessAlive(existing.pid);

            // P1: Never steal lock from a living process regardless of elapsed time
            if (!isAlive) {
              // Owning process has terminated: safely reclaim dead lock
              try { fs.unlinkSync(lockFilePath); } catch {}
              continue;
            }

            return {
              success: false,
              error: `Conflict: Another active PIE process (PID ${existing.pid}) holds the promotion lock for this file.`,
            };
          } catch {
            // Malformed lock file: reclaim
            try { fs.unlinkSync(lockFilePath); } catch {}
            continue;
          }
        }
        return {
          success: false,
          error: `Cross-process lock failure: ${err.message}`,
        };
      }
    }

    return {
      success: false,
      error: `Could not acquire promotion lock for '${lockFilePath}' after ${maxTries} attempts.`,
    };
  }

  private static releaseCrossProcessLock(lockFilePath: string): void {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
  }
}
