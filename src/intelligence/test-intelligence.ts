import { BusinessIntent, extractBusinessIntent } from './business-intent.js';

export interface RequirementInput {
  id: string;
  title: string;
  description?: string | undefined;
  tags?: string[] | undefined;
}

export interface ExistingTestInput {
  id: string;
  title?: string | undefined;
  sourceFile?: string | undefined;
  sourceText: string;
  fixtureNames?: string[] | undefined;
  pageObjectNames?: string[] | undefined;
}

export interface PlannedTestScenario {
  id: string;
  requirementId: string;
  title: string;
  intent: BusinessIntent;
  requiredFixtures: string[];
  preferredPageObjects: string[];
}

export interface CoverageMatch {
  scenarioId: string;
  status: 'covered' | 'partial' | 'missing';
  score: number;
  matchedTestIds: string[];
  reasons: string[];
}

export interface DuplicateTestGroup {
  testIds: string[];
  similarity: number;
  reason: string;
}

export interface TestIntelligencePlan {
  scenarios: PlannedTestScenario[];
  coverage: CoverageMatch[];
  missingScenarios: string[];
  highRiskScenarios: string[];
  duplicateTests: DuplicateTestGroup[];
}

function tokens(intent: BusinessIntent): Set<string> {
  return new Set([...intent.actions, ...intent.entities, ...intent.expectedOutcomes]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

function similarity(left: BusinessIntent, right: BusinessIntent): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function inferFixtures(requirement: RequirementInput): string[] {
  const text = `${requirement.title} ${requirement.description ?? ''}`.toLowerCase();
  return ['auth', 'authenticated', 'login', 'permission', 'admin'].some((term) => text.includes(term)) ? ['authenticatedPage'] : [];
}

function inferPageObjects(intent: BusinessIntent): string[] {
  return intent.entities.slice(0, 3).map((entity) => `${entity[0]!.toUpperCase()}${entity.slice(1)}Page`);
}

function scenarioFor(requirement: RequirementInput): PlannedTestScenario {
  const intent = extractBusinessIntent({
    id: requirement.id,
    title: requirement.title,
    sourceText: requirement.description ?? requirement.title,
  });
  return {
    id: `scenario-${requirement.id}`,
    requirementId: requirement.id,
    title: requirement.title,
    intent,
    requiredFixtures: inferFixtures(requirement),
    preferredPageObjects: inferPageObjects(intent),
  };
}

export function buildTestIntelligencePlan(
  requirements: RequirementInput[],
  existingTests: ExistingTestInput[] = [],
): TestIntelligencePlan {
  const scenarios = requirements.map(scenarioFor);
  const indexedTests = existingTests.map((test) => ({
    test,
    intent: extractBusinessIntent({
      id: test.id,
      sourceText: test.sourceText,
      ...(test.title !== undefined ? { title: test.title } : {}),
      ...(test.sourceFile !== undefined ? { sourcePath: test.sourceFile } : {}),
    }),
  }));
  const coverage = scenarios.map((scenario) => {
    const matches = indexedTests.map((candidate) => ({ ...candidate, score: similarity(scenario.intent, candidate.intent) }))
      .filter((candidate) => candidate.score >= 0.25)
      .sort((left, right) => right.score - left.score);
    const best = matches[0]?.score ?? 0;
    const status: CoverageMatch['status'] = best >= 0.7 ? 'covered' : best >= 0.4 ? 'partial' : 'missing';
    const reasons = status === 'missing'
      ? ['No existing test shares enough intent evidence']
      : [`Best intent similarity: ${best.toFixed(3)}`, ...(matches[0]?.test.fixtureNames?.length ? [`Uses fixture(s): ${matches[0].test.fixtureNames.join(', ')}`] : [])];
    return {
      scenarioId: scenario.id,
      status,
      score: Number(best.toFixed(3)),
      matchedTestIds: matches.slice(0, 3).map((match) => match.test.id),
      reasons,
    };
  });

  const duplicateTests: DuplicateTestGroup[] = [];
  for (let leftIndex = 0; leftIndex < indexedTests.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < indexedTests.length; rightIndex += 1) {
      const score = similarity(indexedTests[leftIndex]!.intent, indexedTests[rightIndex]!.intent);
      if (score >= 0.8) duplicateTests.push({ testIds: [indexedTests[leftIndex]!.test.id, indexedTests[rightIndex]!.test.id], similarity: Number(score.toFixed(3)), reason: 'Tests have highly overlapping action, entity, and assertion intent.' });
    }
  }

  return {
    scenarios,
    coverage,
    missingScenarios: coverage.filter((entry) => entry.status === 'missing').map((entry) => entry.scenarioId),
    highRiskScenarios: scenarios.filter((scenario) => scenario.intent.risk === 'critical' || scenario.intent.risk === 'high').map((scenario) => scenario.id),
    duplicateTests,
  };
}
