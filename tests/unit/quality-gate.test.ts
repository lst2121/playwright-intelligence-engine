import { describe, expect, it } from 'vitest';
import { evaluateQualityGate } from '../../src/integrations/quality-gate.js';

describe('PIE quality gates', () => {
  it('fails on critical clusters or failed repairs', () => {
    const report = evaluateQualityGate({
      clusters: [{
        clusterId: 'critical',
        fingerprint: { key: 'critical', category: 'BACKEND_500', action: 'click', messageSignature: 'server', networkSignature: '500' },
        count: 1,
        observationIds: ['1'],
        affectedRepositories: ['shop'],
        affectedTests: ['checkout'],
        representative: { id: '1', category: 'BACKEND_500' },
        severity: 'critical',
        evidenceConsistency: 1,
      }],
      failedRepairs: 1,
    });
    expect(report.status).toBe('FAIL');
    expect(report.reasons).toHaveLength(2);
  });

  it('abstains when risk evidence is incomplete', () => {
    const report = evaluateQualityGate({ requiredOracleUnavailable: 1, stability: [{
      testId: 'flaky', runs: 2, passes: 1, failures: 1, skips: 0, blocked: 0, passRate: 0.5, flakeRate: 0.5, flaky: true, lastStatus: 'FAIL', failureClusters: [],
    }] });
    expect(report.status).toBe('ABSTAIN');
    expect(report.flakyTests).toBe(1);
  });
});
