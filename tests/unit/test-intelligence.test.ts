import { describe, expect, it } from 'vitest';
import { buildTestIntelligencePlan } from '../../src/intelligence/test-intelligence.js';

describe('requirement-to-test intelligence', () => {
  it('identifies covered, missing, high-risk, and duplicate scenarios', () => {
    const plan = buildTestIntelligencePlan(
      [
        { id: 'checkout', title: 'Checkout payment', description: 'A customer can submit payment and see an order confirmation.' },
        { id: 'admin-delete', title: 'Admin delete account', description: 'An authenticated admin can delete a customer account.' },
      ],
      [
        { id: 'checkout-a', title: 'checkout payment', sourceText: 'test("checkout payment", async () => { await page.getByRole("button", { name: "Submit payment" }).click(); await expect(page.getByText("order confirmation")).toBeVisible(); });', fixtureNames: ['authenticatedPage'] },
        { id: 'checkout-b', title: 'checkout payment duplicate', sourceText: 'test("checkout payment duplicate", async () => { await page.getByRole("button", { name: "Submit payment" }).click(); await expect(page.getByText("order confirmation")).toBeVisible(); });' },
      ],
    );

    expect(plan.coverage.find((entry) => entry.scenarioId === 'scenario-checkout')?.status).toBe('covered');
    expect(plan.missingScenarios).toContain('scenario-admin-delete');
    expect(plan.highRiskScenarios).toContain('scenario-checkout');
    expect(plan.highRiskScenarios).toContain('scenario-admin-delete');
    expect(plan.duplicateTests[0]?.testIds).toEqual(['checkout-a', 'checkout-b']);
  });
});
