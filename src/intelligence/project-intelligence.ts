import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRepositoryProfile, computeRepositoryProfileFingerprint, isLikelyProjectRoot, isLikelyRepositoryContainer, RepositoryConventionProfile } from './repository-profile.js';
import { effectiveReliabilityScore, StabilityLedger, StabilityLedgerData, RepairFeedbackOutcome } from '../memory/stability-ledger.js';

export interface ProjectIntelligenceSnapshot {
  projectRoot: string;
  profile?: RepositoryConventionProfile | undefined;
  ledger: StabilityLedgerData;
}

async function readProfile(projectRoot: string): Promise<RepositoryConventionProfile | undefined> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, '.pie', 'repository-profile.json'), 'utf8');
    return JSON.parse(raw) as RepositoryConventionProfile;
  } catch {
    return undefined;
  }
}

/** Loads project-scoped memory without requiring a cloud service or model. */
export async function loadProjectIntelligence(projectRoot = process.cwd()): Promise<ProjectIntelligenceSnapshot> {
  const root = path.resolve(projectRoot);
  const ledger = new StabilityLedger(root);
  await ledger.init();
  return {
    projectRoot: root,
    profile: await readProfile(root),
    ledger: ledger.getSnapshot(),
  };
}

/**
 * Resolves the small set of equivalent Playwright page-property prefixes that
 * appear when a selector moves between a Page Object and a generated ranking
 * expression. The locator itself remains unchanged; only the lookup key is
 * normalized for project memory.
 */
function selectorLookupVariants(selector: string): string[] {
  const trimmed = selector.trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  const pageProperty = /^(?:this\.)?(?:page|_page|browserPage)\b/;
  if (pageProperty.test(trimmed)) {
    variants.add(trimmed.replace(pageProperty, 'page'));
    variants.add(trimmed.replace(pageProperty, 'this.page'));
  }
  return [...variants];
}

/** Creates a profile once, then returns the same project-scoped intelligence snapshot. */
export async function bootstrapProjectIntelligence(projectRoot = process.cwd()): Promise<ProjectIntelligenceSnapshot> {
  const root = path.resolve(projectRoot);
  const profilePath = path.join(root, '.pie', 'repository-profile.json');
  const existing = await readProfile(root);
  if (!existing && !(await isLikelyProjectRoot(root)) && (await isLikelyRepositoryContainer(root))) {
    // Evaluation and workspace containers are not repositories. Avoid
    // recursively profiling every child repository when invoked from one.
    return loadProjectIntelligence(root);
  }
  let profile = existing;
  let shouldWrite = false;
  if (!profile) {
    profile = await buildRepositoryProfile(root);
    shouldWrite = true;
  } else if (!profile.sourceFingerprint) {
    // Migrate profiles created before source-change detection was introduced.
    profile = await buildRepositoryProfile(root);
    shouldWrite = true;
  } else {
    const currentFingerprint = await computeRepositoryProfileFingerprint(root);
    if (currentFingerprint !== profile.sourceFingerprint) {
      profile = await buildRepositoryProfile(root);
      shouldWrite = true;
    }
  }
  if (shouldWrite) {
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  }
  const snapshot = await loadProjectIntelligence(root);
  return { ...snapshot, profile };
}

export function getHistoricalSelectorScore(snapshot: ProjectIntelligenceSnapshot | undefined, selector: string): number | undefined {
  if (!snapshot) return undefined;
  for (const variant of selectorLookupVariants(selector)) {
    const score = snapshot.ledger.selectors[variant]?.reliabilityScore;
    if (score !== undefined) return score;
  }
  return undefined;
}

/** Reads project memory with time decay for ranking while retaining raw history for audit. */
export function getDecayedHistoricalSelectorScore(snapshot: ProjectIntelligenceSnapshot | undefined, selector: string, now = Date.now()): number | undefined {
  if (!snapshot) return undefined;
  for (const variant of selectorLookupVariants(selector)) {
    const record = snapshot.ledger.selectors[variant];
    if (record) return effectiveReliabilityScore(record, now);
  }
  return undefined;
}

export function shouldLearnFromFailure(category: string): boolean {
  return new Set(['LOCATOR_DRIFT', 'AMBIGUOUS_MATCH', 'TIMING_RACE', 'DYNAMIC_CONTENT_SLOW']).has(category);
}

export async function recordProjectFailure(
  projectRoot: string,
  selector: string | undefined,
  category: string,
): Promise<void> {
  if (!selector || !shouldLearnFromFailure(category)) return;
  const ledger = new StabilityLedger(path.resolve(projectRoot));
  await ledger.init();
  await ledger.recordFailure(selector, category);
}

/** Records a selector that passed semantic and isolated execution checks. */
export async function recordProjectSemanticVerification(projectRoot: string, selector: string | undefined): Promise<void> {
  if (!selector) return;
  const ledger = new StabilityLedger(path.resolve(projectRoot));
  await ledger.init();
  await ledger.recordSemanticVerification(selector);
}

/** Records that an operator accepted a verified repair for this project. */
export async function recordProjectRepairAccepted(projectRoot: string, selector: string | undefined): Promise<void> {
  if (!selector) return;
  const ledger = new StabilityLedger(path.resolve(projectRoot));
  await ledger.init();
  await ledger.recordRepairAccepted(selector);
}

export async function recordProjectRepairFeedback(projectRoot: string, selector: string | undefined, outcome: RepairFeedbackOutcome): Promise<void> {
  if (!selector) return;
  const ledger = new StabilityLedger(path.resolve(projectRoot));
  await ledger.init();
  await ledger.recordRepairFeedback(selector, outcome);
}
