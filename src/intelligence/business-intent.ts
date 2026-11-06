import { BusinessOracleStatus } from '../core/types/repair-evidence.js';

export interface BusinessIntent {
  id: string;
  title?: string | undefined;
  actions: string[];
  entities: string[];
  expectedOutcomes: string[];
  assertions: string[];
  risk: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  evidenceSources: string[];
}

export interface BusinessOracleContext {
  intent: BusinessIntent;
  originalAssertions?: string[] | undefined;
  currentAssertions?: string[] | undefined;
  observedStates?: Record<string, unknown> | undefined;
  executionPassed: boolean;
}

export interface BusinessOracleResult {
  name: string;
  status: BusinessOracleStatus;
  reason: string;
  evidence: string[];
}

export interface BusinessOracle {
  name: string;
  evaluate(context: BusinessOracleContext): BusinessOracleResult;
}

export interface BuiltInOracleEvaluation {
  status: BusinessOracleStatus;
  results: BusinessOracleResult[];
}

const ACTION_WORDS = ['login', 'logout', 'search', 'create', 'submit', 'save', 'update', 'delete', 'approve', 'reject', 'checkout', 'payment', 'book', 'contact', 'upload', 'download'];
const CRITICAL_WORDS = ['payment', 'checkout', 'delete', 'approve', 'permission', 'authentication', 'login', 'order'];

function words(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))];
}

function riskFor(text: string): BusinessIntent['risk'] {
  const normalized = text.toLowerCase();
  if (CRITICAL_WORDS.some((word) => normalized.includes(word))) return 'critical';
  if (['account', 'profile', 'customer', 'booking'].some((word) => normalized.includes(word))) return 'high';
  if (normalized.length > 0) return 'medium';
  return 'unknown';
}

/** Extracts a conservative intent model from test titles and source text. */
export function extractBusinessIntent(input: { id: string; title?: string; sourceText: string; sourcePath?: string }): BusinessIntent {
  const title = input.title?.trim();
  const combined = `${title ?? ''}\n${input.sourceText}`;
  const lower = combined.toLowerCase();
  const actions = ACTION_WORDS.filter((action) => lower.includes(action));
  const assertions = [...input.sourceText.matchAll(/expect(?:\.soft|\.poll)?\([^\n]{0,240}/g)].map((match) => match[0]!.trim()).slice(0, 50);
  const expectedOutcomes = [...input.sourceText.matchAll(/(?:toBe|toEqual|toContainText|toHaveText|toBeVisible|toBeHidden|toHaveURL)\s*\([^\n]{0,160}/g)].map((match) => match[0]!.trim()).slice(0, 50);
  const titleWords = words(title ?? '');
  const entities = [...new Set(titleWords.filter((word) => !ACTION_WORDS.includes(word)))].slice(0, 20);
  return {
    id: input.id,
    title,
    actions,
    entities,
    expectedOutcomes,
    assertions,
    risk: riskFor(combined),
    evidenceSources: [
      ...(title ? ['test-title'] : []),
      ...(assertions.length > 0 ? ['test-assertions'] : []),
      ...(input.sourcePath ? [input.sourcePath] : []),
    ],
  };
}

export class BusinessOracleRegistry {
  private readonly oracles: BusinessOracle[] = [];

  public register(oracle: BusinessOracle): void {
    if (this.oracles.some((existing) => existing.name === oracle.name)) {
      throw new Error(`Business oracle '${oracle.name}' is already registered`);
    }
    this.oracles.push(oracle);
  }

  public evaluate(context: BusinessOracleContext): BusinessOracleResult[] {
    return this.oracles.map((oracle) => oracle.evaluate(context));
  }
}

export const AssertionPreservationOracle: BusinessOracle = {
  name: 'assertion-preservation',
  evaluate(context): BusinessOracleResult {
    if (!context.originalAssertions || !context.currentAssertions) {
      return {
        name: 'assertion-preservation',
        status: 'unavailable',
        reason: 'Original and current assertion evidence were not supplied',
        evidence: [],
      };
    }
    const original = JSON.stringify(context.originalAssertions);
    const current = JSON.stringify(context.currentAssertions);
    const preserved = original === current;
    return {
      name: 'assertion-preservation',
      status: preserved ? 'verified' : 'contradicted',
      reason: preserved ? 'Business assertions are unchanged' : 'Business assertion evidence changed',
      evidence: [`Original assertions: ${context.originalAssertions.length}`, `Current assertions: ${context.currentAssertions.length}`],
    };
  },
};

export const ExecutionOracle: BusinessOracle = {
  name: 'execution-success',
  evaluate(context): BusinessOracleResult {
    return {
      name: 'execution-success',
      status: context.executionPassed ? 'verified' : 'contradicted',
      reason: context.executionPassed ? 'Target execution passed' : 'Target execution did not pass',
      evidence: [`Intent risk: ${context.intent.risk}`, `Expected outcomes: ${context.intent.expectedOutcomes.length}`],
    };
  },
};

/**
 * Evaluates the evidence PIE can prove locally for an isolated repair.
 * This deliberately does not claim domain truth such as whether a payment
 * was actually captured; domain-specific adapters can add that later.
 */
export function evaluateBuiltInBusinessOracles(input: {
  intent: BusinessIntent;
  originalSourceText?: string | undefined;
  currentSourceText?: string | undefined;
  executionPassed: boolean;
}): BuiltInOracleEvaluation {
  const registry = new BusinessOracleRegistry();
  registry.register(AssertionPreservationOracle);
  registry.register(ExecutionOracle);

  const results = registry.evaluate({
    intent: input.intent,
    originalAssertions: input.originalSourceText === undefined
      ? undefined
      : extractBusinessIntent({ id: `${input.intent.id}:original`, sourceText: input.originalSourceText }).assertions,
    currentAssertions: input.currentSourceText === undefined
      ? undefined
      : extractBusinessIntent({ id: `${input.intent.id}:current`, sourceText: input.currentSourceText }).assertions,
    executionPassed: input.executionPassed,
  });

  const status: BusinessOracleStatus = results.some((result) => result.status === 'contradicted')
    ? 'contradicted'
    : results.length > 0 && results.every((result) => result.status === 'verified')
      ? 'verified'
      : 'unavailable';

  return { status, results };
}
