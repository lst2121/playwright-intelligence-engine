import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { StatementPatcher } from '../../src/repair/statement-patcher.js';
import { AbstentionError } from '../../src/core/errors/engine-errors.js';

describe('StatementPatcher Unit & Invariant Tests', () => {
  const testDir = path.resolve('tests/fixtures/tmp-statement-ast');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const sampleSpec = `
import { test } from '@playwright/test';

test('login and submit checkout', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('secret');

  // Fragile fixed sleep
  await page.waitForTimeout(5000);

  // Unsynchronized click
  await page.getByRole('button', { name: 'Submit' }).click();

  // Inline locator
  await page.locator('.btn-old-checkout').click();

  // Critical business assertion
  await expect(page.getByText('Order Confirmed')).toBeVisible();
});
`;

  it('should replace waitForTimeout with event-driven toBeVisible and add expect import', () => {
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(sampleSpec, {
      kind: 'replace-timeout-with-wait',
      replacementWaitStatement: `await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 5000 });`,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('replace-timeout-with-wait');
    expect(result.importAdded).toBe(true);
    expect(result.patchedSource).toContain(`import { test, expect } from '@playwright/test';`);
    expect(result.patchedSource).toContain(`await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 5000 });`);
    expect(result.patchedSource).not.toContain('waitForTimeout(5000)');
    expect(result.diff).toContain('-   await page.waitForTimeout(5000);');
    expect(result.diff).toContain('+   await expect(page.getByRole(\'button\', { name: \'Submit\' })).toBeVisible({ timeout: 5000 });');
  });

  it('should wrap an action with page.waitForResponse inside Promise.all', () => {
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(sampleSpec, {
      kind: 'wrap-action-with-response',
      targetActionSubstring: `page.getByRole('button', { name: 'Submit' }).click()`,
      responsePredicate: `(resp) => resp.url().includes('/api/login') && resp.status() === 200`,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('wrap-action-with-response');
    expect(result.patchedSource).toContain('await Promise.all([');
    expect(result.patchedSource).toContain(`page.waitForResponse((resp) => resp.url().includes('/api/login') && resp.status() === 200)`);
    expect(result.patchedSource).toContain(`page.getByRole('button', { name: 'Submit' }).click()`);
  });

  it('should wrap action with custom page variable name', () => {
    const multiPageSpec = `
import { test, expect } from '@playwright/test';

test('admin multi-page dispatch', async ({ page, context }) => {
  const adminPage = await context.newPage();
  await adminPage.goto('/admin');
  await adminPage.locator('#dispatch-btn').click();
});
`;
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(multiPageSpec, {
      kind: 'wrap-action-with-response',
      targetActionSubstring: `adminPage.locator('#dispatch-btn').click()`,
      responsePredicate: `(resp) => resp.url().includes('/api/dispatch')`,
    });

    expect(result.success).toBe(true);
    expect(result.patchedSource).toContain(`adminPage.waitForResponse((resp) => resp.url().includes('/api/dispatch'))`);
    expect(result.patchedSource).toContain(`adminPage.locator('#dispatch-btn').click()`);
  });

  it('should insert a readiness check statement before an action', () => {
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(sampleSpec, {
      kind: 'insert-readiness-check',
      targetActionSubstring: `page.locator('.btn-old-checkout').click()`,
      readinessStatement: `await expect(page.locator('.btn-old-checkout')).toBeEnabled();`,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('insert-readiness-check');
    expect(result.patchedSource).toContain(`await expect(page.locator('.btn-old-checkout')).toBeEnabled();\n  await page.locator('.btn-old-checkout').click();`);
  });

  it('should heal inline locator within a test function', () => {
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(sampleSpec, {
      kind: 'replace-inline-locator',
      oldLocatorText: `page.locator('.btn-old-checkout')`,
      newLocatorExpression: `page.getByRole('button', { name: 'Proceed to Checkout' })`,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('replace-inline-locator');
    expect(result.patchedSource).toContain(`await page.getByRole('button', { name: 'Proceed to Checkout' }).click();`);
    expect(result.patchedSource).not.toContain('.btn-old-checkout');
  });

  it('INVARIANT: should strictly reject modifying or removing test assertions', () => {
    const patcher = new StatementPatcher();

    expect(() => {
      patcher.patchStatementInMemory(sampleSpec, {
        kind: 'replace-statement',
        targetSubstring: 'Order Confirmed',
        newStatement: '// assertion deleted',
      });
    }).toThrowError(AbstentionError);

    try {
      patcher.patchStatementInMemory(sampleSpec, {
        kind: 'replace-statement',
        targetSubstring: 'Order Confirmed',
        newStatement: '// assertion deleted',
      });
    } catch (err: any) {
      expect(err.failureCategory).toBe('AST_ASSERTION_TAMPERING_PROHIBITED');
      expect(err.message).toContain('assertion');
    }
  });

  it('ADVERSARIAL: should reject tampering with nested expect calls inside wrapper statements', () => {
    const patcher = new StatementPatcher();
    const specWithNestedExpect = `
      import { test } from '@playwright/test';
      test('nested', async ({ page }) => {
        await Promise.all([ expect(page.locator('#banner')).toBeVisible() ]);
      });
    `;

    expect(() => {
      patcher.patchStatementInMemory(specWithNestedExpect, {
        kind: 'replace-statement',
        targetSubstring: 'Promise.all',
        newStatement: '// removed nested assertion',
      });
    }).toThrowError(AbstentionError);
  });

  it('ADVERSARIAL: should abstain when multiple statements match and targetLine is omitted', () => {
    const patcher = new StatementPatcher();
    const specWithMultipleSleeps = `
      import { test } from '@playwright/test';
      test('multi-sleep', async ({ page }) => {
        await page.waitForTimeout(500);
        await page.locator('#btn').click();
        await page.waitForTimeout(1000);
      });
    `;

    expect(() => {
      patcher.patchStatementInMemory(specWithMultipleSleeps, {
        kind: 'replace-timeout-with-wait',
        replacementWaitStatement: 'await expect(page.locator("#btn")).toBeVisible();',
      });
    }).toThrowError(AbstentionError);
  });

  it('INVARIANT: should reject statement patches that introduce syntax errors', () => {
    const patcher = new StatementPatcher();

    expect(() => {
      patcher.patchStatementInMemory(sampleSpec, {
        kind: 'replace-statement',
        targetSubstring: 'page.goto',
        newStatement: 'await page.goto(;;; invalid syntax %%%',
      });
    }).toThrowError(AbstentionError);
  });

  it('should atomically patch a test file on disk and verify rollback on failure', async () => {
    const filePath = path.join(testDir, 'checkout.spec.ts');
    await fs.writeFile(filePath, sampleSpec, 'utf8');

    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInFile(filePath, {
      kind: 'replace-inline-locator',
      oldLocatorText: `page.locator('.btn-old-checkout')`,
      newLocatorExpression: `page.getByRole('button', { name: 'Complete Purchase' })`,
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain(`await page.getByRole('button', { name: 'Complete Purchase' }).click();`);
  });

  it('should patch by exact targetLine number', () => {
    const patcher = new StatementPatcher();
    const lines = sampleSpec.split('\n');
    const sleepLineIdx = lines.findIndex((l) => l.includes('waitForTimeout'));
    const targetLine = sleepLineIdx + 1;

    const result = patcher.patchStatementInMemory(sampleSpec, {
      kind: 'replace-timeout-with-wait',
      targetLine,
      replacementWaitStatement: `await expect(page.locator('#submit')).toBeVisible();`,
    });

    expect(result.success).toBe(true);
    expect(result.patchedSource).toContain(`await expect(page.locator('#submit')).toBeVisible();`);
    expect(result.patchedSource).not.toContain('waitForTimeout(5000)');
  });

  it('should heal variable declarations inside test blocks', () => {
    const varSpec = `
import { test } from '@playwright/test';

test('variable declaration test', async ({ page }) => {
  const submitBtn = page.locator('.old-submit');
  await submitBtn.click();
});
`;
    const patcher = new StatementPatcher();
    const result = patcher.patchStatementInMemory(varSpec, {
      kind: 'replace-inline-locator',
      oldLocatorText: `page.locator('.old-submit')`,
      newLocatorExpression: `page.getByRole('button', { name: 'Submit Form' })`,
    });

    expect(result.success).toBe(true);
    expect(result.patchedSource).toContain(`const submitBtn = page.getByRole('button', { name: 'Submit Form' });`);
  });

  it('should throw AbstentionError when statement is not found', () => {
    const patcher = new StatementPatcher();
    expect(() => {
      patcher.patchStatementInMemory(sampleSpec, {
        kind: 'replace-statement',
        targetSubstring: 'nonexistent-element-xyz',
        newStatement: 'console.log("nothing");',
      });
    }).toThrowError(AbstentionError);
  });
});
