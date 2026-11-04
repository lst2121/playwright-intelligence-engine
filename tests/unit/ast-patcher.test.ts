import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AstPatcher } from '../../src/repair/ast-patcher.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import { AbstentionError } from '../../src/core/errors/engine-errors.js';

describe('AstPatcher & AssertionHasher Unit Tests', () => {
  const testDir = path.resolve('tests/fixtures/tmp-ast');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const samplePom = `
import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  // Pattern 1: Property Initializer
  readonly usernameInput = this.page.locator('#user-name');

  // Pattern 3: Constructor assignment
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.submitButton = page.locator('button.btn-login');
  }

  // Pattern 2: Getter method
  get errorMessage(): Locator {
    return this.page.locator('.error-message-container');
  }

  // Parameterized helper (Should trigger ABSTAIN)
  rowByUsername(username: string): Locator {
    return this.page.locator(\`tr:has-text("\${username}")\`);
  }
}
`;

  it('should patch a Property Initializer locator cleanly', async () => {
    const filePath = path.join(testDir, 'LoginPage.ts');
    await fs.writeFile(filePath, samplePom, 'utf8');

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'LoginPage',
      memberName: 'usernameInput',
      replacementExpression: `this.page.getByRole('textbox', { name: 'Username' })`,
    });

    expect(result.success).toBe(true);
    expect(result.pattern).toBe('property-initializer');
    expect(result.originalExpression).toBe("this.page.locator('#user-name')");

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain(`this.page.getByRole('textbox', { name: 'Username' })`);
  });

  it('should patch a Getter locator cleanly', async () => {
    const filePath = path.join(testDir, 'LoginPage.ts');
    await fs.writeFile(filePath, samplePom, 'utf8');

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'LoginPage',
      memberName: 'errorMessage',
      replacementExpression: `this.page.getByRole('alert')`,
    });

    expect(result.success).toBe(true);
    expect(result.pattern).toBe('getter-return');

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain(`return this.page.getByRole('alert');`);
  });

  it('should patch a Constructor Assignment locator cleanly', async () => {
    const filePath = path.join(testDir, 'LoginPage.ts');
    await fs.writeFile(filePath, samplePom, 'utf8');

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'LoginPage',
      memberName: 'submitButton',
      replacementExpression: `page.getByRole('button', { name: 'Login' })`,
    });

    expect(result.success).toBe(true);
    expect(result.pattern).toBe('constructor-assignment');

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain(`this.submitButton = page.getByRole('button', { name: 'Login' });`);
  });

  it('should strictly ABSTAIN on parameterized helper methods', async () => {
    const filePath = path.join(testDir, 'LoginPage.ts');
    await fs.writeFile(filePath, samplePom, 'utf8');

    const patcher = new AstPatcher();
    expect(() =>
      patcher.patchPageObject({
        filePath,
        className: 'LoginPage',
        memberName: 'rowByUsername',
        replacementExpression: `page.locator('.row')`,
      })
    ).toThrow(AbstentionError);
  });

  it('should compute deterministic SHA-256 assertion fingerprints insensitive to formatting', async () => {
    const testFileA = path.join(testDir, 'sample-a.spec.ts');
    const testFileB = path.join(testDir, 'sample-b.spec.ts');

    const codeA = `
import { test, expect } from '@playwright/test';
test('sample', async ({ page }) => {
  await expect(page.locator('.alert')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.title')).toHaveText('Dashboard');
});
`;

    // Same assertions with whitespace, comments and formatting changes
    const codeB = `
import { test, expect } from '@playwright/test';
test('sample', async ({ page }) => {
  // Comment 1
  await expect( page.locator('.alert') ).toBeVisible( { timeout: 5000 } );

  // Additional comment
  await expect(page.locator('.title')).toHaveText( 'Dashboard' );
});
`;

    await fs.writeFile(testFileA, codeA, 'utf8');
    await fs.writeFile(testFileB, codeB, 'utf8');

    const hashA = AssertionHasher.computeFingerprint(testFileA);
    const hashB = AssertionHasher.computeFingerprint(testFileB);

    expect(hashA).toBe(hashB);
    expect(hashA.length).toBe(64); // SHA-256 hex length
  });
});

