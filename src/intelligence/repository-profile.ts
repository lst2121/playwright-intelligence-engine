import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectRepository, RepositoryManifest } from '../evaluation/repository-inspector.js';

export const REPOSITORY_PROFILE_VERSION = 1;

export interface RepositoryConventionProfile {
  version: typeof REPOSITORY_PROFILE_VERSION;
  generatedAt: string;
  /** Fingerprint of source paths and metadata used to detect convention drift. */
  sourceFingerprint?: string | undefined;
  repository: {
    name: string;
    root: string;
    packageManager: RepositoryManifest['packageManager'];
    playwrightVersion?: string | undefined;
    scripts: Record<string, string>;
  };
  structure: {
    testFiles: number;
    pageObjectFiles: number;
    fixtureFiles: number;
    configFiles: string[];
    usesPageObjects: boolean;
    usesCustomFixtures: boolean;
    usesApiHelpers: boolean;
    usesStorageState: boolean;
  };
  paths?: {
    testDirectory?: string | undefined;
    pageObjectDirectory?: string | undefined;
    fixtureDirectory?: string | undefined;
  };
  locatorConventions: {
    getByRole: number;
    getByTestId: number;
    getByLabel: number;
    getByText: number;
    locator: number;
    cssOrXpath: number;
    preferred: 'getByRole' | 'getByTestId' | 'getByLabel' | 'getByText' | 'locator' | 'unknown';
  };
  testConventions: {
    tags: string[];
    usesDescribeBlocks: boolean;
    usesTestSteps: boolean;
    usesAssertions: boolean;
  };
  domainTerms: string[];
  evidence: string[];
}

async function listSourceFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 10) return [];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.next']);
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
    if (entry.isDirectory()) files.push(...await listSourceFiles(fullPath, depth + 1));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function countMatches(contents: string, pattern: RegExp): number {
  return contents.match(pattern)?.length ?? 0;
}

function preferredLocator(counts: Omit<RepositoryConventionProfile['locatorConventions'], 'preferred'>): RepositoryConventionProfile['locatorConventions']['preferred'] {
  const ranked: Array<[RepositoryConventionProfile['locatorConventions']['preferred'], number]> = [
    ['getByRole', counts.getByRole],
    ['getByTestId', counts.getByTestId],
    ['getByLabel', counts.getByLabel],
    ['getByText', counts.getByText],
    ['locator', counts.locator],
  ];
  ranked.sort((left, right) => right[1] - left[1]);
  const winner = ranked[0];
  return winner && winner[1] > 0 ? winner[0] : 'unknown';
}

function extractDomainTerms(filePaths: string[], contents: string): string[] {
  const ignored = new Set(['test', 'tests', 'spec', 'page', 'pages', 'fixture', 'fixtures', 'should', 'be', 'able', 'to', 'the', 'and', 'with', 'from', 'for', 'using', 'login', 'user']);
  const terms = new Map<string, number>();
  const candidates = [
    ...filePaths.flatMap((file) => path.basename(file).replace(/\.(?:spec|test)\.[^.]+$/i, '').split(/[^A-Za-z0-9]+/)),
    ...contents.match(/[A-Z][A-Za-z0-9]{3,}/g) ?? [],
  ];
  for (const candidate of candidates) {
    const term = candidate.toLowerCase();
    if (!ignored.has(term) && /^[a-z][a-z0-9-]{3,}$/.test(term)) terms.set(term, (terms.get(term) ?? 0) + 1);
  }
  return [...terms.entries()].sort((left, right) => right[1] - left[1]).slice(0, 30).map(([term]) => term);
}

function mostCommonDirectory(filePaths: string[], root: string, fallback: string): string {
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const relativeDirectory = path.relative(root, path.dirname(filePath)).replace(/\\/g, '/');
    const directory = relativeDirectory && relativeDirectory !== '.' ? relativeDirectory : fallback;
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return winner?.[0] ?? fallback;
}

/** Computes a cheap change detector without rereading source contents. */
export async function computeRepositoryProfileFingerprint(root: string): Promise<string> {
  const projectRoot = path.resolve(root);
  const sourceFiles = await listSourceFiles(projectRoot);
  const hash = crypto.createHash('sha256');
  for (const filePath of sourceFiles.sort()) {
    try {
      const stat = await fs.stat(filePath);
      hash.update(path.relative(projectRoot, filePath).replace(/\\/g, '/'));
      hash.update(`\0${stat.size}:${stat.mtimeMs}\0`);
    } catch {
      hash.update(`${path.relative(projectRoot, filePath).replace(/\\/g, '/')}\0missing\0`);
    }
  }
  return hash.digest('hex');
}

export async function buildRepositoryProfile(root: string, now = new Date()): Promise<RepositoryConventionProfile> {
  const manifest = await inspectRepository(root);
  const sourceFiles = await listSourceFiles(path.resolve(root));
  const sourceFingerprint = await computeRepositoryProfileFingerprint(root);
  const sourceContents = (await Promise.all(sourceFiles.map(async (file) => {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return '';
    }
  }))).join('\n');
  const locatorCounts = {
    getByRole: countMatches(sourceContents, /\bgetByRole\s*\(/g),
    getByTestId: countMatches(sourceContents, /\bgetByTestId\s*\(/g),
    getByLabel: countMatches(sourceContents, /\bgetByLabel\s*\(/g),
    getByText: countMatches(sourceContents, /\bgetByText\s*\(/g),
    locator: countMatches(sourceContents, /\.(?:locator|frameLocator)\s*\(/g),
    cssOrXpath: countMatches(sourceContents, /(?:xpath=|css=|page\.locator\s*\(\s*['"`][#.\[])/g),
  };
  const testFiles = sourceFiles.filter((file) => /\.(?:spec|test)\.[^.]+$/i.test(file));
  const pageObjectFiles = sourceFiles.filter((file) => /(?:page|page-object)\.[^.]+$/i.test(file) || /pages?[\\/]/i.test(file));
  const fixtureFiles = sourceFiles.filter((file) => /fixture\.[^.]+$/i.test(file) || /fixtures?[\\/]/i.test(file));
  const tags = [...new Set([...sourceContents.matchAll(/(@[A-Za-z][\w-]*)/g)].map((match) => match[1]!))].sort();
  const evidence: string[] = [];
  if (manifest.pageObjectFiles > 0) evidence.push('Page Object files detected');
  if (manifest.fixtureFiles > 0) evidence.push('Fixture files detected');
  if (/\b(?:request|apiRequestContext|APIRequestContext)\b/i.test(sourceContents)) evidence.push('API/request helpers detected');
  if (/storageState|storage-state/i.test(sourceContents)) evidence.push('Playwright storage state detected');
  if (manifest.playwrightConfigs.length > 0) evidence.push('Playwright configuration detected');

  return {
    version: REPOSITORY_PROFILE_VERSION,
    generatedAt: now.toISOString(),
    sourceFingerprint,
    repository: {
      name: manifest.name,
      root: manifest.root,
      packageManager: manifest.packageManager,
      playwrightVersion: manifest.playwrightVersion,
      scripts: manifest.scripts,
    },
    structure: {
      testFiles: manifest.testFiles,
      pageObjectFiles: manifest.pageObjectFiles,
      fixtureFiles: manifest.fixtureFiles,
      configFiles: manifest.playwrightConfigs,
      usesPageObjects: manifest.pageObjectFiles > 0,
      usesCustomFixtures: manifest.fixtureFiles > 0,
      usesApiHelpers: /\b(?:request|apiRequestContext|APIRequestContext)\b/i.test(sourceContents),
      usesStorageState: /storageState|storage-state/i.test(sourceContents),
    },
    paths: {
      testDirectory: mostCommonDirectory(testFiles, path.resolve(root), 'tests'),
      pageObjectDirectory: mostCommonDirectory(pageObjectFiles, path.resolve(root), 'tests/pages'),
      fixtureDirectory: mostCommonDirectory(fixtureFiles, path.resolve(root), 'tests/fixtures'),
    },
    locatorConventions: { ...locatorCounts, preferred: preferredLocator(locatorCounts) },
    testConventions: {
      tags,
      usesDescribeBlocks: /\btest\.describe\s*\(/.test(sourceContents),
      usesTestSteps: /\btest\.step\s*\(/.test(sourceContents),
      usesAssertions: /\bexpect\s*\(/.test(sourceContents),
    },
    domainTerms: extractDomainTerms(sourceFiles, sourceContents),
    evidence,
  };
}

export async function writeRepositoryProfile(
  root: string,
  profile?: RepositoryConventionProfile,
): Promise<{ profile: RepositoryConventionProfile; profilePath: string }> {
  const projectRoot = path.resolve(root);
  const resolvedProfile = profile ?? await buildRepositoryProfile(projectRoot);
  const profilePath = path.join(projectRoot, '.pie', 'repository-profile.json');
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(profilePath, `${JSON.stringify(resolvedProfile, null, 2)}\n`, 'utf8');
  return { profile: resolvedProfile, profilePath };
}
