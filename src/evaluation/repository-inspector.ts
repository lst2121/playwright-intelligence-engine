import fs from 'node:fs/promises';
import path from 'node:path';

export interface RepositoryManifest {
  name: string;
  root: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
  license: string;
  nodeVersion?: string | undefined;
  playwrightVersion?: string | undefined;
  hasPlaywrightConfig: boolean;
  playwrightConfigs: string[];
  testFiles: number;
  pageObjectFiles: number;
  fixtureFiles: number;
  hasDocker: boolean;
  hasLocalWebServerHint: boolean;
  scripts: Record<string, string>;
  status: 'DISCOVERED' | 'NOT_A_PLAYWRIGHT_REPOSITORY' | 'UNREADABLE';
  limitations: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage', 'playwright-report', 'test-results'].includes(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...await listFiles(fullPath, depth + 1));
    else results.push(fullPath);
  }
  return results;
}

export async function inspectRepository(root: string): Promise<RepositoryManifest> {
  const absoluteRoot = path.resolve(root);
  try {
    const files = await listFiles(absoluteRoot);
    const packageCandidates = [
      path.join(absoluteRoot, 'package.json'),
      ...files.filter((file) => path.basename(file) === 'package.json' && file !== path.join(absoluteRoot, 'package.json')),
    ];
    let packagePath: string | undefined;
    let packageJson: {
      license?: string;
      engines?: { node?: string };
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } | undefined;
    for (const candidate of packageCandidates) {
      try {
        const parsed = JSON.parse(await fs.readFile(candidate, 'utf8')) as typeof packageJson;
        const dependencies = { ...parsed?.dependencies, ...parsed?.devDependencies };
        if (!packageJson || Object.keys(dependencies).some((name) => name === '@playwright/test' || name === 'playwright')) {
          packagePath = candidate;
          packageJson = parsed;
        }
        if (Object.keys(dependencies).some((name) => name === '@playwright/test' || name === 'playwright')) break;
      } catch {
        // Continue searching nested packages in monorepos.
      }
    }
    if (!packageJson || !packagePath) throw new Error('No readable package.json found');

    const relative = files.map((file) => path.relative(absoluteRoot, file));
    const configs = relative.filter((file) => /(^|[\\/])playwright(?:\.[^.]*)?\.config\.(?:ts|js|mjs|cjs)$/i.test(file));
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const hasPlaywright = Object.keys(allDependencies).some((name) => name === '@playwright/test' || name === 'playwright');
    const packageRoot = path.dirname(packagePath);
    const packageManager = await exists(path.join(packageRoot, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : await exists(path.join(packageRoot, 'yarn.lock'))
        ? 'yarn'
        : await exists(path.join(packageRoot, 'package-lock.json'))
          ? 'npm'
          : 'unknown';

    const limitations = packageRoot !== absoluteRoot ? [`Playwright package metadata discovered in nested project: ${path.relative(absoluteRoot, packageRoot)}`] : [];

    return {
      name: path.basename(absoluteRoot),
      root: absoluteRoot,
      packageManager,
      license: packageJson.license ?? 'UNKNOWN',
      nodeVersion: packageJson.engines?.node,
      playwrightVersion: allDependencies['@playwright/test'] ?? allDependencies.playwright,
      hasPlaywrightConfig: configs.length > 0,
      playwrightConfigs: configs,
      testFiles: relative.filter((file) => /(?:^|[\\/])(?:tests?|e2e)(?:[\\/]).*\.(?:spec|test)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)).length,
      pageObjectFiles: relative.filter((file) => /(?:page|pages|pom|page-objects?)[\\/].*\.(?:ts|tsx|js|jsx)$/i.test(file)).length,
      fixtureFiles: relative.filter((file) => /fixture/i.test(file) && /\.(?:ts|tsx|js|jsx)$/.test(file)).length,
      hasDocker: relative.some((file) => /(?:^|[\\/])(?:docker-compose[^\\/]*|Dockerfile(?:\..*)?)$/i.test(file)),
      hasLocalWebServerHint: Object.values(packageJson.scripts ?? {}).some((script) => /(?:next|vite|dev|start|serve)/i.test(script)),
      scripts: packageJson.scripts ?? {},
      status: hasPlaywright || configs.length > 0 ? 'DISCOVERED' : 'NOT_A_PLAYWRIGHT_REPOSITORY',
      limitations,
    };
  } catch (error) {
    return {
      name: path.basename(absoluteRoot),
      root: absoluteRoot,
      packageManager: 'unknown',
      license: 'UNKNOWN',
      hasPlaywrightConfig: false,
      playwrightConfigs: [],
      testFiles: 0,
      pageObjectFiles: 0,
      fixtureFiles: 0,
      hasDocker: false,
      hasLocalWebServerHint: false,
      scripts: {},
      status: 'UNREADABLE',
      limitations: [`Unable to inspect repository: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export async function inspectTestbed(testbedRoot: string): Promise<RepositoryManifest[]> {
  const repositoriesRoot = path.join(path.resolve(testbedRoot), 'repositories');
  const entries = await fs.readdir(repositoriesRoot, { withFileTypes: true });
  const manifests: RepositoryManifest[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    manifests.push(await inspectRepository(path.join(repositoriesRoot, entry.name)));
  }
  return manifests.sort((left, right) => left.name.localeCompare(right.name));
}

