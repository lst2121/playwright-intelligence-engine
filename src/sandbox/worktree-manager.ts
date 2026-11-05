import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeOperationError } from '../core/errors/engine-errors.js';
import { DependencyStrategyResolver, IsolationLevel } from './dependency-strategy.js';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  id: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
  ownerPid: number;
  isolationLevel: IsolationLevel;
  strategy: string;
}

export interface WorktreeRegistry {
  worktrees: Record<string, WorktreeInfo>;
}

export class WorktreeManager {
  private readonly rootDir: string;
  private readonly baseWorktreeDir: string;
  private readonly registryPath: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.baseWorktreeDir = path.resolve(this.rootDir, '.pw-intelligence', 'worktrees');
    this.registryPath = path.resolve(this.baseWorktreeDir, 'registry.json');
  }

  private static readonly VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

  /**
   * Checks whether a given process ID is currently alive on the host system.
   */
  public static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asserts that a worktree ID is valid and that the resolved path is strictly contained
   * within the base worktree directory using canonical real paths (AUDIT-05 / AUDIT-06).
   * Prevents symlink/junction escape, directory traversal, and recursive host deletion.
   */
  private assertWorktreeContainment(id: string): string {
    if (!WorktreeManager.VALID_ID_REGEX.test(id)) {
      throw new WorktreeOperationError(
        'validate-id',
        `Security Violation: Invalid worktree ID '${id}'. Must match /^[a-zA-Z0-9_-]{1,64}$/`
      );
    }

    fsSync.mkdirSync(this.baseWorktreeDir, { recursive: true });
    let canonicalBase: string;
    try {
      canonicalBase = fsSync.realpathSync(this.baseWorktreeDir);
    } catch (err: any) {
      throw new WorktreeOperationError(
        'containment',
        `Security Violation: Failed to resolve canonical realpath of base worktree directory '${this.baseWorktreeDir}': ${err.message}`
      );
    }

    const worktreePath = path.resolve(canonicalBase, id);
    const rel = path.relative(canonicalBase, worktreePath);

    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
      throw new WorktreeOperationError(
        'containment',
        `Security Violation: Worktree path '${worktreePath}' escapes base worktree directory '${canonicalBase}'.`
      );
    }

    if (fsSync.existsSync(worktreePath)) {
      try {
        const canonicalWorktree = fsSync.realpathSync(worktreePath);
        const relWorktree = path.relative(canonicalBase, canonicalWorktree);
        if (relWorktree.startsWith('..') || path.isAbsolute(relWorktree)) {
          throw new WorktreeOperationError(
            'containment',
            `Security Violation: Canonical worktree '${canonicalWorktree}' escapes base worktree directory '${canonicalBase}'.`
          );
        }
        return canonicalWorktree;
      } catch (err: any) {
        if (err instanceof WorktreeOperationError) throw err;
        throw new WorktreeOperationError(
          'containment',
          `Security Violation: Failed to resolve canonical realpath of worktree '${worktreePath}': ${err.message}`
        );
      }
    }

    return worktreePath;
  }

  /**
   * Creates an isolated detached Git worktree using the appropriate DependencyStrategy.
   * Enforces fail-closed dependency validation (AUDIT-16).
   */
  public async createWorktree(worktreeId?: string): Promise<WorktreeInfo> {
    const id = worktreeId ?? `repair-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
    const worktreePath = this.assertWorktreeContainment(id);
    const branch = `pw-repair/${id}`;

    await fs.mkdir(this.baseWorktreeDir, { recursive: true });

    // Step 1: Detect dirty workspace state and create snapshot if uncommitted changes exist
    let baseRef = 'HEAD';
    let untrackedFiles: string[] = [];

    try {
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.rootDir });
      const isDirty = statusOut.trim().length > 0;

      if (isDirty) {
        // Create an in-memory commit representing the exact staged and unstaged state without touching workspace
        const { stdout: stashSha } = await execFileAsync('git', ['stash', 'create'], { cwd: this.rootDir });
        const trimmedSha = stashSha.trim();
        if (trimmedSha) {
          baseRef = trimmedSha;
        }

        // Identify untracked, non-ignored files to mirror
        const { stdout: untrackedOut } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: this.rootDir });
        untrackedFiles = untrackedOut.split('\n').map((f) => f.trim()).filter(Boolean);
      }
    } catch {
      // Fall back to HEAD if status check encounters a non-git environment
      baseRef = 'HEAD';
    }

    // Step 2: Create Git worktree
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, baseRef], {
        cwd: this.rootDir,
      });
    } catch (err: any) {
      throw new WorktreeOperationError('create', `Git worktree add failed: ${err.message}`);
    }

    // Step 3: Mirror untracked files into worktree
    if (untrackedFiles.length > 0) {
      for (const relFile of untrackedFiles) {
        try {
          const src = path.resolve(this.rootDir, relFile);
          const dest = path.resolve(worktreePath, relFile);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
        } catch {
          // Non-critical file copy failure
        }
      }
    }

    // Step 2: Prepare dependencies via DependencyStrategy and enforce validation (AUDIT-16)
    const strategy = await DependencyStrategyResolver.resolve(this.rootDir);
    let prepResult;
    try {
      prepResult = await strategy.prepare(this.rootDir, worktreePath);
      // Validate dependency strategy isolation
      const validation = await strategy.validate(worktreePath);
      if (!validation.isValid) {
        throw new Error(
          `Dependency validation failed for '${prepResult.strategy}' (isolation: ${prepResult.isolationLevel}): ${validation.error ?? 'Unmet dependency requirements'}`
        );
      }
    } catch (err: any) {
      await this.destroyWorktree(id).catch(() => {});
      throw new WorktreeOperationError('prepare-dependencies', err.message);
    }

    const info: WorktreeInfo = {
      id,
      worktreePath,
      branch,
      createdAt: Date.now(),
      ownerPid: process.pid,
      isolationLevel: prepResult.isolationLevel,
      strategy: prepResult.strategy,
    };

    await this.registerWorktree(info);
    return info;
  }

  /**
   * Destroys an isolated worktree safely:
   * 1. Unlinks the dependency junction/symlink FIRST (CRITICAL: prevents wiping root dependencies)
   * 2. Runs git worktree remove
   * 3. Deletes leftover branch
   * 4. Cleans up registry
   */
  public async destroyWorktree(id: string): Promise<void> {
    const worktreePath = this.assertWorktreeContainment(id);
    const branch = `pw-repair/${id}`;

    // Step 1: Cleanup dependency links via strategy
    const strategy = await DependencyStrategyResolver.resolve(this.rootDir);
    await strategy.cleanup(worktreePath).catch(() => {});

    // Step 2: Git worktree remove
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: this.rootDir,
      });
    } catch {
      // Fallback: prune if removal failed
      await execFileAsync('git', ['worktree', 'prune'], { cwd: this.rootDir }).catch(() => {});
    }

    // Step 3: Resilient directory cleanup with backoff for Windows file locks
    await this.resilientRemove(worktreePath).catch(() => {});

    // Step 4: Delete temporary branch
    try {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: this.rootDir });
    } catch {
      // Ignore if branch was already deleted
    }

    await this.unregisterWorktree(id);
  }

  /**
   * Robust directory removal with exponential backoff to handle temporary
   * Windows anti-virus or search indexer file locks.
   */
  private async resilientRemove(targetPath: string, maxRetries = 5): Promise<void> {
    let delayMs = 100;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        return;
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return;
        }
        if (attempt === maxRetries - 1) {
          // Fallback: attempt sync removal or log warning
          try {
            fsSync.rmSync(targetPath, { recursive: true, force: true });
            return;
          } catch {
            return;
          }
        }
        await new Promise((res) => setTimeout(res, delayMs));
        delayMs *= 2;
      }
    }
  }

  private async registerWorktree(info: WorktreeInfo): Promise<void> {
    let reg: WorktreeRegistry = { worktrees: {} };
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      reg = JSON.parse(data);
    } catch {
      // Default to empty registry if unreadable
    }

    reg.worktrees[info.id] = info;
    await fs.writeFile(this.registryPath, JSON.stringify(reg, null, 2), 'utf-8');
  }

  private async unregisterWorktree(id: string): Promise<void> {
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      const reg: WorktreeRegistry = JSON.parse(data);
      delete reg.worktrees[id];
      await fs.writeFile(this.registryPath, JSON.stringify(reg, null, 2), 'utf-8');
    } catch {
      // Ignore registry read errors
    }
  }
}
