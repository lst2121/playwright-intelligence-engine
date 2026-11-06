import { describe, expect, it } from 'vitest';
import { compileSafeRepairOperation } from '../../src/repair/safe-operation-compiler.js';

describe('safe repair operation compiler', () => {
  it('compiles frame scope into an allowlisted locator proposal', () => {
    const result = compileSafeRepairOperation({
      kind: 'add_frame_scope',
      target: "this.page.getByRole('button', { name: 'Pay' })",
      frameLocator: 'iframe[title="Payment"]',
    });
    expect(result.readiness).toBe('READY_FOR_ISOLATED_VERIFICATION');
    expect(result.replacementLocator).toContain("this.page.frameLocator('iframe[title=\"Payment\"]').getByRole");
  });

  it('compiles open shadow scope without allowing dynamic code', () => {
    const result = compileSafeRepairOperation({
      kind: 'add_shadow_scope',
      target: "this.page.locator('payment-widget')",
      shadowPath: ['checkout-form', 'button[part="submit"]'],
    });
    expect(result.readiness).toBe('READY_FOR_ISOLATED_VERIFICATION');
    expect(result.replacementLocator).toContain(".locator('checkout-form')");
  });

  it('keeps browser-dependent workflow operations proposal-only', () => {
    const result = compileSafeRepairOperation({
      kind: 'dismiss_overlay',
      locator: "this.page.getByRole('button', { name: 'Close' })",
    });
    expect(result.readiness).toBe('PROPOSAL_ONLY');
  });

  it('abstains from unsafe dynamic expressions', () => {
    const result = compileSafeRepairOperation({
      kind: 'replace_locator',
      target: 'Checkout.pay',
      locator: 'this.page.evaluate(() => process.env.SECRET)',
    });
    expect(result.readiness).toBe('ABSTAIN');
  });
});
