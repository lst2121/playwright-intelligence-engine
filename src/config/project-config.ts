import fs from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_CONFIG_VERSION = 1;

export interface PieProjectConfig {
  version: typeof PROJECT_CONFIG_VERSION;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  test: {
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
    command?: string | undefined;
    traceDirectories: string[];
  };
  diagnostics: {
    failClosed: true;
    requireDomEvidence: boolean;
    allowDirectWorkspaceMutation: false;
  };
  memory: {
    ledgerPath: string;
    repositoryProfilePath: string;
  };
}

export interface InitProjectOptions {
  force?: boolean | undefined;
  now?: Date | undefined;
}

export interface InitProjectResult {
  config: PieProjectConfig;
  configPath: string;
  created: boolean;
}

function packageManagerFromFiles(files: Set<string>): PieProjectConfig['test']['packageManager'] {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('package-lock.json')) return 'npm';
  return 'unknown';
}

async function readPackageScripts(projectRoot: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function chooseTestCommand(scripts: Record<string, string>): string | undefined {
  return ['test:e2e', 'test:smoke', 'test', 'e2e'].find((name) => Boolean(scripts[name]));
}

export async function initProjectConfig(
  workspaceRoot = process.cwd(),
  options: InitProjectOptions = {},
): Promise<InitProjectResult> {
  const projectRoot = path.resolve(workspaceRoot);
  const pieDirectory = path.join(projectRoot, '.pie');
  const configPath = path.join(pieDirectory, 'config.json');
  const exists = await fs.access(configPath).then(() => true).catch(() => false);

  if (exists && !options.force) {
    const existing = await loadProjectConfig(projectRoot);
    return { config: existing, configPath, created: false };
  }

  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const scripts = await readPackageScripts(projectRoot);
  const timestamp = (options.now ?? new Date()).toISOString();
  const config: PieProjectConfig = {
    version: PROJECT_CONFIG_VERSION,
    projectRoot,
    createdAt: timestamp,
    updatedAt: timestamp,
    test: {
      packageManager: packageManagerFromFiles(fileNames),
      command: chooseTestCommand(scripts),
      traceDirectories: ['test-results'],
    },
    diagnostics: {
      failClosed: true,
      requireDomEvidence: true,
      allowDirectWorkspaceMutation: false,
    },
    memory: {
      ledgerPath: '.pw-intelligence/stability-ledger.json',
      repositoryProfilePath: '.pie/repository-profile.json',
    },
  };

  await fs.mkdir(pieDirectory, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { config, configPath, created: true };
}

export async function loadProjectConfig(workspaceRoot = process.cwd()): Promise<PieProjectConfig> {
  const configPath = path.join(path.resolve(workspaceRoot), '.pie', 'config.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PieProjectConfig>;
  if (parsed.version !== PROJECT_CONFIG_VERSION) {
    throw new Error(`Unsupported PIE project config version '${String(parsed.version)}'`);
  }
  if (!parsed.projectRoot || !parsed.test || !parsed.diagnostics || !parsed.memory) {
    throw new Error(`Invalid PIE project config at '${configPath}'`);
  }
  return parsed as PieProjectConfig;
}
