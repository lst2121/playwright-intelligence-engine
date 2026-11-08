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

  it('resolves baseURL from profile.testConventions.baseUrl and falls back to / when omitted', () => {
    // 1. Profile baseURL
    const profileWithBaseUrl = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      repository: { name: 'app', root: 'C:/app', packageManager: 'npm', scripts: {} },
      structure: { testFiles: 1, pageObjectFiles: 1, fixtureFiles: 0, configFiles: ['playwright.config.ts'], usesPageObjects: true, usesCustomFixtures: false, usesApiHelpers: false, usesStorageState: false },
      locatorConventions: { getByRole: 1, getByTestId: 0, getByLabel: 0, getByText: 0, locator: 0, cssOrXpath: 0, preferred: 'getByRole' },
      testConventions: { tags: [], usesDescribeBlocks: false, usesTestSteps: false, usesAssertions: false, baseUrl: 'https://staging.example.com' },
      domainTerms: [],
      evidence: [],
    } satisfies RepositoryConventionProfile;

    const plan1 = planArchitecture({ featureName: 'Dashboard', mode: 'brownfield', profile: profileWithBaseUrl });
    const po1 = plan1.files.find((f) => f.relativePath.endsWith('Page.ts'))?.content;
    expect(po1).toContain("await this.page.goto(\"https://staging.example.com\");");

    // 2. Fallback to '/'
    const plan2 = planArchitecture({ featureName: 'Dashboard', mode: 'brownfield' });
    const po2 = plan2.files.find((f) => f.relativePath.endsWith('Page.ts'))?.content;
    expect(po2).toContain("await this.page.goto(\"/\");");
    expect(po2).not.toContain("localhost:3000");
  });

  it('gates output directories by pathConfidence >= 0.5 defaulting to standard tests/pages', () => {
    const profileLowConf = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      repository: { name: 'app', root: 'C:/app', packageManager: 'npm', scripts: {} },
      structure: { testFiles: 10, pageObjectFiles: 5, fixtureFiles: 0, configFiles: ['playwright.config.ts'], usesPageObjects: true, usesCustomFixtures: false, usesApiHelpers: false, usesStorageState: false },
      paths: { testDirectory: 'src/weird/e2e', pageObjectDirectory: 'lib/deep/pages' },
      pathConfidence: { testDirectory: 0.35, pageObjectDirectory: 0.2, fixtureDirectory: 0.1 },
      locatorConventions: { getByRole: 1, getByTestId: 0, getByLabel: 0, getByText: 0, locator: 0, cssOrXpath: 0, preferred: 'getByRole' },
      testConventions: { tags: [], usesDescribeBlocks: false, usesTestSteps: false, usesAssertions: false },
      domainTerms: [],
      evidence: [],
    } satisfies RepositoryConventionProfile;

    const plan = planArchitecture({ featureName: 'UserProfile', mode: 'brownfield', profile: profileLowConf });
    expect(plan.conventions.testDirectory).toBe('tests');
    expect(plan.conventions.pageObjectDirectory).toBe('tests/pages');
    expect(plan.files.map((f) => f.relativePath)).toEqual(expect.arrayContaining([
      'tests/user-profile.spec.ts',
      'tests/pages/UserProfilePage.ts',
    ]));
    expect(plan.warnings.some((w) => w.includes('low confidence'))).toBe(true);
  });
});
