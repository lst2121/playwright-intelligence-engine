import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export type TestRunStatus = 'PASS' | 'FAIL' | 'SKIP' | 'TIMEOUT' | 'BLOCKED';

export interface TestRunObservation {
  runId: string;
  testId: string;
  repository?: string | undefined;
  title?: string | undefined;
  sourceFile?: string | undefined;
  status: TestRunStatus;
  durationMs?: number | undefined;
  timestamp?: number | undefined;
  retryIndex?: number | undefined;
  failureClusterId?: string | undefined;
}

export interface TestStabilitySummary {
  testId: string;
  repository?: string | undefined;
  title?: string | undefined;
  sourceFile?: string | undefined;
  runs: number;
  passes: number;
  failures: number;
  skips: number;
  blocked: number;
  passRate: number;
  flakeRate: number;
  flaky: boolean;
  averageDurationMs?: number | undefined;
  p95DurationMs?: number | undefined;
  lastStatus: TestRunStatus;
  failureClusters: string[];
}

export interface TestImpactCandidate {
  testId: string;
  title?: string | undefined;
  sourceFile: string;
  dependencies?: string[] | undefined;
  tags?: string[] | undefined;
}

export interface ImpactedTest {
  testId: string;
  title?: string | undefined;
  sourceFile: string;
  confidence: 'direct' | 'dependency' | 'directory' | 'tag' | 'unknown';
  reasons: string[];
}

export interface RepositoryImpactAnalysis {
  root: string;
  changedFiles: string[];
  candidates: TestImpactCandidate[];
  impactedTests: ImpactedTest[];
  limitations: string[];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(values: number[], percentileValue: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function analyzeTestStability(records: TestRunObservation[]): TestStabilitySummary[] {
  const groups = new Map<string, TestRunObservation[]>();
  for (const record of records) {
    const existing = groups.get(record.testId);
    if (existing) existing.push(record);
    else groups.set(record.testId, [record]);
  }

  return [...groups.values()].map((runs) => {
    const passes = runs.filter((run) => run.status === 'PASS').length;
    const failures = runs.filter((run) => run.status === 'FAIL' || run.status === 'TIMEOUT').length;
    const skips = runs.filter((run) => run.status === 'SKIP').length;
    const blocked = runs.filter((run) => run.status === 'BLOCKED').length;
    const durations = runs.map((run) => run.durationMs).filter((value): value is number => typeof value === 'number');
    const distinctStatuses = new Set(runs.map((run) => run.status));
    const flaky = passes > 0 && failures > 0;
    const lastRun = [...runs].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0]!;
    return {
      testId: lastRun.testId,
      repository: lastRun.repository,
      title: lastRun.title,
      sourceFile: lastRun.sourceFile,
      runs: runs.length,
      passes,
      failures,
      skips,
      blocked,
      passRate: round(passes / runs.length),
      flakeRate: round(distinctStatuses.size > 1 ? Math.min(passes, failures) / runs.length : 0),
      flaky,
      averageDurationMs: durations.length > 0 ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : undefined,
      p95DurationMs: percentile(durations, 95),
      lastStatus: lastRun.status,
      failureClusters: [...new Set(runs.map((run) => run.failureClusterId).filter((value): value is string => Boolean(value)))].sort(),
    };
  }).sort((left, right) => Number(right.flaky) - Number(left.flaky) || right.failures - left.failures || left.testId.localeCompare(right.testId));
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

async function listTestFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 12) return [];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report']);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTestFiles(fullPath, depth + 1));
    else if (/\.(?:spec|test)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

interface PathAlias {
  pattern: string;
  targets: string[];
}

function resolveImport(root: string, sourceFile: string, specifier: string, aliases: PathAlias[]): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(sourceFile), specifier);
  } else {
    const alias = aliases.find((candidate) => {
      if (candidate.pattern.includes('*')) {
        const [prefix, suffix] = candidate.pattern.split('*');
        return specifier.startsWith(prefix ?? '') && specifier.endsWith(suffix ?? '');
      }
      return candidate.pattern === specifier;
    });
    if (alias) {
      const [prefix, suffix] = alias.pattern.split('*');
      const wildcard = alias.pattern.includes('*')
        ? specifier.slice((prefix ?? '').length, specifier.length - (suffix ?? '').length || undefined)
        : '';
      const target = alias.targets[0];
      if (target) base = path.resolve(root, target.replace('*', wildcard));
    }
  }
  if (!base) return undefined;
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map((extension) => `${base}${extension}`),
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map((extension) => path.join(base, `index${extension}`)),
  ];
  const resolved = candidates.find((candidate) => fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile());
  return resolved ? path.relative(root, resolved).replace(/\\/g, '/') : undefined;
}

function extractImportSpecifiers(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value) imports.add(value);
    }
  }
  return [...imports];
}

async function loadPathAliases(root: string): Promise<PathAlias[]> {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  try {
    const raw = await fs.readFile(tsconfigPath, 'utf8');
    const withoutComments = raw.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(withoutComments) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const baseUrl = parsed.compilerOptions?.baseUrl ?? '.';
    return Object.entries(parsed.compilerOptions?.paths ?? {}).map(([pattern, targets]) => ({
      pattern,
      targets: targets.map((target) => path.join(baseUrl, target)),
    }));
  } catch {
    return [];
  }
}

async function collectTransitiveDependencies(root: string, entry: string, aliases: PathAlias[], visited = new Set<string>()): Promise<string[]> {
  const absoluteEntry = path.resolve(entry);
  if (visited.has(absoluteEntry)) return [];
  visited.add(absoluteEntry);

  let source: string;
  try {
    source = await fs.readFile(absoluteEntry, 'utf8');
  } catch {
    return [];
  }

  const dependencies: string[] = [];
  for (const specifier of extractImportSpecifiers(source)) {
    const dependency = resolveImport(root, absoluteEntry, specifier, aliases);
    if (!dependency) continue;
    dependencies.push(dependency);
    const nested = await collectTransitiveDependencies(root, path.resolve(root, dependency), aliases, visited);
    dependencies.push(...nested);
  }
  return [...new Set(dependencies)];
}

/** Discovers test impact metadata from a repository's real test sources. */
export async function discoverTestImpactCandidates(root: string): Promise<TestImpactCandidate[]> {
  const projectRoot = path.resolve(root);
  const files = await listTestFiles(projectRoot);
  const aliases = await loadPathAliases(projectRoot);
  const candidates: TestImpactCandidate[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const dependencies = await collectTransitiveDependencies(projectRoot, file, aliases);
    const relativeSource = path.relative(projectRoot, file).replace(/\\/g, '/');
    const tags = [...new Set([...source.matchAll(/@([A-Za-z][\w-]*)/g)].map((match) => match[1]!.toLowerCase()))].sort();
    candidates.push({
      testId: relativeSource,
      title: relativeSource,
      sourceFile: relativeSource,
      ...(dependencies.length > 0 ? { dependencies } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
  }
  return candidates.sort((left, right) => left.testId.localeCompare(right.testId));
}

/** Builds a deterministic changed-file impact report for a repository. */
export async function analyzeRepositoryImpact(root: string, changedFiles: string[]): Promise<RepositoryImpactAnalysis> {
  const projectRoot = path.resolve(root);
  const candidates = await discoverTestImpactCandidates(projectRoot);
  const normalizedChanged = changedFiles.map((file) => {
    const absolute = path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
    return path.relative(projectRoot, absolute).replace(/\\/g, '/');
  });
  return {
    root: projectRoot,
    changedFiles: [...new Set(normalizedChanged)].sort(),
    candidates,
    impactedTests: selectImpactedTests(normalizedChanged, candidates),
    limitations: [
      'Impact is based on resolved relative/path-alias imports, bounded transitive traversal, directory proximity, and tags.',
      'Package imports and dynamic runtime dependencies require explicit metadata or a future project graph.',
    ],
  };
}

function sameDirectory(left: string, right: string): boolean {
  const leftParts = normalizedPath(left).split('/');
  const rightParts = normalizedPath(right).split('/');
  leftParts.pop();
  rightParts.pop();
  return leftParts.join('/') === rightParts.join('/');
}

export function selectImpactedTests(changedFiles: string[], tests: TestImpactCandidate[]): ImpactedTest[] {
  const changed = changedFiles.map(normalizedPath);
  return tests.flatMap((test) => {
    const source = normalizedPath(test.sourceFile);
    const reasons: string[] = [];
    let confidence: ImpactedTest['confidence'] = 'unknown';
    if (changed.includes(source)) {
      confidence = 'direct';
      reasons.push(`Test source changed: ${test.sourceFile}`);
    } else if (test.dependencies?.some((dependency) => changed.includes(normalizedPath(dependency)))) {
      confidence = 'dependency';
      reasons.push('A declared test dependency changed');
    } else if (changed.some((file) => sameDirectory(file, source))) {
      confidence = 'directory';
      reasons.push('A file in the test source directory changed');
    } else if (test.tags?.some((tag) => changed.some((file) => file.includes(tag.toLowerCase())))) {
      confidence = 'tag';
      reasons.push('A changed path matches a declared test tag');
    }
    return confidence === 'unknown' ? [] : [{ testId: test.testId, title: test.title, sourceFile: test.sourceFile, confidence, reasons }];
  }).sort((left, right) => {
    const rank = { direct: 4, dependency: 3, directory: 2, tag: 1, unknown: 0 };
    return rank[right.confidence] - rank[left.confidence] || left.testId.localeCompare(right.testId);
  });
}

