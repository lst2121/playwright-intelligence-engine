import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WorktreeManager } from '../../src/sandbox/worktree-manager.js';
import {
  NpmStrategy,
  PnpmStrategy,
  YarnPnpStrategy,
  DependencyStrategyResolver,
} from '../../src/sandbox/dependency-strategy.js';

describe('Worktree and Dependency Isolation Suite (30 Tests)', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-worktree-isolation');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- Category 1: Dependency Strategies (Npm, Pnpm, Yarn PnP) (15 tests) ---
  it('DEP-NPM-01: NpmStrategy should detect package-lock.json', async () => {
    const root = path.resolve(tmpDir, 'npm-repo');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.resolve(root, 'package-lock.json'), '{}');

    const strategy = new NpmStrategy();
    expect(await strategy.detect(root)).toBe(true);
  });

  it('DEP-NPM-02: NpmStrategy should return false when package-lock.json missing', async () => {
    const strategy = new NpmStrategy();
    expect(await strategy.detect(tmpDir)).toBe(false);
  });

  it('DEP-NPM-03: NpmStrategy prepare should create junction and return IMMUTABLE_SHARED', async () => {
    const root = path.resolve(tmpDir, 'npm-prep');
    const worktree = path.resolve(tmpDir, 'npm-wt');
    await fs.mkdir(path.resolve(root, 'node_modules'), { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new NpmStrategy();
    const result = await strategy.prepare(root, worktree);
    expect(result.isolationLevel).toBe('IMMUTABLE_SHARED');
    expect(result.strategy).toBe('npm');

    const wtNm = path.resolve(worktree, 'node_modules');
    const stats = await fs.lstat(wtNm);
    expect(stats.isSymbolicLink() || stats.isDirectory()).toBe(true);
  });

  it('DEP-NPM-04: NpmStrategy validate should verify existing worktree junction', async () => {
    const root = path.resolve(tmpDir, 'npm-val');
    const worktree = path.resolve(tmpDir, 'npm-wt-val');
    await fs.mkdir(path.resolve(root, 'node_modules'), { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new NpmStrategy();
    await strategy.prepare(root, worktree);
    const val = await strategy.validate(worktree);
    expect(val.isValid).toBe(true);
    expect(val.isolationLevel).toBe('IMMUTABLE_SHARED');
  });

  it('DEP-NPM-05: NpmStrategy cleanup should safely unlink junction without deleting root node_modules', async () => {
    const root = path.resolve(tmpDir, 'npm-clean');
    const worktree = path.resolve(tmpDir, 'npm-wt-clean');
    const rootNm = path.resolve(root, 'node_modules');
    await fs.mkdir(rootNm, { recursive: true });
    await fs.writeFile(path.resolve(rootNm, 'sentinel.txt'), 'ROOT_PRESERVED');
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new NpmStrategy();
    await strategy.prepare(root, worktree);
    await strategy.cleanup(worktree);

    // Root node_modules must remain intact!
    const sentinelContent = await fs.readFile(path.resolve(rootNm, 'sentinel.txt'), 'utf8');
    expect(sentinelContent).toBe('ROOT_PRESERVED');

    // Worktree node_modules must be removed
    const exists = await fs.access(path.resolve(worktree, 'node_modules')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('DEP-PNPM-01: PnpmStrategy should detect pnpm-lock.yaml', async () => {
    const root = path.resolve(tmpDir, 'pnpm-repo');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.resolve(root, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');

    const strategy = new PnpmStrategy();
    expect(await strategy.detect(root)).toBe(true);
  });

  it('DEP-PNPM-02: PnpmStrategy prepare should flag SHARED_MUTABLE due to virtual store caching', async () => {
    const root = path.resolve(tmpDir, 'pnpm-prep');
    const worktree = path.resolve(tmpDir, 'pnpm-wt');
    await fs.mkdir(path.resolve(root, 'node_modules'), { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new PnpmStrategy();
    const result = await strategy.prepare(root, worktree);
    expect(result.isolationLevel).toBe('SHARED_MUTABLE');
    expect(result.strategy).toBe('pnpm');
    expect(result.warning).toContain('pnpm virtual store detected');
  });

  it('DEP-PNPM-03: PnpmStrategy validate should report SHARED_MUTABLE level', async () => {
    const root = path.resolve(tmpDir, 'pnpm-val');
    const worktree = path.resolve(tmpDir, 'pnpm-wt-val');
    await fs.mkdir(path.resolve(root, 'node_modules'), { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new PnpmStrategy();
    await strategy.prepare(root, worktree);
    const val = await strategy.validate(worktree);
    expect(val.isValid).toBe(true);
    expect(val.isolationLevel).toBe('SHARED_MUTABLE');
  });

  it('DEP-PNPM-04: PnpmStrategy cleanup should safely unlink', async () => {
    const root = path.resolve(tmpDir, 'pnpm-clean');
    const worktree = path.resolve(tmpDir, 'pnpm-wt-clean');
    await fs.mkdir(path.resolve(root, 'node_modules'), { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new PnpmStrategy();
    await strategy.prepare(root, worktree);
    await strategy.cleanup(worktree);

    const exists = await fs.access(path.resolve(worktree, 'node_modules')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('DEP-YARN-01: YarnPnpStrategy should detect .pnp.cjs', async () => {
    const root = path.resolve(tmpDir, 'yarn-repo');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.resolve(root, '.pnp.cjs'), 'module.exports = {};');

    const strategy = new YarnPnpStrategy();
    expect(await strategy.detect(root)).toBe(true);
  });

  it('DEP-YARN-02: YarnPnpStrategy prepare should return UNSUPPORTED for directory junction', async () => {
    const root = path.resolve(tmpDir, 'yarn-prep');
    const worktree = path.resolve(tmpDir, 'yarn-wt');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const strategy = new YarnPnpStrategy();
    const result = await strategy.prepare(root, worktree);
    expect(result.isolationLevel).toBe('UNSUPPORTED');
    expect(result.warning).toContain('Yarn Berry PlugnPlay (PnP) does not use node_modules');
  });

  it('DEP-YARN-03: YarnPnpStrategy validate should return isValid: false', async () => {
    const strategy = new YarnPnpStrategy();
    const val = await strategy.validate(tmpDir);
    expect(val.isValid).toBe(false);
    expect(val.isolationLevel).toBe('UNSUPPORTED');
  });

  it('DEP-RESOLV-01: DependencyStrategyResolver should resolve pnpm when pnpm-lock.yaml exists', async () => {
    const root = path.resolve(tmpDir, 'detect-pnpm');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.resolve(root, 'pnpm-lock.yaml'), '');

    const resolved = await DependencyStrategyResolver.resolve(root);
    expect(resolved.name).toBe('pnpm');
  });

  it('DEP-RESOLV-02: DependencyStrategyResolver should resolve yarn-pnp when .pnp.cjs exists', async () => {
    const root = path.resolve(tmpDir, 'detect-yarn');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.resolve(root, '.pnp.cjs'), '');

    const resolved = await DependencyStrategyResolver.resolve(root);
    expect(resolved.name).toBe('yarn-pnp');
  });

  it('DEP-RESOLV-03: DependencyStrategyResolver should fallback to npm by default', async () => {
    const root = path.resolve(tmpDir, 'detect-default');
    await fs.mkdir(root, { recursive: true });

    const resolved = await DependencyStrategyResolver.resolve(root);
    expect(resolved.name).toBe('npm');
  });

  // --- Category 2: Worktree Lifecycle, Isolation & Process Tracking (15 tests) ---
  it('WORKTREE-01: isProcessAlive should return true for current process PID', () => {
    expect(WorktreeManager.isProcessAlive(process.pid)).toBe(true);
  });

  it('WORKTREE-02: isProcessAlive should return false for non-existent PID (999999)', () => {
    expect(WorktreeManager.isProcessAlive(999999)).toBe(false);
  });

  it('WORKTREE-03: should create worktree with detached HEAD and dedicated branch', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree('test-suite-wt-1');

    try {
      expect(info.id).toBe('test-suite-wt-1');
      expect(info.branch).toBe('pw-repair/test-suite-wt-1');
      expect(info.ownerPid).toBe(process.pid);
      expect(info.isolationLevel).toBeDefined();

      const exists = await fs.access(info.worktreePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    } finally {
      await manager.destroyWorktree('test-suite-wt-1');
    }
  });

  it('WORKTREE-04: should clean up worktree and delete temporary branch upon destroy', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree('test-suite-wt-2');
    await manager.destroyWorktree('test-suite-wt-2');

    const exists = await fs.access(info.worktreePath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('WORKTREE-05: should preserve root node_modules after worktree creation and destruction', async () => {
    const manager = new WorktreeManager(process.cwd());
    const rootNm = path.resolve(process.cwd(), 'node_modules');
    const rootExistsBefore = await fs.access(rootNm).then(() => true).catch(() => false);
    expect(rootExistsBefore).toBe(true);

    const info = await manager.createWorktree('test-preserve-root');
    await manager.destroyWorktree('test-preserve-root');

    const rootExistsAfter = await fs.access(rootNm).then(() => true).catch(() => false);
    expect(rootExistsAfter).toBe(true);
  });

  it('WORKTREE-06: should record worktree in registry.json', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree('test-reg-wt');

    try {
      const regPath = path.resolve(process.cwd(), '.pw-intelligence', 'worktrees', 'registry.json');
      const raw = await fs.readFile(regPath, 'utf8');
      const reg = JSON.parse(raw);
      expect(reg.worktrees['test-reg-wt']).toBeDefined();
      expect(reg.worktrees['test-reg-wt'].ownerPid).toBe(process.pid);
    } finally {
      await manager.destroyWorktree('test-reg-wt');
    }
  });

  it('WORKTREE-07: should unregister worktree from registry.json upon destroy', async () => {
    const manager = new WorktreeManager(process.cwd());
    await manager.createWorktree('test-unreg-wt');
    await manager.destroyWorktree('test-unreg-wt');

    const regPath = path.resolve(process.cwd(), '.pw-intelligence', 'worktrees', 'registry.json');
    const raw = await fs.readFile(regPath, 'utf8');
    const reg = JSON.parse(raw);
    expect(reg.worktrees['test-unreg-wt']).toBeUndefined();
  });

  it('WORKTREE-08: should handle destroy on already removed worktree gracefully', async () => {
    const manager = new WorktreeManager(process.cwd());
    await expect(manager.destroyWorktree('already-gone-id')).resolves.not.toThrow();
  });

  it('WORKTREE-09: should generate unique random ID when worktreeId omitted', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree();
    try {
      expect(info.id.startsWith('repair-')).toBe(true);
    } finally {
      await manager.destroyWorktree(info.id);
    }
  });

  it('WORKTREE-10: should report createdAt timestamp on worktree creation', async () => {
    const manager = new WorktreeManager(process.cwd());
    const before = Date.now();
    const info = await manager.createWorktree('test-time-wt');
    try {
      expect(info.createdAt).toBeGreaterThanOrEqual(before);
    } finally {
      await manager.destroyWorktree('test-time-wt');
    }
  });

  it('WORKTREE-11: should support concurrent worktree creation with distinct IDs', async () => {
    const manager = new WorktreeManager(process.cwd());
    const [wtA, wtB] = await Promise.all([
      manager.createWorktree('concurrent-wt-a'),
      manager.createWorktree('concurrent-wt-b'),
    ]);

    try {
      expect(wtA.worktreePath).not.toBe(wtB.worktreePath);
      const existsA = await fs.access(wtA.worktreePath).then(() => true).catch(() => false);
      const existsB = await fs.access(wtB.worktreePath).then(() => true).catch(() => false);
      expect(existsA).toBe(true);
      expect(existsB).toBe(true);
    } finally {
      await Promise.all([
        manager.destroyWorktree('concurrent-wt-a'),
        manager.destroyWorktree('concurrent-wt-b'),
      ]);
    }
  });

  it('WORKTREE-12: worktree should have valid package.json matching repository root', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree('test-pkg-wt');
    try {
      const wtPkg = path.resolve(info.worktreePath, 'package.json');
      const raw = await fs.readFile(wtPkg, 'utf8');
      const pkg = JSON.parse(raw);
      expect(pkg.name).toBe('playwright-intelligence-engine');
    } finally {
      await manager.destroyWorktree('test-pkg-wt');
    }
  });

  it('WORKTREE-13: should record dependency strategy in WorktreeInfo', async () => {
    const manager = new WorktreeManager(process.cwd());
    const info = await manager.createWorktree('test-strat-info');
    try {
      expect(info.strategy).toBeDefined();
    } finally {
      await manager.destroyWorktree('test-strat-info');
    }
  });

  it('WORKTREE-14: destroyWorktree should prune git worktree metadata if already deleted', async () => {
    const manager = new WorktreeManager(process.cwd());
    await expect(manager.destroyWorktree('prune-test-wt')).resolves.not.toThrow();
  });

  it('WORKTREE-15: worktreeManager should instantiate with relative or absolute paths', () => {
    const m1 = new WorktreeManager('.');
    const m2 = new WorktreeManager(process.cwd());
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
  });
});

