import { normalizeFailureCategory } from '../diagnostics/failure-category.js';

export interface EvaluationObservation {
  id?: string | undefined;
  repository?: string | undefined;
  expectedCategory?: string | undefined;
  predictedCategory?: string | undefined;
  pieNormalizedCategory?: string | undefined;
  isGroundTruthVerified?: boolean | undefined;
  isPrimaryMutationTrace?: boolean | undefined;
  testType?: string | undefined;
  shouldAbstain?: boolean | undefined;
  actionOutcome?: string | undefined;
  isDeterministic?: boolean | undefined;
  durationMs?: number | undefined;
  meanDurationMs?: number | undefined;
  evaluationRole?: 'primary' | 'negative-control' | 'baseline' | undefined;
  repairExpected?: boolean | undefined;
  repairSucceeded?: boolean | undefined;
  falseRepair?: boolean | undefined;
}

export interface CategoryMetrics {
  support: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface EvaluationScorecard {
  observationCount: number;
  accuracyCaseCount: number;
  exactMatches: number;
  semanticAccuracy: number;
  exactAccuracy: number;
  confusionMatrix: Record<string, Record<string, number>>;
  perCategory: Record<string, CategoryMetrics>;
  negativeControlCount: number;
  correctSafeAbstentions: number;
  unsafeRepairRecommendations: number;
  safeAbstentionRate: number;
  falseRepairRate: number;
  deterministicCount: number;
  determinismRate: number;
  latency: {
    count: number;
    minMs?: number | undefined;
    meanMs?: number | undefined;
    medianMs?: number | undefined;
    p95Ms?: number | undefined;
    maxMs?: number | undefined;
  };
  repair: {
    eligible: number;
    succeeded: number;
    precision: number;
    recall: number;
    falseRepairs: number;
  };
  byRepository: Record<string, {
    observations: number;
    accuracyCases: number;
    exactMatches: number;
    semanticAccuracy: number;
    safeAbstentionRate: number;
    meanLatencyMs?: number;
  }>;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(values: number[], percentileValue: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function roleOf(observation: EvaluationObservation): 'primary' | 'negative-control' | 'baseline' | undefined {
  if (observation.evaluationRole) return observation.evaluationRole;
  if (observation.isPrimaryMutationTrace || observation.testType === 'BASELINE_FAILURE') return 'primary';
  if (observation.testType === 'BASELINE_PASS') return 'baseline';
  const expected = normalizeFailureCategory(observation.expectedCategory);
  if (['BACKEND_500', 'AUTH_EXPIRED', 'ENVIRONMENT_FAILURE', 'DISABLED_ELEMENT', 'OBSTRUCTED_ELEMENT', 'UNSUPPORTED_TRACE_FORMAT'].includes(expected)) {
    return 'negative-control';
  }
  return undefined;
}

function categoryOf(value: string | undefined): string {
  return normalizeFailureCategory(value);
}

function metricFor(category: string, expected: string[], predicted: string[]): CategoryMetrics {
  const support = expected.filter((value) => value === category).length;
  const truePositives = expected.filter((value, index) => value === category && predicted[index] === category).length;
  const falsePositives = expected.filter((value, index) => value !== category && predicted[index] === category).length;
  const falseNegatives = expected.filter((value, index) => value === category && predicted[index] !== category).length;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  return {
    support,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: round(precision),
    recall: round(recall),
    f1Score: round(precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0),
  };
}

export function buildEvaluationScorecard(observations: EvaluationObservation[]): EvaluationScorecard {
  const accuracyObservations = observations.filter((observation) => observation.isGroundTruthVerified !== false && roleOf(observation) === 'primary');
  const expected = accuracyObservations.map((observation) => categoryOf(observation.expectedCategory));
  const predicted = accuracyObservations.map((observation) => categoryOf(observation.predictedCategory ?? observation.pieNormalizedCategory));
  const categories = [...new Set([...expected, ...predicted])].sort();
  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const expectedCategory of categories) {
    confusionMatrix[expectedCategory] = {};
    for (const predictedCategory of categories) confusionMatrix[expectedCategory]![predictedCategory] = 0;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const row = confusionMatrix[expected[index]!];
    if (row) row[predicted[index]!] = (row[predicted[index]!] ?? 0) + 1;
  }

  const negativeControls = observations.filter((observation) => roleOf(observation) === 'negative-control' || roleOf(observation) === 'baseline');
  const correctSafeAbstentions = negativeControls.filter((observation) => observation.shouldAbstain === true && observation.actionOutcome !== 'REPAIR').length;
  const unsafeRepairRecommendations = negativeControls.filter((observation) => observation.shouldAbstain === false || observation.actionOutcome === 'REPAIR' || observation.falseRepair === true).length;
  const latencies = observations.map((observation) => observation.meanDurationMs ?? observation.durationMs).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const deterministicCount = observations.filter((observation) => observation.isDeterministic !== false).length;
  const repairObservations = observations.filter((observation) => observation.repairExpected === true || observation.repairSucceeded === true || observation.falseRepair === true);
  const eligibleRepairs = repairObservations.filter((observation) => observation.repairExpected === true).length;
  const successfulRepairs = repairObservations.filter((observation) => observation.repairExpected === true && observation.repairSucceeded === true).length;
  const falseRepairs = repairObservations.filter((observation) => observation.falseRepair === true).length;

  const byRepository: EvaluationScorecard['byRepository'] = {};
  for (const observation of observations) {
    const repository = observation.repository ?? 'unknown';
    const current = byRepository[repository] ?? { observations: 0, accuracyCases: 0, exactMatches: 0, semanticAccuracy: 0, safeAbstentionRate: 1 };
    current.observations += 1;
    if (roleOf(observation) === 'primary' && observation.isGroundTruthVerified !== false) {
      current.accuracyCases += 1;
      if (categoryOf(observation.expectedCategory) === categoryOf(observation.predictedCategory ?? observation.pieNormalizedCategory)) current.exactMatches += 1;
    }
    const latency = observation.meanDurationMs ?? observation.durationMs;
    if (typeof latency === 'number') current.meanLatencyMs = ((current.meanLatencyMs ?? 0) * (current.observations - 1) + latency) / current.observations;
    byRepository[repository] = current;
  }
  for (const summary of Object.values(byRepository)) {
    summary.semanticAccuracy = summary.accuracyCases > 0 ? round(summary.exactMatches / summary.accuracyCases) : 0;
    if (summary.meanLatencyMs !== undefined) summary.meanLatencyMs = round(summary.meanLatencyMs);
  }

  return {
    observationCount: observations.length,
    accuracyCaseCount: accuracyObservations.length,
    exactMatches: expected.filter((value, index) => value === predicted[index]).length,
    semanticAccuracy: round(expected.length > 0 ? expected.filter((value, index) => value === predicted[index]).length / expected.length : 0),
    exactAccuracy: round(expected.length > 0 ? expected.filter((value, index) => value === predicted[index]).length / expected.length : 0),
    confusionMatrix,
    perCategory: Object.fromEntries(categories.map((category) => [category, metricFor(category, expected, predicted)])),
    negativeControlCount: negativeControls.length,
    correctSafeAbstentions,
    unsafeRepairRecommendations,
    safeAbstentionRate: round(negativeControls.length > 0 ? correctSafeAbstentions / negativeControls.length : 1),
    falseRepairRate: round(negativeControls.length > 0 ? unsafeRepairRecommendations / negativeControls.length : 0),
    deterministicCount,
    determinismRate: round(observations.length > 0 ? deterministicCount / observations.length : 1),
    latency: {
      count: latencies.length,
      minMs: latencies.length > 0 ? Math.min(...latencies) : undefined,
      meanMs: latencies.length > 0 ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : undefined,
      medianMs: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      maxMs: latencies.length > 0 ? Math.max(...latencies) : undefined,
    },
    repair: {
      eligible: eligibleRepairs,
      succeeded: successfulRepairs,
      precision: successfulRepairs + falseRepairs > 0 ? round(successfulRepairs / (successfulRepairs + falseRepairs)) : 1,
      recall: eligibleRepairs > 0 ? round(successfulRepairs / eligibleRepairs) : 0,
      falseRepairs,
    },
    byRepository,
  };
}
