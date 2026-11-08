import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Project } from 'ts-morph';
import { inspectRepository, RepositoryManifest } from '../evaluation/repository-inspector.js';

export const REPOSITORY_PROFILE_VERSION = 1;

export interface IdentifierConventions {
  propertySuffixes: string[];
  methodVerbs: Record<string, number>;
  usesReadonly: boolean;
  pageInjection: 'constructor-param-property' | 'constructor-assignment' | 'getter' | 'inline';
  gotoMethodName: string;
  recommendedLocatorPolicy: 'prefer-role-over-css' | 'prefer-testid' | 'prefer-label' | 'prefer-locator' | 'unknown';
}

export interface PageObjectExemplar {
  filePath: string;
  className: string;
  content: string;
}

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
    /** Test files whose source explicitly references Playwright. */
    playwrightTestFiles?: number | undefined;
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
  pathConfidence?: {
    testDirectory: number;
    pageObjectDirectory: number;
    fixtureDirectory: number;
  } | undefined;
  locatorConventions: {
    getByRole: number;
    getByTestId: number;
    getByLabel: number;
    getByText: number;
    locator: number;
    cssOrXpath: number;
    preferred: 'getByRole' | 'getByTestId' | 'getByLabel' | 'getByText' | 'locator' | 'unknown';
  };
  identifierConventions?: IdentifierConventions | undefined;
  exemplars?: PageObjectExemplar[] | undefined;
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
  if (depth > 6) return [];
  const ignored = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage', 'test-results',
    'playwright-report', '.next', '.turbo', '.pie', '.pw-intelligence',
    'repositories', 'pie-evaluation', 'generation', 'repair-worktrees',
    'temp', 'tmp'
  ]);
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

/** Returns whether a directory has enough project markers to profile safely. */
export async function isLikelyProjectRoot(root: string): Promise<boolean> {
  const projectRoot = path.resolve(root);
  const markers = ['package.json', 'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
  for (const marker of markers) {
    try {
      await fs.access(path.join(projectRoot, marker));
      return true;
    } catch {
      // Try the next project marker.
    }
  }
  return false;
}

/** Detects evaluation/workspace containers that must not be profiled recursively. */
export async function isLikelyRepositoryContainer(root: string): Promise<boolean> {
  const containerNames = new Set(['repositories', 'pie-evaluation', 'generation', 'repair-worktrees', 'generated-test-data']);
  try {
    const entries = await fs.readdir(path.resolve(root), { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && containerNames.has(entry.name));
  } catch {
    return false;
  }
}

function countMatches(contents: string, pattern: RegExp): number {
  return contents.match(pattern)?.length ?? 0;
}

function preferredLocator(counts: Omit<RepositoryConventionProfile['locatorConventions'], 'preferred'>): RepositoryConventionProfile['locatorConventions']['preferred'] {
  // Policy order: role > label > testid > text > locator
  if (counts.getByRole > 0) return 'getByRole';
  if (counts.getByLabel > 0) return 'getByLabel';
  if (counts.getByTestId > 0) return 'getByTestId';
  if (counts.getByText > 0) return 'getByText';
  if (counts.locator > 0) return 'locator';
  return 'unknown';
}

async function sampleIdentifierConventions(
  pomFiles: string[],
  locatorCounts: Omit<RepositoryConventionProfile['locatorConventions'], 'preferred'>
): Promise<IdentifierConventions> {
  const propertySuffixesCount = new Map<string, number>();
  const methodVerbs: Record<string, number> = {};
  let readonlyCount = 0;
  let totalProperties = 0;
  let pageInjection: IdentifierConventions['pageInjection'] = 'constructor-assignment';
  let gotoMethodName = 'goto';

  const knownSuffixes = ['Button', 'Input', 'Link', 'Select', 'Checkbox', 'Dialog', 'Modal', 'Heading', 'Cell', 'Table', 'Tab', 'Radio', 'Status', 'Card'];
  const sampleFiles = pomFiles.slice(0, 5);

  if (sampleFiles.length > 0) {
    try {
      const project = new Project({ useInMemoryFileSystem: true });
      for (const filePath of sampleFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const sourceFile = project.createSourceFile(path.basename(filePath), content, { overwrite: true });

          for (const cls of sourceFile.getClasses()) {
            const ctor = cls.getConstructors()[0];
            if (ctor) {
              const params = ctor.getParameters();
              if (params.some((p) => p.getScope() || p.isReadonly())) {
                pageInjection = 'constructor-param-property';
              }
            }

            for (const prop of cls.getProperties()) {
              totalProperties++;
              if (prop.isReadonly()) readonlyCount++;
              const name = prop.getName();
              for (const suffix of knownSuffixes) {
                if (name.endsWith(suffix)) {
                  propertySuffixesCount.set(suffix, (propertySuffixesCount.get(suffix) ?? 0) + 1);
                }
              }
            }

            for (const getter of cls.getGetAccessors()) {
              const name = getter.getName();
              for (const suffix of knownSuffixes) {
                if (name.endsWith(suffix)) {
                  propertySuffixesCount.set(suffix, (propertySuffixesCount.get(suffix) ?? 0) + 1);
                }
              }
            }

            for (const method of cls.getMethods()) {
              const name = method.getName();
              if (name === 'goto' || name === 'open' || name === 'navigate' || name === 'load') {
                gotoMethodName = name;
              }
              const match = name.match(/^([a-z]+)/);
              if (match) {
                const verb = match[1]!;
                methodVerbs[verb] = (methodVerbs[verb] ?? 0) + 1;
              }
            }
          }
        } catch {
          // Continue to next sample file
        }
      }
    } catch {
      // Fallback
    }
  }

  let recommendedLocatorPolicy: IdentifierConventions['recommendedLocatorPolicy'] = 'unknown';
  if (locatorCounts.getByRole > 0) recommendedLocatorPolicy = 'prefer-role-over-css';
  else if (locatorCounts.getByLabel > 0) recommendedLocatorPolicy = 'prefer-label';
  else if (locatorCounts.getByTestId > 0) recommendedLocatorPolicy = 'prefer-testid';
  else if (locatorCounts.locator > 0) recommendedLocatorPolicy = 'prefer-locator';

  const propertySuffixes = [...propertySuffixesCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  if (propertySuffixes.length === 0) {
    propertySuffixes.push('Button', 'Input');
  }

  return {
    propertySuffixes,
    methodVerbs,
    usesReadonly: totalProperties > 0 ? readonlyCount / totalProperties >= 0.5 : true,
    pageInjection,
    gotoMethodName,
    recommendedLocatorPolicy,
  };
}

export async function sampleExemplars(pomFiles: string[], maxExemplars = 3): Promise<PageObjectExemplar[]> {
  const exemplars: PageObjectExemplar[] = [];
  for (const file of pomFiles.slice(0, maxExemplars)) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split(/\r?\n/).slice(0, 120);
      const match = content.match(/export\s+class\s+([A-Za-z0-9_]+)/);
      const className = match ? match[1]! : path.basename(file, path.extname(file));
      exemplars.push({
        filePath: file,
        className,
        content: lines.join('\n'),
      });
    } catch {}
  }
  return exemplars;
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

function directoryConfidence(filePaths: string[], root: string): number {
  if (filePaths.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const relativeDirectory = path.relative(root, path.dirname(filePath)).replace(/\\/g, '/');
    counts.set(relativeDirectory, (counts.get(relativeDirectory) ?? 0) + 1);
  }
  const strongest = Math.max(...counts.values());
  return Number((strongest / filePaths.length).toFixed(3));
}

function isPlaywrightTestSource(filePath: string, content: string): boolean {
  return /\.(?:spec|test)\.[^.]+$/i.test(filePath) &&
    /(?:@playwright\/test|['"]playwright(?:\/test)?['"]|\b(?:test|expect)\s*\.)/.test(content);
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
  const sourceRecords = await Promise.all(sourceFiles.map(async (file) => {
    try {
      return [file, await fs.readFile(file, 'utf8')] as const;
    } catch {
      return [file, ''] as const;
    }
  }));
  const sourceContents = sourceRecords.map(([, content]) => content).join('\n');
  const locatorCounts = {
    getByRole: countMatches(sourceContents, /\bgetByRole\s*\(/g),
    getByTestId: countMatches(sourceContents, /\bgetByTestId\s*\(/g),
    getByLabel: countMatches(sourceContents, /\bgetByLabel\s*\(/g),
    getByText: countMatches(sourceContents, /\bgetByText\s*\(/g),
    locator: countMatches(sourceContents, /\.(?:locator|frameLocator)\s*\(/g),
    cssOrXpath: countMatches(sourceContents, /(?:xpath=|css=|page\.locator\s*\(\s*['"`][#.\[])/g),
  };
  const testFiles = sourceFiles.filter((file) => /\.(?:spec|test)\.[^.]+$/i.test(file));
  const playwrightTestFiles = sourceRecords
    .filter(([file, content]) => isPlaywrightTestSource(file, content))
    .map(([file]) => file);
  const profileTestFiles = playwrightTestFiles.length > 0
    ? playwrightTestFiles
    : testFiles;
  const pageObjectFiles = sourceFiles.filter((file) => /(?:page|page-object)\.[^.]+$/i.test(file) || /pages?[\\/]/i.test(file));
  const fixtureFiles = sourceFiles.filter((file) => /fixture\.[^.]+$/i.test(file) || /fixtures?[\\/]/i.test(file));
  const tags = [...new Set([...sourceContents.matchAll(/(@[A-Za-z][\w-]*)/g)].map((match) => match[1]!))].sort();
  const evidence: string[] = [];
  if (manifest.pageObjectFiles > 0) evidence.push('Page Object files detected');
  if (manifest.fixtureFiles > 0) evidence.push('Fixture files detected');
  if (/\b(?:request|apiRequestContext|APIRequestContext)\b/i.test(sourceContents)) evidence.push('API/request helpers detected');
  if (/storageState|storage-state/i.test(sourceContents)) evidence.push('Playwright storage state detected');
  if (manifest.playwrightConfigs.length > 0) evidence.push('Playwright configuration detected');
  if (playwrightTestFiles.length > 0) evidence.push(`${playwrightTestFiles.length} Playwright test source(s) detected`);
  else evidence.push('No Playwright test source detected; generic test files were not treated as Playwright conventions');

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
      playwrightTestFiles: playwrightTestFiles.length,
      pageObjectFiles: manifest.pageObjectFiles,
      fixtureFiles: manifest.fixtureFiles,
      configFiles: manifest.playwrightConfigs,
      usesPageObjects: manifest.pageObjectFiles > 0,
      usesCustomFixtures: manifest.fixtureFiles > 0,
      usesApiHelpers: /\b(?:request|apiRequestContext|APIRequestContext)\b/i.test(sourceContents),
      usesStorageState: /storageState|storage-state/i.test(sourceContents),
    },
    paths: {
      testDirectory: mostCommonDirectory(profileTestFiles, path.resolve(root), 'tests'),
      pageObjectDirectory: mostCommonDirectory(pageObjectFiles, path.resolve(root), 'tests/pages'),
      fixtureDirectory: mostCommonDirectory(fixtureFiles, path.resolve(root), 'tests/fixtures'),
    },
    pathConfidence: {
      testDirectory: directoryConfidence(profileTestFiles, path.resolve(root)),
      pageObjectDirectory: directoryConfidence(pageObjectFiles, path.resolve(root)),
      fixtureDirectory: directoryConfidence(fixtureFiles, path.resolve(root)),
    },
    locatorConventions: { ...locatorCounts, preferred: preferredLocator(locatorCounts) },
    identifierConventions: await sampleIdentifierConventions(pageObjectFiles, locatorCounts),
    exemplars: await sampleExemplars(pageObjectFiles, 3),
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
): Promise<{ profile: RepositoryConventionProfile; profilePath: string; conventionsPath: string }> {
  const projectRoot = path.resolve(root);
  const resolvedProfile = profile ?? await buildRepositoryProfile(projectRoot);
  const pieDir = path.join(projectRoot, '.pie');
  await fs.mkdir(pieDir, { recursive: true });

  const profilePath = path.join(pieDir, 'repository-profile.json');
  await fs.writeFile(profilePath, `${JSON.stringify(resolvedProfile, null, 2)}\n`, 'utf8');

  const conventionsPath = path.join(pieDir, 'conventions.json');
  const conventionsData = {
    version: 1,
    generatedAt: resolvedProfile.generatedAt,
    sourceFingerprint: resolvedProfile.sourceFingerprint,
    locatorConventions: resolvedProfile.locatorConventions,
    identifierConventions: resolvedProfile.identifierConventions,
    paths: resolvedProfile.paths,
    structure: resolvedProfile.structure,
  };
  await fs.writeFile(conventionsPath, `${JSON.stringify(conventionsData, null, 2)}\n`, 'utf8');

  return { profile: resolvedProfile, profilePath, conventionsPath };
}
