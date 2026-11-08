import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRepositoryProfile, computeRepositoryProfileFingerprint, writeRepositoryProfile } from '../../src/intelligence/repository-profile.js';
import { bootstrapProjectIntelligence } from '../../src/intelligence/project-intelligence.js';

describe('repository convention profile', () => {
  it('extracts structural, locator, test, and domain conventions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-profile-'));
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    await fs.mkdir(path.join(root, 'fixtures'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      license: 'MIT',
      scripts: { test: 'playwright test' },
      devDependencies: { '@playwright/test': '^1.60.0' },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}', 'utf8');
    await fs.writeFile(path.join(root, 'playwright.config.ts'), 'export default {};', 'utf8');
    await fs.writeFile(path.join(root, 'pages', 'CheckoutPage.ts'), `export class CheckoutPage {\n  submit = this.page.getByRole('button', { name: 'Submit' });\n  coupon = this.page.getByRole('textbox', { name: 'Coupon' });\n}`, 'utf8');
    await fs.writeFile(path.join(root, 'fixtures', 'test.ts'), `export const test = base.extend({});`, 'utf8');
    await fs.writeFile(path.join(root, 'tests', 'checkout.spec.ts'), `test.describe('checkout @critical', () => { test('places order', async () => { await test.step('submit order', async () => {}); await expect(page.getByRole('heading')).toBeVisible(); }); });`, 'utf8');

    const profile = await buildRepositoryProfile(root, new Date('2026-01-02T03:04:05.000Z'));
    expect(profile.structure.usesPageObjects).toBe(true);
    expect(profile.structure.usesCustomFixtures).toBe(true);
    expect(profile.locatorConventions.preferred).toBe('getByRole');
    expect(profile.identifierConventions).toBeDefined();
    expect(profile.identifierConventions?.recommendedLocatorPolicy).toBe('prefer-role-over-css');
    expect(profile.testConventions.usesDescribeBlocks).toBe(true);
    expect(profile.testConventions.usesTestSteps).toBe(true);
    expect(profile.testConventions.tags).toContain('@critical');
    expect(profile.domainTerms).toContain('checkout');

    const written = await writeRepositoryProfile(root, profile);
    expect(written.profilePath).toBe(path.join(root, '.pie', 'repository-profile.json'));
    expect(written.conventionsPath).toBe(path.join(root, '.pie', 'conventions.json'));
    await expect(fs.access(written.profilePath)).resolves.toBeUndefined();
    await expect(fs.access(written.conventionsPath)).resolves.toBeUndefined();
  });

  it('refreshes project profile when source metadata changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-profile-refresh-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '^1.60.0' } }), 'utf8');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}', 'utf8');
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    const source = path.join(root, 'tests', 'checkout.spec.ts');
    await fs.writeFile(source, `test('checkout', async ({ page }) => page.getByRole('button', { name: 'Pay' }));`, 'utf8');

    const first = await bootstrapProjectIntelligence(root);
    const firstFingerprint = first.profile?.sourceFingerprint;
    await fs.writeFile(source, `test('checkout', async ({ page }) => page.getByTestId('pay-button'));`, 'utf8');
    const second = await bootstrapProjectIntelligence(root);

    expect(firstFingerprint).toBeTruthy();
    expect(second.profile?.sourceFingerprint).toBeTruthy();
    expect(second.profile?.sourceFingerprint).not.toBe(firstFingerprint);
    expect(second.profile?.locatorConventions.preferred).toBe('getByTestId');
    expect(await computeRepositoryProfileFingerprint(root)).toBe(second.profile?.sourceFingerprint);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('prefers Playwright test sources over unrelated monorepo test directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-profile-playwright-sources-'));
    await fs.mkdir(path.join(root, 'packages', 'unit-tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'e2e'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '^1.60.0' } }), 'utf8');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}', 'utf8');
    await fs.writeFile(path.join(root, 'packages', 'unit-tests', 'thing.test.ts'), 'describe("unit", () => {});', 'utf8');
    await fs.writeFile(path.join(root, 'e2e', 'login.spec.ts'), 'import { test } from "@playwright/test"; test("login", async () => {});', 'utf8');

    const profile = await buildRepositoryProfile(root);
    expect(profile.structure.playwrightTestFiles).toBe(1);
    expect(profile.paths?.testDirectory).toBe('e2e');
    expect(profile.evidence).toContain('1 Playwright test source(s) detected');
    await fs.rm(root, { recursive: true, force: true });
  });
});
