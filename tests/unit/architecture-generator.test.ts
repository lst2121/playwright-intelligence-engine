import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { planArchitecture, writeArchitecturePlan } from '../../src/generator/architecture-generator.js';
import type { RepositoryConventionProfile } from '../../src/intelligence/repository-profile.js';

describe('Architecture generator', () => {
  it('plans a complete create-only greenfield suite', () => {
    const plan = planArchitecture({
      featureName: 'Checkout Flow',
      mode: 'greenfield',
      baseUrl: 'http://localhost:4173',
      requirements: 'A customer can submit an order and see confirmation.',
      steps: [
        { action: 'fill', name: 'Email', value: 'qa@example.com' },
        { action: 'click', role: 'button', name: 'Place order' },
        { action: 'assert-visible', role: 'heading', name: 'Confirmation' },
      ],
    });

    expect(plan.status).toBe('READY');
    expect(plan.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      'tests/checkout-flow.spec.ts',
      'tests/pages/CheckoutFlowPage.ts',
      'playwright.config.ts',
      'tests/fixtures/test.ts',
      '.github/workflows/playwright.yml',
    ]));
    expect(plan.files.find((file) => file.relativePath === 'tests/checkout-flow.spec.ts')?.content)
      .toContain('A customer can submit an order');
  });

  it('uses profiled brownfield paths and does not invent a new config', () => {
    const profile = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      repository: { name: 'shop', root: 'C:/shop', packageManager: 'npm', scripts: {} },
      structure: {
        testFiles: 10,
        pageObjectFiles: 4,
        fixtureFiles: 1,
        configFiles: ['playwright.config.ts'],
        usesPageObjects: true,
        usesCustomFixtures: true,
        usesApiHelpers: true,
        usesStorageState: true,
      },
      paths: { testDirectory: 'e2e/specs', pageObjectDirectory: 'e2e/pages', fixtureDirectory: 'e2e/support' },
      locatorConventions: { getByRole: 10, getByTestId: 2, getByLabel: 1, getByText: 0, locator: 0, cssOrXpath: 0, preferred: 'getByRole' },
      testConventions: { tags: ['@smoke'], usesDescribeBlocks: true, usesTestSteps: true, usesAssertions: true },
      domainTerms: ['order'],
      evidence: [],
    } satisfies RepositoryConventionProfile;

    const plan = planArchitecture({ featureName: 'Order Review', mode: 'brownfield', profile });
    expect(plan.status).toBe('READY');
    expect(plan.conventions.usesStorageState).toBe(true);
    expect(plan.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      'e2e/specs/order-review.spec.ts',
      'e2e/pages/OrderReviewPage.ts',
      'e2e/support/test.ts',
    ]));
    expect(plan.files.some((file) => file.relativePath === 'playwright.config.ts')).toBe(false);
    expect(plan.files.find((file) => file.relativePath.endsWith('.spec.ts'))?.content).toContain("from \"../pages/OrderReviewPage\"");
  });

  it('writes missing files without overwriting an existing file', async () => {
    const root = path.resolve('tests/fixtures/tmp-architecture-generator');
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'playwright.config.ts'), 'existing config\n', 'utf8');
    const plan = planArchitecture({ featureName: 'Login', mode: 'greenfield' });

    const result = await writeArchitecturePlan(root, plan);
    expect(result.skipped).toContain('playwright.config.ts');
    expect(await fs.readFile(path.join(root, 'playwright.config.ts'), 'utf8')).toBe('existing config\n');
    expect(result.written).toContain('tests/login.spec.ts');
    await fs.rm(root, { recursive: true, force: true });
  });
});
