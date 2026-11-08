import { describe, expect, it } from 'vitest';
import { AssertionQualityGate } from '../../src/generator/assertion-quality-gate.js';

describe('AssertionQualityGate', () => {
  it('rejects specs with zero assertions', () => {
    const spec = `
test('should complete Task', async ({ page }) => {
  const pageObj = new TaskPage(page);
  await pageObj.goto();
});
`;
    const report = AssertionQualityGate.evaluate(spec, 'Task');
    expect(report.passed).toBe(false);
    expect(report.assertionCount).toBe(0);
    expect(report.violations).toContain('ZERO_ASSERTIONS: Generated spec contains zero expect() assertions.');
  });

  it('rejects specs that only echo the feature name heading', () => {
    const spec = `
test('should complete OrderReview', async ({ page }) => {
  const orderReviewPage = new OrderReviewPage(page);
  await orderReviewPage.goto();
  await expect(page.getByRole('heading', { name: 'OrderReview' })).toBeVisible();
});
`;
    const report = AssertionQualityGate.evaluate(spec, 'OrderReview');
    expect(report.passed).toBe(false);
    expect(report.isVacuousEcho).toBe(true);
    expect(report.violations.some((v) => v.includes('VACUOUS_ECHO_ASSERTION'))).toBe(true);
  });

  it('passes specs with dynamic state assertions', () => {
    const spec = `
test('should complete Task Creation', async ({ taskPage, page }) => {
  await taskPage.fillTaskInput('Buy groceries');
  await taskPage.clickCreate();
  await expect(page.getByText('Buy groceries')).toBeVisible();
  await expect(page.locator('.task-item')).toHaveCount(1);
});
`;
    const report = AssertionQualityGate.evaluate(spec, 'Task Creation');
    expect(report.passed).toBe(true);
    expect(report.assertionCount).toBe(2);
    expect(report.hasStateAssertion).toBe(true);
    expect(report.isVacuousEcho).toBe(false);
    expect(report.violations).toHaveLength(0);
  });
});
