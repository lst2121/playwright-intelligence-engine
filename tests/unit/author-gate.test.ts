import { describe, expect, it } from 'vitest';
import { runGate, SafetyGate, QualityGate, OracleGate } from '../../src/gate/index.js';
import { NamePlanner } from '../../src/authoring/naming/name-planner.js';
import { TemplateAuthor } from '../../src/authoring/template-author.js';
import { HybridAuthor } from '../../src/authoring/hybrid-author.js';

describe('Author / Gate Architecture Suite', () => {
  it('QualityGate rejects index-derived names and accepts semantic names', () => {
    const invalidPlan = {
      planVersion: '1' as const,
      pageClassName: 'CheckoutPage',
      pageVariable: 'checkoutPage',
      symbols: [
        {
          ref: 'step-1',
          role: 'button',
          property: 'actionButton1',
          method: 'clickActionButton1',
          verb: 'click',
          confidence: 0.9,
          source: 'heuristic' as const,
          assumptions: [],
        },
      ],
      assumptions: [],
    };
    const invalidResult = QualityGate.evaluate({ symbols: invalidPlan });
    expect(invalidResult.passed).toBe(false);
    expect(invalidResult.violations.some((v) => v.includes('actionButton1'))).toBe(true);

    const validPlan = NamePlanner.planNames('Checkout', [
      { action: 'fill', role: 'textbox', name: 'Email' },
      { action: 'click', role: 'button', name: 'Submit Order' },
    ]);
    const validResult = QualityGate.evaluate({ symbols: validPlan });
    expect(validResult.passed).toBe(true);
    expect(validResult.violations).toHaveLength(0);
  });

  it('QualityGate detects duplicate selectors in Page Object', () => {
    const content = `
export class LoginPage {
  constructor(page: Page) {
    this.email = this.page.getByRole('textbox', { name: 'Email' });
    this.duplicateEmail = this.page.getByRole('textbox', { name: 'Email' });
  }
}
`;
    const result = QualityGate.evaluate({
      files: [{ relativePath: 'pages/LoginPage.ts', content }],
    });
    expect(result.passed).toBe(false);
    expect(result.duplicateSelectors).toHaveLength(1);
    expect(result.violations[0]).toContain('Duplicate selector');
  });

  it('QualityGate catches assertion strength downgrade (toHaveText -> toBeVisible)', () => {
    const orig = "await expect(page.locator('.status')).toHaveText('Order confirmed');";
    const patched = "await expect(page.locator('.status')).toBeVisible();";
    const result = QualityGate.evaluate({
      originalSource: orig,
      patchedSource: patched,
    });
    expect(result.passed).toBe(false);
    expect(result.assertionStrengthPassed).toBe(false);
    expect(result.violations[0]).toContain('Assertion strength regression');
  });

  it('OracleGate marks missing business intent oracles as unavailable, never verified', () => {
    const result = OracleGate.evaluate({
      oracles: [{ id: 'order-created', name: 'Order in DB', verified: false, required: true }],
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe('unavailable');
    expect(result.reasons[0]).toContain('Required business oracle');
  });

  it('runGate evaluates safety, quality, and oracle independently', async () => {
    const templateAuthor = new TemplateAuthor();
    const candidate = await templateAuthor.propose({
      featureName: 'User Profile',
      mode: 'greenfield',
      steps: [
        { action: 'fill', role: 'textbox', name: 'Full Name', value: 'Alice' },
        { action: 'click', role: 'button', name: 'Save Changes' },
      ],
    });

    const gateEvaluation = runGate({
      safety: {
        compilationPassed: true,
        testsPassed: true,
        isolatedExecution: true,
        assertionsPreserved: true,
        diffMinimal: true,
      },
      quality: {
        symbols: candidate.symbols,
        files: candidate.files,
      },
      oracle: {
        oracles: [{ id: 'profile-saved', name: 'Profile Saved', verified: true, required: true }],
      },
    });

    expect(gateEvaluation.passed).toBe(true);
    expect(gateEvaluation.verdict).toBe('APPROVED');
    expect(gateEvaluation.safety.passed).toBe(true);
    expect(gateEvaluation.quality.passed).toBe(true);
    expect(gateEvaluation.oracle.passed).toBe(true);
  });
});
