import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ConfigAdapter } from '../../src/framework/config-adapter.js';
import { RepairPlanner } from '../../src/repair/repair-planner.js';
import { AstPatcher } from '../../src/repair/ast-patcher.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Phase 2 Framework Adapters & Repair Planner Tests', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-phase2');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should parse a playwright.config.ts file statically', async () => {
    const configContent = `
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests',
  timeout: 45000,
  retries: 2,
  use: {
    trace: 'retain-on-failure',
  },
});
`;
    const configPath = path.join(tmpDir, 'playwright.config.ts');
    await fs.writeFile(configPath, configContent, 'utf8');

    const summary = ConfigAdapter.parseConfig(configPath);
    expect(summary.testDir).toBe('./e2e-tests');
    expect(summary.timeoutMs).toBe(45000);
    expect(summary.retries).toBe(2);
    expect(summary.traceSetting).toBe('retain-on-failure');

    const override = ConfigAdapter.generateVerificationOverride(configPath);
    expect(override).toContain('retries: 0');
    expect(override).toContain('workers: 1');
    expect(override).toContain("trace: 'retain-on-failure'");
  });

  it('should plan and execute an intent-preserving AST repair producing complete evidence provenance', async () => {
    const pomContent = `
import { Page, Locator } from '@playwright/test';
export class CheckoutPage {
  readonly page: Page;
  readonly checkoutBtn: Locator;
  constructor(page: Page) {
    this.page = page;
    this.checkoutBtn = page.locator('.btn-old-checkout');
  }
}
`;
    const specContent = `
import { test, expect } from '@playwright/test';
test('checkout order', async ({ page }) => {
  await expect(page.locator('.header')).toBeVisible();
  await expect(page.locator('.total')).toHaveText('$120.00');
});
`;

    const pomPath = path.join(tmpDir, 'CheckoutPage.ts');
    const specPath = path.join(tmpDir, 'checkout.spec.ts');
    await fs.writeFile(pomPath, pomContent, 'utf8');
    await fs.writeFile(specPath, specContent, 'utf8');

    const candidateElement: ResolvedElement = {
      tag: 'button',
      attributes: { class: 'oxd-button oxd-button--secondary' },
      text: 'Complete Checkout',
      children: [],
      role: 'button',
      accessibleName: 'Complete Checkout',
    };

    const evidence = RepairPlanner.planAndExecute({
      originalActionId: 'call@205',
      originalSelector: '.btn-old-checkout',
      candidateElement,
      candidateScore: 0.94,
      testFilePath: specPath,
      pomFilePath: pomPath,
      className: 'CheckoutPage',
      memberName: 'checkoutBtn',
      intendedAction: 'click',
      worktreeId: 'repair-worktree-alpha',
    });

    expect(evidence.candidateSelector).toContain("getByRole('button', { name: 'Complete Checkout' })");
    expect(evidence.assertionFingerprint).toBeDefined();
    expect(evidence.verificationWorktreeId).toBe('repair-worktree-alpha');

    // Apply authorized patch using AstPatcher to verify AST surgical modification
    const patcher = new AstPatcher();
    const patchResult = patcher.patchPageObject({
      filePath: pomPath,
      className: 'CheckoutPage',
      memberName: 'checkoutBtn',
      replacementExpression: evidence.candidateSelector,
    });
    expect(patchResult.pattern).toBe('constructor-assignment');

    // Confirm file was updated with user-centric getByRole
    const updatedPom = await fs.readFile(pomPath, 'utf8');
    expect(updatedPom).toContain("getByRole('button', { name: 'Complete Checkout' })");

    // Confirm spec file assertions remain untouched
    const specAfter = await fs.readFile(specPath, 'utf8');
    expect(specAfter).toBe(specContent);
  });

  it('should preserve an allowlisted explicit frame-scoped locator in the proposal', async () => {
    const pomPath = path.join(tmpDir, 'PaymentPage.ts');
    const specPath = path.join(tmpDir, 'payment.spec.ts');
    await fs.writeFile(pomPath, `export class PaymentPage { readonly submit = this.page.getByRole('button', { name: 'Pay' }); }`, 'utf8');
    await fs.writeFile(specPath, `import { test } from '@playwright/test'; test('payment', async () => {});`, 'utf8');

    const proposal = RepairPlanner.planRepair({
      originalActionId: 'call@frame',
      originalSelector: "this.page.getByRole('button', { name: 'Pay' })",
      candidateElement: {
        tag: 'button', attributes: {}, text: 'Pay', children: [], role: 'button', accessibleName: 'Pay',
      },
      candidateScore: 0.9,
      testFilePath: specPath,
      pomFilePath: pomPath,
      className: 'PaymentPage',
      memberName: 'submit',
      intendedAction: 'click',
      replacementSelector: "this.page.frameLocator('iframe[title=\"Payment\"]').getByRole('button', { name: 'Pay' })",
    });

    expect(proposal.replacementSelector).toContain('frameLocator');
    expect(proposal.proposedPatchedSource).toContain('frameLocator');
  });
});

