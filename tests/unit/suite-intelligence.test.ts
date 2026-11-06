import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRepositoryImpact, analyzeTestStability, selectImpactedTests, TestRunObservation } from '../../src/intelligence/suite-intelligence.js';

describe('suite intelligence', () => {
  it('identifies flaky tests and duration percentiles', () => {
    const records: TestRunObservation[] = [
      { runId: '1', testId: 'checkout', title: 'checkout works', sourceFile: 'tests/checkout.spec.ts', status: 'PASS', durationMs: 100, timestamp: 1 },
      { runId: '2', testId: 'checkout', title: 'checkout works', sourceFile: 'tests/checkout.spec.ts', status: 'FAIL', durationMs: 300, timestamp: 2, failureClusterId: 'failure-a' },
      { runId: '3', testId: 'checkout', title: 'checkout works', sourceFile: 'tests/checkout.spec.ts', status: 'PASS', durationMs: 200, timestamp: 3 },
      { runId: '4', testId: 'login', title: 'login works', sourceFile: 'tests/login.spec.ts', status: 'PASS', durationMs: 50, timestamp: 1 },
    ];
    const summaries = analyzeTestStability(records);
    expect(summaries[0]?.testId).toBe('checkout');
    expect(summaries[0]?.flaky).toBe(true);
    expect(summaries[0]?.passRate).toBe(0.667);
    expect(summaries[0]?.failureClusters).toEqual(['failure-a']);
    expect(summaries[0]?.p95DurationMs).toBe(300);
  });

  it('selects direct, dependency, and directory impacted tests', () => {
    const impacted = selectImpactedTests(
      ['src/checkout/service.ts', 'tests/login.spec.ts'],
      [
        { testId: 'login', title: 'login', sourceFile: 'tests/login.spec.ts' },
        { testId: 'checkout', title: 'checkout', sourceFile: 'tests/checkout.spec.ts', dependencies: ['src/checkout/service.ts'] },
        { testId: 'checkout-ui', title: 'checkout ui', sourceFile: 'tests/checkout-ui.spec.ts' },
        { testId: 'profile', title: 'profile', sourceFile: 'tests/profile.spec.ts' },
      ],
    );
    expect(impacted.map((test) => [test.testId, test.confidence])).toEqual([
      ['login', 'direct'],
      ['checkout', 'dependency'],
      ['checkout-ui', 'directory'],
      ['profile', 'directory'],
    ]);
  });

  it('discovers real test imports and selects impacted tests from a repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-impact-'));
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    await fs.writeFile(path.join(root, 'pages', 'CheckoutPage.ts'), 'export class CheckoutPage {}', 'utf8');
    await fs.writeFile(
      path.join(root, 'tests', 'checkout.spec.ts'),
      `import { CheckoutPage } from '../pages/CheckoutPage';\n// @checkout\ntest('checkout', async () => {});`,
      'utf8',
    );
    await fs.writeFile(path.join(root, 'tests', 'login.spec.ts'), `test('login', async () => {});`, 'utf8');

    const report = await analyzeRepositoryImpact(root, ['pages/CheckoutPage.ts']);
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates.find((candidate) => candidate.testId === 'tests/checkout.spec.ts')?.dependencies).toEqual(['pages/CheckoutPage.ts']);
    expect(report.impactedTests).toMatchObject([{ testId: 'tests/checkout.spec.ts', confidence: 'dependency' }]);
    expect(report.impactedTests.some((test) => test.testId === 'tests/login.spec.ts')).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves tsconfig path aliases and transitive fixture dependencies', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-impact-alias-'));
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    await fs.mkdir(path.join(root, 'fixtures'), { recursive: true });
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }), 'utf8');
    await fs.writeFile(path.join(root, 'fixtures', 'test.ts'), `export { CheckoutPage } from '@/pages/CheckoutPage';`, 'utf8');
    await fs.writeFile(path.join(root, 'pages', 'CheckoutPage.ts'), `import { checkoutData } from '@/fixtures/data'; export class CheckoutPage {}`, 'utf8');
    await fs.writeFile(path.join(root, 'fixtures', 'data.ts'), `export const checkoutData = { total: 10 };`, 'utf8');
    await fs.writeFile(path.join(root, 'tests', 'checkout.spec.ts'), `import { CheckoutPage } from '@/fixtures/test'; test('checkout', async () => {});`, 'utf8');

    const report = await analyzeRepositoryImpact(root, ['fixtures/data.ts']);
    expect(report.candidates[0]?.dependencies).toEqual(['fixtures/test.ts', 'pages/CheckoutPage.ts', 'fixtures/data.ts']);
    expect(report.impactedTests[0]).toMatchObject({ testId: 'tests/checkout.spec.ts', confidence: 'dependency' });
    await fs.rm(root, { recursive: true, force: true });
  });
});
