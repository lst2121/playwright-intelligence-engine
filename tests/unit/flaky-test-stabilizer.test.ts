import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { FlakyTestStabilizer } from '../../src/stabilize/flaky-test-stabilizer.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';

describe('FlakyTestStabilizer Unit & Invariant Tests (Track A)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-stabilize-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans and identifies hardcoded waitForTimeout calls with line numbers and duration', () => {
    const code = `
import { test, expect } from '@playwright/test';

test('flaky checkout', async ({ page }) => {
  await page.goto('/checkout');
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Submit' }).click();
});
    `.trim();

    const result = FlakyTestStabilizer.scan('test.spec.ts', code);
    expect(result.hasFlakyAntiPatterns).toBe(true);
    expect(result.antiPatterns.length).toBe(1);
    expect(result.antiPatterns[0]!.kind).toBe('HARDCODED_SLEEP');
    expect(result.antiPatterns[0]!.line).toBe(5);
    expect(result.antiPatterns[0]!.durationMs).toBe(5000);
    expect(result.antiPatterns[0]!.suggestedReplacement).toContain("await page.getByRole('button', { name: 'Submit' }).waitFor({ state: 'visible', timeout: 5000 });");
  });

  it('returns NO_FLAKINESS_DETECTED on deterministic tests without sleeps', async () => {
    const specPath = path.resolve(tmpDir, 'clean.spec.ts');
    await fs.writeFile(
      specPath,
      `import { test, expect } from '@playwright/test';\ntest('clean', async ({ page }) => { await expect(page.locator('#item')).toBeVisible(); });`,
      'utf8'
    );

    const result = await FlakyTestStabilizer.stabilize({
      testFilePath: specPath,
      workspaceRoot: tmpDir,
      execute: false,
    });

    expect(result.status).toBe('NO_FLAKINESS_DETECTED');
    expect(result.antiPatterns.length).toBe(0);
  });

  it('generates proposal without modifying test assertions (Assertion Invariant strictly preserved)', async () => {
    const specPath = path.resolve(tmpDir, 'flaky.spec.ts');
    const initialCode = `
import { test, expect } from '@playwright/test';

test('login test', async ({ page }) => {
  await page.goto('/login');
  await page.waitForTimeout(3000);
  await page.locator('#username').fill('admin');
  await expect(page.locator('#welcome-banner')).toHaveText('Welcome, admin!');
});
    `.trim();

    await fs.writeFile(specPath, initialCode, 'utf8');

    const result = await FlakyTestStabilizer.stabilize({
      testFilePath: specPath,
      workspaceRoot: tmpDir,
      execute: false, // Generate proposal only
    });

    expect(result.status).toBe('PROPOSAL_READY');
    expect(result.antiPatterns.length).toBe(1);
    expect(result.assertionIntegrityPreserved).toBe(true);
    expect(result.stabilizedSource).toBeDefined();
    expect(result.stabilizedSource).not.toContain('page.waitForTimeout(3000)');
    expect(result.stabilizedSource).toContain("waitFor({ state: 'visible'");

    // Verify assertion fingerprint is identical
    const tempOriginal = path.resolve(tmpDir, 'orig.ts');
    const tempStabilized = path.resolve(tmpDir, 'stab.ts');
    await fs.writeFile(tempOriginal, initialCode, 'utf8');
    await fs.writeFile(tempStabilized, result.stabilizedSource!, 'utf8');

    const fpOrig = AssertionHasher.computeAssertionFingerprint(tempOriginal);
    const fpStab = AssertionHasher.computeAssertionFingerprint(tempStabilized);
    expect(fpOrig).toBe(fpStab);
  });
});
