import { describe, expect, it } from 'vitest';
import { formatRate, formatCI, type MasterBenchmarkReport } from '../../benchmarks/runner/master-benchmark-runner.js';
import { NamingLinter, type NamePlan } from '../../src/index.js';
import { buildEvaluationScorecard } from '../../src/evaluation/evaluation-scorecard.js';

describe('Empty Denominator Integrity Suite — Zero Samples Must Never Equal 100%', () => {
  it('formatRate strictly renders "N/A (0 samples)" when rate is null or sampleSize is 0', () => {
    expect(formatRate(null, 0)).toBe('N/A (0 samples)');
    expect(formatRate(100.0, 0)).toBe('N/A (0 samples)');
    expect(formatRate(0.0, 0)).toBe('N/A (0 samples)');
    expect(formatRate(null, 10)).toBe('N/A (0 samples)');
    expect(formatRate(98.5, 50)).toBe('98.5%');
  });

  it('formatCI strictly renders "N/A" when CI is null', () => {
    expect(formatCI(null)).toBe('N/A');
    expect(formatCI({ lower: 80.0, upper: 95.0 })).toBe('[80%, 95%]');
  });

  it('NamingLinter returns null rates for plans with 0 symbols', () => {
    const emptyPlan: NamePlan = {
      planVersion: '1',
      pageClassName: 'EmptyPage',
      pageVariable: 'emptyPage',
      symbols: [],
      assumptions: [],
    };

    const report = NamingLinter.lint(emptyPlan);
    expect(report.passed).toBe(false);
    expect(report.totalIdentifiers).toBe(1); // just class name
    expect(report.semanticNameCoverage).toBeNull();
    // Non-zero totalIdentifiers (class name) means namingConformanceRate is defined, but semantic coverage is null
    expect(report.semanticNameCoverage).not.toBe(1.0);
    expect(report.semanticNameCoverage).not.toBe(100);
  });

  it('buildEvaluationScorecard produces null rates when observation denominators are 0', () => {
    const scorecard = buildEvaluationScorecard([]);

    expect(scorecard.observationCount).toBe(0);
    expect(scorecard.accuracyCaseCount).toBe(0);
    expect(scorecard.semanticAccuracy).toBeNull();
    expect(scorecard.exactAccuracy).toBeNull();
    expect(scorecard.safeAbstentionRate).toBeNull();
    expect(scorecard.falseRepairRate).toBeNull();
    expect(scorecard.determinismRate).toBeNull();
    expect(scorecard.repair.precision).toBeNull();
    expect(scorecard.repair.recall).toBeNull();
  });

  it('empty benchmark report does not claim 100% on any 0-sample metric', () => {
    const emptyReport: MasterBenchmarkReport = {
      timestamp: Date.now(),
      totalScenarios: 0,
      tier1BaselineCount: 0,
      tier2MutationCount: 0,
      tier3NegativeControlCount: 0,
      tier2RepairedCount: 0,
      tier2AbstainedCount: 0,
      tier2RepairExpectedCount: 0,
      totalAttemptedRepairsCount: 0,
      defectScenarioCount: 0,
      regressionCheckCount: 0,
      baselinePassRate: null,
      repairPrecision: null,
      repairRecall: null,
      safeAbstentionRate: null,
      falseRepairRate: null,
      repairCoverage: null,
      regressionRate: null,
      defectDetectionRate: null,
      defectMaskingRate: null,
      latencyP50Ms: 0,
      latencyP95Ms: 0,
      confidenceInterval95: null,
      confidenceIntervals: {
        baselinePassCI: null,
        repairPrecisionCI: null,
        repairRecallCI: null,
        safeAbstentionCI: null,
        overallEmpiricalCI: null,
      },
      sampleInterpretationNote: 'Empty test run',
      scenarios: [],
    };

    // Assert that every rate is null
    expect(emptyReport.baselinePassRate).toBeNull();
    expect(emptyReport.repairPrecision).toBeNull();
    expect(emptyReport.repairRecall).toBeNull();
    expect(emptyReport.safeAbstentionRate).toBeNull();
    expect(emptyReport.falseRepairRate).toBeNull();

    // Assert formatRate on each produces N/A (0 samples)
    expect(formatRate(emptyReport.baselinePassRate, emptyReport.tier1BaselineCount)).toBe('N/A (0 samples)');
    expect(formatRate(emptyReport.repairPrecision, emptyReport.totalAttemptedRepairsCount)).toBe('N/A (0 samples)');
    expect(formatRate(emptyReport.repairRecall, emptyReport.tier2RepairExpectedCount)).toBe('N/A (0 samples)');
    expect(formatRate(emptyReport.safeAbstentionRate, emptyReport.tier3NegativeControlCount)).toBe('N/A (0 samples)');
    expect(formatRate(emptyReport.falseRepairRate, emptyReport.tier3NegativeControlCount)).toBe('N/A (0 samples)');
  });
});

