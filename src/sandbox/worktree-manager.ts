import fs from 'node:fs/promises';
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

  /**
   * Creates an isolated detached Git worktree using the appropriate DependencyStrategy.
   */
  public async createWorktree(worktreeId?: string): Promise<WorktreeInfo> {
    const id = worktreeId ?? `repair-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
    const worktreePath = path.resolve(this.baseWorktreeDir, id);
    const branch = `pw-repair/${id}`;

    await fs.mkdir(this.baseWorktreeDir, { recursive: true });

    // Step 1: Create Git worktree
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
        cwd: this.rootDir,
      });
    } catch (err: any) {
      throw new WorktreeOperationError('create', `Git worktree add failed: ${err.message}`);
    }

    // Step 2: Prepare dependencies via DependencyStrategy
    const strategy = await DependencyStrategyResolver.resolve(this.rootDir);
    let prepResult;
    try {
      prepResult = await strategy.prepare(this.rootDir, worktreePath);
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
    const worktreePath = path.resolve(this.baseWorktreeDir, id);
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
   * Checks if an owner process ID is currently running on the system.
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
   * Exponential backoff removal to handle Windows Defender / SearchIndexer transient file locks.
   */
  private async resilientRemove(targetPath: string, maxRetries = 5, initialDelayMs = 100): Promise<void> {
    let delay = initialDelayMs;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        return;
      } catch (err: any) {
        if ((err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY') && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
          delay *= 2;
        } else {
          // If exhausted retries or other error, ignore if directory no longer exists
          const exists = await fs.access(targetPath).then(() => true).catch(() => false);
          if (!exists) return;
        }
      }
    }
  }

  private async registerWorktree(info: WorktreeInfo): Promise<void> {
    const registry = await this.readRegistry();
    registry.worktrees[info.id] = info;
    await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  private async unregisterWorktree(id: string): Promise<void> {
    const registry = await this.readRegistry();
    delete registry.worktrees[id];
    await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  private async readRegistry(): Promise<WorktreeRegistry> {
    try {
      const data = await fs.readFile(this.registryPath, 'utf8');
      return JSON.parse(data) as WorktreeRegistry;
    } catch {
      return { worktrees: {} };
    }
  }
}

