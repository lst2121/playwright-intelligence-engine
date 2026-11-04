import fs from 'node:fs/promises';
import path from 'node:path';

export type IsolationLevel =
  | 'FULLY_ISOLATED'
  | 'IMMUTABLE_SHARED'
  | 'SHARED_MUTABLE'
  | 'UNSUPPORTED';

export interface DependencyPreparationResult {
  isolationLevel: IsolationLevel;
  strategy: 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-pnp' | 'none';
  linkedPaths: string[];
  warning?: string | undefined;
}

export interface DependencyValidationResult {
  isValid: boolean;
  isolationLevel: IsolationLevel;
  error?: string | undefined;
}

export interface DependencyStrategy {
  readonly name: string;
  detect(root: string): Promise<boolean>;
  prepare(root: string, worktree: string): Promise<DependencyPreparationResult>;
  validate(worktree: string): Promise<DependencyValidationResult>;
  cleanup(worktree: string): Promise<void>;
}

export class NpmStrategy implements DependencyStrategy {
  public readonly name = 'npm';

  public async detect(root: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(root, 'package-lock.json'));
      return true;
    } catch {
      return false;
    }
  }

  public async prepare(root: string, worktree: string): Promise<DependencyPreparationResult> {
    const sourceNodeModules = path.resolve(root, 'node_modules');
    const targetNodeModules = path.resolve(worktree, 'node_modules');

    try {
      await fs.access(sourceNodeModules);
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.symlink(sourceNodeModules, targetNodeModules, linkType);
      return {
        isolationLevel: 'IMMUTABLE_SHARED',
        strategy: 'npm',
        linkedPaths: [targetNodeModules],
      };
    } catch {
      return {
        isolationLevel: 'UNSUPPORTED',
        strategy: 'npm',
        linkedPaths: [],
        warning: 'Root node_modules not found. npm install must be run in repository root.',
      };
    }
  }

  public async validate(worktree: string): Promise<DependencyValidationResult> {
    const target = path.resolve(worktree, 'node_modules');
    try {
      const stats = await fs.lstat(target);
      const isValid = stats.isSymbolicLink() || stats.isDirectory();
      return {
        isValid,
        isolationLevel: 'IMMUTABLE_SHARED',
      };
    } catch (err: any) {
      return {
        isValid: false,
        isolationLevel: 'UNSUPPORTED',
        error: `node_modules junction missing in worktree: ${err.message}`,
      };
    }
  }

  public async cleanup(worktree: string): Promise<void> {
    const target = path.resolve(worktree, 'node_modules');
    try {
      const stats = await fs.lstat(target).catch(() => null);
      if (stats && stats.isSymbolicLink()) {
        await fs.unlink(target);
      }
    } catch {
      // Ignore if already deleted
    }
  }
}

export class PnpmStrategy implements DependencyStrategy {
  public readonly name = 'pnpm';

  public async detect(root: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(root, 'pnpm-lock.yaml'));
      return true;
    } catch {
      return false;
    }
  }

  public async prepare(root: string, worktree: string): Promise<DependencyPreparationResult> {
    const sourceNodeModules = path.resolve(root, 'node_modules');
    const targetNodeModules = path.resolve(worktree, 'node_modules');

    try {
      await fs.access(sourceNodeModules);
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.symlink(sourceNodeModules, targetNodeModules, linkType);

      // In pnpm virtual store layouts, mutable cache directories (e.g. .cache, .vite, .prisma)
      // can leak state between worktrees. We flag SHARED_MUTABLE.
      return {
        isolationLevel: 'SHARED_MUTABLE',
        strategy: 'pnpm',
        linkedPaths: [targetNodeModules],
        warning: 'pnpm virtual store detected. Mutable build caches (.cache, .vite) may be shared across worktrees.',
      };
    } catch {
      return {
        isolationLevel: 'UNSUPPORTED',
        strategy: 'pnpm',
        linkedPaths: [],
        warning: 'Root node_modules not found for pnpm.',
      };
    }
  }

  public async validate(worktree: string): Promise<DependencyValidationResult> {
    const target = path.resolve(worktree, 'node_modules');
    try {
      await fs.lstat(target);
      return {
        isValid: true,
        isolationLevel: 'SHARED_MUTABLE',
      };
    } catch (err: any) {
      return {
        isValid: false,
        isolationLevel: 'UNSUPPORTED',
        error: err.message,
      };
    }
  }

  public async cleanup(worktree: string): Promise<void> {
    const target = path.resolve(worktree, 'node_modules');
    try {
      const stats = await fs.lstat(target).catch(() => null);
      if (stats && stats.isSymbolicLink()) {
        await fs.unlink(target);
      }
    } catch {
      // Ignore
    }
  }
}

export class YarnPnpStrategy implements DependencyStrategy {
  public readonly name = 'yarn-pnp';

  public async detect(root: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(root, '.pnp.cjs'));
      return true;
    } catch {
      return false;
    }
  }

  public async prepare(_root: string, _worktree: string): Promise<DependencyPreparationResult> {
    return {
      isolationLevel: 'UNSUPPORTED',
      strategy: 'yarn-pnp',
      linkedPaths: [],
      warning: 'Yarn Berry PlugnPlay (PnP) does not use node_modules directory. Unlinking is unsupported.',
    };
  }

  public async validate(_worktree: string): Promise<DependencyValidationResult> {
    return {
      isValid: false,
      isolationLevel: 'UNSUPPORTED',
      error: 'Yarn PnP not supported for directory junction linking',
    };
  }

  public async cleanup(_worktree: string): Promise<void> {}
}

export class DependencyStrategyResolver {
  private static strategies: DependencyStrategy[] = [
    new YarnPnpStrategy(),
    new PnpmStrategy(),
    new NpmStrategy(),
  ];

  public static async resolve(root: string): Promise<DependencyStrategy> {
    for (const strategy of DependencyStrategyResolver.strategies) {
      if (await strategy.detect(root)) {
        return strategy;
      }
    }
    // Default fallback to NpmStrategy
    return new NpmStrategy();
  }
}
