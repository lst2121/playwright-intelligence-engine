import { describe, expect, it } from 'vitest';
import { buildEvaluationScorecard } from '../../src/evaluation/evaluation-scorecard.js';

describe('evaluation scorecard', () => {
  it('normalizes aliases and produces accuracy, abstention, latency, and repository metrics', () => {
    const scorecard = buildEvaluationScorecard([
      { id: 'primary-1', repository: 'shop', evaluationRole: 'primary', isGroundTruthVerified: true, expectedCategory: 'BACKEND_ERROR', predictedCategory: 'BACKEND_500', meanDurationMs: 100, isDeterministic: true },
      { id: 'primary-2', repository: 'shop', evaluationRole: 'primary', isGroundTruthVerified: true, expectedCategory: 'LOCATOR_DRIFT', predictedCategory: 'LOCATOR_DRIFT', meanDurationMs: 200, isDeterministic: true },
      { id: 'negative-1', repository: 'shop', evaluationRole: 'negative-control', expectedCategory: 'AUTHENTICATION_ERROR', predictedCategory: 'AUTH_EXPIRED', shouldAbstain: true, actionOutcome: 'ABSTAIN', isDeterministic: true, meanDurationMs: 300 },
      { id: 'negative-2', repository: 'shop', evaluationRole: 'negative-control', expectedCategory: 'BACKEND_ERROR', predictedCategory: 'LOCATOR_DRIFT', shouldAbstain: false, actionOutcome: 'REPAIR', isDeterministic: true, meanDurationMs: 400 },
    ]);

    expect(scorecard.accuracyCaseCount).toBe(2);
    expect(scorecard.exactMatches).toBe(2);
    expect(scorecard.semanticAccuracy).toBe(1);
    expect(scorecard.perCategory.BACKEND_500?.support).toBe(1);
    expect(scorecard.negativeControlCount).toBe(2);
    expect(scorecard.safeAbstentionRate).toBe(0.5);
    expect(scorecard.falseRepairRate).toBe(0.5);
    expect(scorecard.latency.meanMs).toBe(250);
    expect(scorecard.byRepository.shop?.observations).toBe(4);
  });
});
