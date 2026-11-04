import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WorktreeManager } from '../../src/sandbox/worktree-manager.js';

describe('WorktreeManager Unit Tests (NTFS Isolation & Junctions)', () => {
  const rootDir = path.resolve('.');

  it('should successfully create an isolated Git worktree and link node_modules via junction', async () => {
    const manager = new WorktreeManager(rootDir);
    const testId = `test-${Date.now().toString(36)}`;

    // Create isolated worktree
    const worktree = await manager.createWorktree(testId);
    expect(worktree.id).toBe(testId);

    // Verify directory exists
    const dirExists = await fs.access(worktree.worktreePath).then(() => true).catch(() => false);
    expect(dirExists).toBe(true);

    // Verify node_modules junction exists inside worktree
    const worktreeNodeModules = path.join(worktree.worktreePath, 'node_modules');
    const stats = await fs.lstat(worktreeNodeModules);
    expect(stats.isSymbolicLink()).toBe(true);

    // Safely destroy worktree
    await manager.destroyWorktree(testId);

    // Verify worktree directory is removed
    const postDestroyExists = await fs.access(worktree.worktreePath).then(() => true).catch(() => false);
    expect(postDestroyExists).toBe(false);

    // CRITICAL SAFETY CHECK: Root node_modules must remain 100% intact!
    const rootNodeModulesExists = await fs.access(path.resolve(rootDir, 'node_modules')).then(() => true).catch(() => false);
    expect(rootNodeModulesExists).toBe(true);
  });
});

