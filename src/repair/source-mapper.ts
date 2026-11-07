import fs from 'node:fs/promises';
import path from 'node:path';
import { FailedAction } from '../core/types/diagnostic-context.js';
import { StaticAstCollector, ExtractedLocatorAst } from '../collectors/static-ast-collector.js';

export interface RepairSourceMapping {
  testFilePath: string;
  pomFilePath: string;
  className: string;
  memberName: string;
  confidence: number;
  evidence: string[];
}

interface AstPayload {
  isPageObject?: boolean;
  locators?: ExtractedLocatorAst[];
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

function normalize(value: string): string {
  return value.replace(/\s+/g, '').replace(/;$/, '');
}

function selectorMatches(selector: string, locator: ExtractedLocatorAst): { score: number; evidence: string[] } | undefined {
  const wanted = normalize(selector);
  const source = normalize(locator.selectorText);
  if (!wanted || !source) return undefined;

  if (source.includes(wanted)) {
    return { score: 100, evidence: ['Failed selector expression matched a Page Object locator expression'] };
  }

  // Trace formats sometimes emit only the locator argument (for example
  // "#submit") instead of the full page.locator("#submit") expression.
  const argumentMatch = source.match(/(?:locator|getByRole|getByText|getByTestId|getByLabel|getByPlaceholder|getByAltText|getByTitle)\((.*)\)/);
  if (argumentMatch?.[1] && (argumentMatch[1].includes(wanted) || wanted.includes(argumentMatch[1]))) {
    return { score: 80, evidence: ['Failed selector value matched a Page Object locator argument'] };
  }
  return undefined;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Trace source locations frequently point at a disposable checkout used by
 * Playwright. Resolve that location back into the active repository only when
 * the suffix identifies exactly one source file; never guess between twins.
 */
function resolveTestSourcePath(root: string, sourceFiles: string[], sourceFile: string | undefined): { path?: string; remapped: boolean } {
  if (!sourceFile) return { remapped: false };
  const resolved = path.resolve(root, sourceFile);
  const inside = path.relative(root, resolved);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    const exact = sourceFiles.find((file) => path.resolve(file) === resolved);
    if (exact) return { path: exact, remapped: false };
  }

  const wanted = normalizedPath(sourceFile);
  const suffixMatches = sourceFiles.filter((file) => {
    const candidate = normalizedPath(path.relative(root, file));
    return wanted.endsWith(`/${candidate}`) || candidate.endsWith(`/${wanted}`) || candidate === wanted;
  });
  if (suffixMatches.length === 1 && suffixMatches[0]) return { path: suffixMatches[0], remapped: true };

  const basename = path.basename(sourceFile).toLowerCase();
  const basenameMatches = sourceFiles.filter((file) => path.basename(file).toLowerCase() === basename);
  return basenameMatches.length === 1 && basenameMatches[0]
    ? { path: basenameMatches[0], remapped: true }
    : { remapped: false };
}

/**
 * Finds a unique Page Object locator for a failed trace action. This is
 * intentionally selector-based and fail-closed; it does not infer a class or
 * member from naming conventions when the selector evidence is absent.
 */
export async function discoverRepairSourceMapping(input: {
  workspaceRoot: string;
  failedAction: FailedAction;
}): Promise<RepairSourceMapping | undefined> {
  const root = path.resolve(input.workspaceRoot);
  const selector = input.failedAction.selector?.trim();
  if (!selector) return undefined;
  const normalizedSelector = normalize(selector);
  const sourceFiles = await listSourceFiles(root);
  const resolvedTestSource = resolveTestSourcePath(root, sourceFiles, input.failedAction.sourceFile);
  if (input.failedAction.sourceFile && !resolvedTestSource.path) return undefined;
  const matches: Array<RepairSourceMapping & { score: number }> = [];

  for (const filePath of sourceFiles) {
    // Avoid parsing every source file in large repositories. AST inspection is
    // reserved for files containing the failed selector text.
    let sourceText: string;
    try {
      sourceText = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    if (!normalize(sourceText).includes(normalizedSelector)) continue;
    const result = await new StaticAstCollector().collect({ targetFilePath: filePath });
    const payload = result[0]?.payload as AstPayload | undefined;
    if (!payload?.isPageObject || !payload.locators) continue;
    for (const locator of payload.locators) {
      if (!locator.className || locator.pattern === 'inline') continue;
      const matched = selectorMatches(input.failedAction.selector ?? '', locator);
      if (!matched) continue;
      matches.push({
        testFilePath: resolvedTestSource.path ?? '',
        pomFilePath: filePath,
        className: locator.className,
        memberName: locator.propertyName,
        confidence: matched.score / 100,
        evidence: [
          ...matched.evidence,
          ...(resolvedTestSource.remapped ? ['Trace source path remapped to the unique active-repository source file'] : []),
          `Page Object member ${locator.className}.${locator.propertyName}`,
          `Source location ${path.relative(root, filePath)}:${locator.line}`,
        ],
        score: matched.score,
      });
    }
  }

  if (matches.length === 0) return undefined;
  const unique = [...new Map(matches.map((match) => [`${match.pomFilePath}:${match.className}:${match.memberName}`, match])).values()];
  if (unique.length !== 1) return undefined;
  const match = unique[0]!;
  if (!match.testFilePath || !path.extname(match.testFilePath)) return undefined;
  return match;
}
