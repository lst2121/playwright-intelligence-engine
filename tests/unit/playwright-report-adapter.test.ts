import { describe, expect, it } from 'vitest';
import { buildCiEvidenceReport, parsePlaywrightJsonReport } from '../../src/integrations/playwright-report-adapter.js';
import { buildSarifReport } from '../../src/integrations/sarif-report.js';

const report = {
  suites: [{
    title: 'Authentication',
    file: 'tests/auth.spec.ts',
    specs: [{
      title: 'user can sign in',
      tests: [{
        projectName: 'chromium',
        results: [
          { status: 'failed', duration: 120, retry: 0, error: { message: 'expect(received).toBeVisible()' } },
          { status: 'passed', duration: 90, retry: 1 },
        ],
      }],
    }],
  }],
};

describe('Playwright JSON report adapter', () => {
  it('normalizes nested Playwright results into PIE observations', () => {
    const parsed = parsePlaywrightJsonReport(report, { repository: 'shop', runId: 'run-1', timestamp: 123 });
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0]).toMatchObject({ status: 'FAIL', repository: 'shop', sourceFile: 'tests/auth.spec.ts', retryIndex: 0 });
    expect(parsed.failures).toHaveLength(1);
    expect(parsed.failures[0]).toMatchObject({ category: 'TEST_FAILURE', testTitle: 'Authentication › user can sign in' });
  });

  it('builds deterministic CI evidence, cluster output, and a failing gate', () => {
    const evidence = buildCiEvidenceReport(report, { repository: 'shop', runId: 'run-1', timestamp: 123 });
    expect(evidence.clusters).toHaveLength(1);
    expect(evidence.stability[0]).toMatchObject({ flaky: true, failures: 1, passes: 1 });
    expect(evidence.qualityGate.status).toBe('FAIL');
    expect(evidence.markdown).toContain('PIE CI result: FAIL');
    expect(evidence.annotations[0]).toContain('::error');
  });

  it('emits SARIF rules and results for code-scanning integrations', () => {
    const evidence = buildCiEvidenceReport(report, { repository: 'shop', runId: 'run-1', timestamp: 123 });
    const sarif = buildSarifReport(evidence, 'test-version');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.tool.driver.name).toBe('PIE');
    expect(sarif.runs[0]?.tool.driver.version).toBe('test-version');
    expect(sarif.runs[0]?.results.some((result) => result.ruleId === 'PIE-QUALITY-GATE')).toBe(true);
    expect(sarif.runs[0]?.results.some((result) => result.ruleId.startsWith('PIE-TEST_FAILURE'))).toBe(true);
  });
});
