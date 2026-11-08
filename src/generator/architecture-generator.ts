import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedStep } from './test-generator.js';
import type { RepositoryConventionProfile } from '../intelligence/repository-profile.js';
import { NamePlanner, NamingLinter, type NamePlan, type NamingLintReport } from '../authoring/naming/index.js';
import type { AppModel } from '../perception/app-model.js';
import { AssertionQualityGate } from './assertion-quality-gate.js';

export type ArchitectureMode = 'greenfield' | 'brownfield';
export type ArchitecturePlanStatus = 'READY' | 'PARTIAL' | 'ABSTAIN' | 'NEEDS_INPUT';

export interface ArchitectureGenerationInput {
  featureName: string;
  mode: ArchitectureMode;
  baseUrl?: string | undefined;
  requirements?: string | undefined;
  steps?: GeneratedStep[] | undefined;
  profile?: RepositoryConventionProfile | undefined;
  existingFiles?: string[] | undefined;
  includeCi?: boolean | undefined;
  namePlan?: NamePlan | undefined;
  appModel?: AppModel | undefined;
}

export interface ArchitectureFile {
  relativePath: string;
  content: string;
  purpose: string;
  action: 'CREATE' | 'SKIP_EXISTING';
}

export interface ArchitecturePlan {
  mode: ArchitectureMode;
  status: ArchitecturePlanStatus;
  featureName: string;
  slug: string;
  conventions: {
    testDirectory: string;
    pageObjectDirectory: string;
    fixtureDirectory: string;
    preferredLocator: string;
    usesCustomFixtures: boolean;
    usesStorageState: boolean;
  };
  assumptions: string[];
  warnings: string[];
  files: ArchitectureFile[];
  namePlan?: NamePlan | undefined;
  namingLintReport?: NamingLintReport | undefined;
}

export interface ArchitectureWriteResult {
  written: string[];
  skipped: string[];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function toSlug(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'feature';
}

export function toClassName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g) ?? ['Feature'];
  const className = words
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return /^[A-Za-z_]/.test(className) ? className : `Feature${className}`;
}

function normalizeRelativeDirectory(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return fallback;
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return fallback;
  return normalized;
}

export function inferBehavioralSteps(featureName: string, appModel?: AppModel): GeneratedStep[] | undefined {
  if (!appModel || !appModel.routes || appModel.routes.length === 0) return undefined;

  const targetSlug = toSlug(featureName);
  let route = appModel.routes.find((r) =>
    r.route.toLowerCase().includes(targetSlug) || (r.title && r.title.toLowerCase().includes(featureName.toLowerCase()))
  );
  if (!route) {
    route = appModel.routes.find((r) => r.elements && r.elements.length > 0) ?? appModel.routes[0];
  }
  if (!route || !route.elements || route.elements.length === 0) return undefined;

  const elements = route.elements;
  const inputEl = elements.find((el) =>
    (el.tag === 'input' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'submit' && el.type !== 'button') ||
    el.tag === 'textarea' ||
    Boolean(el.placeholder) ||
    (el.role === 'textbox' && el.type !== 'checkbox')
  );

  const submitBtn = elements.find((el) =>
    (el.tag === 'button' || el.role === 'button' || el.type === 'submit') &&
    el.accessibleName &&
    !/delete|remove|close|cancel/i.test(el.accessibleName)
  );

  const testValue = `Test ${featureName.replace(/Page$/, '')}`;

  if (inputEl) {
    const steps: GeneratedStep[] = [
      { action: 'navigate' },
      {
        action: 'fill',
        role: inputEl.role ?? 'textbox',
        name: inputEl.accessibleName,
        placeholder: inputEl.placeholder,
        selector: inputEl.testId,
        value: testValue,
        frame: inputEl.frameSelector,
        frameSelector: inputEl.frameSelector,
      },
    ];

    if (submitBtn) {
      steps.push({
        action: 'click',
        role: 'button',
        name: submitBtn.accessibleName,
        frame: submitBtn.frameSelector,
        frameSelector: submitBtn.frameSelector,
      });
    } else {
      steps.push({
        action: 'press',
        name: inputEl.accessibleName,
        placeholder: inputEl.placeholder,
        value: 'Enter',
        frame: inputEl.frameSelector,
        frameSelector: inputEl.frameSelector,
      });
    }

    steps.push({
      action: 'assert-visible',
      expectedText: testValue,
      name: testValue,
    });

    return steps;
  }

  const actionEl = elements.find((el) => (el.tag === 'button' || el.role === 'button' || el.tag === 'a') && el.accessibleName);
  if (actionEl) {
    return [
      { action: 'navigate' },
      {
        action: 'click',
        role: actionEl.role ?? 'button',
        name: actionEl.accessibleName,
        frame: actionEl.frameSelector,
        frameSelector: actionEl.frameSelector,
      },
      {
        action: 'assert-visible',
        role: 'heading',
        name: featureName,
      },
    ];
  }

  return undefined;
}

function defaultSteps(input: ArchitectureGenerationInput): GeneratedStep[] {
  if (input.steps && input.steps.length > 0) return input.steps;
  if (input.appModel) {
    const inferred = inferBehavioralSteps(input.featureName, input.appModel);
    if (inferred && inferred.length > 0) return inferred;
  }
  return [
    { action: 'navigate' },
    { action: 'assert-visible', role: 'heading', name: input.featureName },
  ];
}

export function renderLocator(step: GeneratedStep, preferredLocator: string, frameSelector?: string): string {
  let inner: string;
  if (step.placeholder) {
    inner = `getByPlaceholder('${step.placeholder}')`;
  } else if (step.action === 'click' && step.role && step.name) {
    inner = `getByRole('${step.role}', { name: '${step.name}' })`;
  } else if (step.action === 'fill' && step.name) {
    if (preferredLocator === 'getByLabel') inner = `getByLabel('${step.name}')`;
    else inner = `getByRole('textbox', { name: '${step.name}' })`;
  } else if (step.selector && preferredLocator === 'getByTestId' && /^[A-Za-z0-9_-]+$/.test(step.selector)) {
    inner = `getByTestId('${step.selector}')`;
  } else {
    inner = `locator('${step.selector ?? (step.action === 'fill' ? 'input' : 'button')}')`;
  }

  const frame = frameSelector ?? step.frame ?? step.frameSelector;
  if (frame) {
    return `this.page.frameLocator('${frame}').${inner}`;
  }
  return `this.page.${inner}`;
}

function renderPageObject(className: string, baseUrl: string, steps: GeneratedStep[], preferredLocator: string, namePlan: NamePlan): string {
  const declarations: string[] = [];
  const assignments: string[] = [];
  const methods: string[] = [];
  const seenProperties = new Set<string>();

  steps.forEach((step, index) => {
    if (step.action !== 'click' && step.action !== 'fill' && step.action !== 'press') return;
    const symbol = namePlan.symbols.find((s) => s.ref === `step-${index + 1}`) ?? namePlan.symbols[index];
    const property = symbol?.property ?? (step.action === 'click' ? `actionButton` : `inputField`);
    const method = symbol?.method ?? (step.action === 'click' ? `clickAction` : step.action === 'press' ? `pressKey` : `fillInput`);
    const frame = symbol?.frame ?? step.frame ?? step.frameSelector;

    if (!seenProperties.has(property)) {
      seenProperties.add(property);
      declarations.push(`  readonly ${property}: Locator;`);
      assignments.push(`    this.${property} = ${renderLocator(step, preferredLocator, frame)};`);
    }

    if (step.action === 'click') {
      methods.push(`  async ${method}(): Promise<void> {\n    await this.${property}.click();\n  }`);
    } else if (step.action === 'press') {
      methods.push(`  async ${method}(key = ${quote(step.value ?? 'Enter')}): Promise<void> {\n    await this.${property}.press(key);\n  }`);
    } else {
      methods.push(`  async ${method}(value: string): Promise<void> {\n    await this.${property}.fill(value);\n  }`);
    }
  });

  return `import type { Page, Locator } from '@playwright/test';

export class ${className} {
  readonly page: Page;
${declarations.length > 0 ? `\n${declarations.join('\n')}\n` : ''}
  constructor(page: Page) {
    this.page = page;
${assignments.length > 0 ? `${assignments.join('\n')}\n` : ''}  }

  async goto(): Promise<void> {
    await this.page.goto(${quote(baseUrl)});
  }
${methods.length > 0 ? `\n${methods.join('\n\n')}\n` : ''}}
`;
}

function renderSpec(
  featureName: string,
  className: string,
  pageImport: string,
  fixtureImport: string | undefined,
  steps: GeneratedStep[],
  namePlan: NamePlan,
  requirements?: string,
  useFixtures = false,
): string {
  const variable = className[0]!.toLowerCase() + className.slice(1);
  const lines: string[] = [];

  if (!useFixtures) {
    lines.push(`    const ${variable} = new ${className}(page);`);
    lines.push(`    await ${variable}.goto();`);
  }

  steps.forEach((step, index) => {
    const symbol = namePlan.symbols.find((s) => s.ref === `step-${index + 1}`) ?? namePlan.symbols[index];
    const method = symbol?.method ?? (step.action === 'click' ? `clickAction` : step.action === 'press' ? `pressKey` : `fillInput`);
    const action = String(step.action || '').replace(/([A-Z])/g, '-$1').toLowerCase();

    if (action === 'navigate' && step.value) {
      lines.push(`    await page.goto(${quote(step.value)});`);
    } else if (action === 'click') {
      lines.push(`    await ${variable}.${method}();`);
    } else if (action === 'press') {
      lines.push(`    await ${variable}.${method}(${quote(step.value ?? 'Enter')});`);
    } else if (action === 'fill') {
      lines.push(`    await ${variable}.${method}(${quote(step.value ?? 'test-data')});`);
    } else if (action === 'assert-visible') {
      if (step.expectedText) {
        lines.push(`    await expect(page.getByText(${quote(step.expectedText)})).toBeVisible();`);
      } else if (step.role && step.name) {
        lines.push(`    await expect(page.getByRole('${step.role}', { name: '${step.name}' })).toBeVisible();`);
      } else if (step.name) {
        lines.push(`    await expect(page.getByRole('${step.role ?? 'heading'}', { name: '${step.name}' })).toBeVisible();`);
      } else if (step.selector) {
        lines.push(`    await expect(page.locator(${quote(step.selector)})).toBeVisible();`);
      } else {
        lines.push(`    await expect(page.getByRole('${step.role ?? 'heading'}', { name: '${featureName}' })).toBeVisible();`);
      }
    } else if (action === 'assert-text') {
      lines.push(`    await expect(page.locator('${step.selector ?? 'body'}')).toContainText('${step.expectedText ?? ''}');`);
    } else if (action === 'assert-count') {
      lines.push(`    await expect(page.locator('${step.selector ?? 'li'}')).toHaveCount(${step.expectedCount ?? 1});`);
    } else if (action === 'assert-value') {
      lines.push(`    await expect(page.locator('${step.selector ?? 'input'}')).toHaveValue('${step.expectedValue ?? ''}');`);
    }
  });

  const requirementComment = requirements?.trim()
    ? `\n    // Requirement: ${requirements.trim().replace(/\r?\n/g, ' ').replace(/\*\//g, '* /')}`
    : '';

  if (useFixtures && fixtureImport) {
    return `import { test, expect } from ${quote(fixtureImport)};
import { ${className} } from ${quote(pageImport)};

test.describe(${quote(`${featureName} workflow`)}, () => {
  test(${quote(`should complete ${featureName}`)}, async ({ ${variable}, page }) => {${requirementComment}
${lines.join('\n')}
  });
});
`;
  }

  return `import { test, expect } from '@playwright/test';
import { ${className} } from ${quote(pageImport)};

test.describe(${quote(`${featureName} workflow`)}, () => {
  test(${quote(`should complete ${featureName}`)}, async ({ page }) => {${requirementComment}
${lines.join('\n')}
  });
});
`;
}

function renderFixtureFile(className?: string, pageImport?: string): string {
  if (!className || !pageImport) {
    return `import { test as base } from '@playwright/test';

export const test = base.extend({});
export { expect } from '@playwright/test';
`;
  }
  const variable = className[0]!.toLowerCase() + className.slice(1);
  return `import { test as base } from '@playwright/test';
import { ${className} } from ${quote(pageImport)};

type ${className}Fixtures = {
  ${variable}: ${className};
};

export const test = base.extend<${className}Fixtures>({
  ${variable}: async ({ page }, use) => {
    const ${variable} = new ${className}(page);
    await ${variable}.goto();
    await use(${variable});
  },
});

export { expect } from '@playwright/test';
`;
}

function renderPlaywrightConfig(baseUrl: string, testDirectory: string): string {
  return `import { defineConfig, devices } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  testDir: ${quote(`./${testDirectory}`)},
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: ${quote(baseUrl === '/' ? 'http://localhost:3000' : baseUrl)},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

function renderCiWorkflow(): string {
  return `name: Playwright tests

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
`;
}

function fileExists(existingFiles: Set<string>, relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return [...existingFiles].some((file) => file.replace(/\\/g, '/').replace(/^\.\//, '') === normalized);
}

function makeFile(relativePath: string, content: string, purpose: string, existingFiles: Set<string>): ArchitectureFile {
  return { relativePath, content, purpose, action: fileExists(existingFiles, relativePath) ? 'SKIP_EXISTING' : 'CREATE' };
}

export function planArchitecture(input: ArchitectureGenerationInput): ArchitecturePlan {
  const featureName = input.featureName.trim();
  if (!featureName) throw new Error('featureName must be a non-empty string');
  if (input.mode !== 'greenfield' && input.mode !== 'brownfield') throw new Error(`Unsupported architecture mode '${input.mode}'`);

  const slug = toSlug(featureName);
  const rawBaseName = toClassName(featureName);
  const fallbackClassName = rawBaseName.endsWith('Page') ? rawBaseName : `${rawBaseName}Page`;
  let steps = defaultSteps(input);
  if (input.appModel && input.appModel.routes) {
    const allElements = input.appModel.routes.flatMap((r) => r.elements);
    steps = steps.map((s) => {
      if (s.frame || s.frameSelector) return s;
      const match = allElements.find((el) =>
        el.frameSelector &&
        ((s.name && (el.accessibleName === s.name || el.label === s.name)) ||
         (s.role && el.role === s.role && s.name && el.accessibleName === s.name))
      );
      if (match?.frameSelector) {
        return { ...s, frame: match.frameSelector, frameSelector: match.frameSelector };
      }
      return s;
    });
  }
  const namePlan = input.namePlan ?? NamePlanner.planNames(featureName, steps, input.mode === 'greenfield' ? { existingPageClassName: fallbackClassName } : undefined);
  const className = input.mode === 'brownfield' && namePlan.pageClassName ? namePlan.pageClassName : fallbackClassName;
  const namingLintReport = NamingLinter.lint(namePlan);

  const profile = input.profile;
  const testConfidence = profile?.pathConfidence?.testDirectory ?? 1;
  const pageConfidence = profile?.pathConfidence?.pageObjectDirectory ?? 1;
  const rawTestDir = (testConfidence >= 0.5 && profile?.paths?.testDirectory) ? profile.paths.testDirectory : 'tests';
  const rawPageDir = (pageConfidence >= 0.5 && profile?.paths?.pageObjectDirectory) ? profile.paths.pageObjectDirectory : `${rawTestDir}/pages`;
  const testDirectory = normalizeRelativeDirectory(rawTestDir, 'tests');
  const pageObjectDirectory = normalizeRelativeDirectory(rawPageDir, `${testDirectory}/pages`);
  const fixtureDirectory = normalizeRelativeDirectory(profile?.paths?.fixtureDirectory, `${testDirectory}/fixtures`);
  const preferredLocator = profile?.locatorConventions.preferred ?? 'getByRole';
  const existingFiles = new Set((input.existingFiles ?? []).map((file) => file.replace(/\\/g, '/')));
  const baseUrl = input.baseUrl ?? profile?.testConventions?.baseUrl ?? '/';
  const testPath = `${testDirectory}/${slug}.spec.ts`;
  const pagePath = `${pageObjectDirectory}/${className}.ts`;
  const pageImport = path.posix.relative(path.posix.dirname(testPath), pagePath).replace(/\.ts$/, '');
  const normalizedPageImport = pageImport.startsWith('.') ? pageImport : `./${pageImport}`;

  const assumptions: string[] = [];
  const warnings: string[] = [];
  if (namePlan.assumptions.length > 0) {
    assumptions.push(...namePlan.assumptions);
  }
  if (!namingLintReport.passed) {
    for (const v of namingLintReport.violations) {
      warnings.push(`Naming lint violation [${v.kind}]: ${v.message}`);
    }
  }

  if (input.mode === 'greenfield') {
    assumptions.push('The application will be available at the supplied base URL when tests execute.');
    assumptions.push('The generated workflow is a scaffold and requires review of business assertions and test data.');
  } else {
    if (!profile) warnings.push('No repository profile supplied; brownfield paths and conventions are conservative defaults.');
    if (profile?.locatorConventions.preferred === 'unknown') warnings.push('No dominant locator convention was detected; locator choices require review.');
    if (profile?.structure.playwrightTestFiles === 0 && profile.structure.configFiles.length === 0) {
      warnings.push('No Playwright test source or configuration was detected; generated files require manual integration review.');
    }
    if (testConfidence < 0.5) {
      warnings.push(`Test-directory convention has low confidence (${testConfidence}); defaulting to standard 'tests'.`);
    }
    if (pageConfidence < 0.5) {
      warnings.push(`Page-object directory convention has low confidence (${pageConfidence}); defaulting to standard '${testDirectory}/pages'.`);
    }
    assumptions.push('Existing project configuration, fixtures, authentication, and test data remain authoritative.');
    assumptions.push('Generated files are additive and do not replace existing files.');
  }

  const files: ArchitectureFile[] = [];
  const fixtureFileRelative = `${fixtureDirectory}/test.ts`;
  const pageImportFromFixture = path.posix.relative(path.posix.dirname(fixtureFileRelative), pagePath).replace(/\.ts$/, '');
  const normalizedPageImportFromFixture = pageImportFromFixture.startsWith('.') ? pageImportFromFixture : `./${pageImportFromFixture}`;

  const fixtureImport = path.posix.relative(path.posix.dirname(testPath), fixtureFileRelative).replace(/\.ts$/, '');
  const normalizedFixtureImport = fixtureImport.startsWith('.') ? fixtureImport : `./${fixtureImport}`;

  const usesCustomFixtures = input.mode === 'greenfield' || (profile?.structure.usesCustomFixtures ?? false);

  files.push(makeFile(pagePath, renderPageObject(className, baseUrl, steps, preferredLocator, namePlan), 'Feature Page Object with explicit locators and actions.', existingFiles));
  files.push(makeFile(testPath, renderSpec(featureName, className, normalizedPageImport, normalizedFixtureImport, steps, namePlan, input.requirements, usesCustomFixtures), 'Workflow spec with web-first assertions.', existingFiles));

  if (input.mode === 'greenfield') {
    files.push(makeFile('playwright.config.ts', renderPlaywrightConfig(baseUrl, testDirectory), 'Minimal reproducible Playwright configuration.', existingFiles));
    files.push(makeFile(fixtureFileRelative, renderFixtureFile(className, normalizedPageImportFromFixture), 'Composable fixture entry point.', existingFiles));
    if (input.includeCi !== false) files.push(makeFile('.github/workflows/playwright.yml', renderCiWorkflow(), 'Pull-request Playwright execution workflow.', existingFiles));
  } else if (profile?.structure.usesCustomFixtures) {
    files.push(makeFile(fixtureFileRelative, renderFixtureFile(className, normalizedPageImportFromFixture), 'Fixture extension point matching the profiled repository layout.', existingFiles));
  }

  const specFile = files.find((f) => f.relativePath.endsWith('.spec.ts'));
  if (specFile) {
    const qualityReport = AssertionQualityGate.evaluate(specFile.content, featureName);
    if (!qualityReport.passed) {
      for (const v of qualityReport.violations) {
        warnings.push(`Assertion quality violation: ${v}`);
      }
    }
  }

  const groundedSteps = steps.filter((s) => s.action !== 'navigate' && (s.name || s.selector || s.placeholder));
  const ungrounded = steps.length > 0 && groundedSteps.length === 0;
  if (ungrounded) {
    warnings.push('No grounded steps provided: every step must carry an accessible name or selector. Supply requirements or observed steps.');
  }

  const status: ArchitecturePlanStatus = ungrounded
    ? 'NEEDS_INPUT'
    : warnings.some((warning) => warning.includes('No repository profile')) ? 'PARTIAL' : 'READY';
  return {
    mode: input.mode,
    status,
    featureName,
    slug,
    conventions: {
      testDirectory,
      pageObjectDirectory,
      fixtureDirectory,
      preferredLocator,
      usesCustomFixtures: profile?.structure.usesCustomFixtures ?? false,
      usesStorageState: profile?.structure.usesStorageState ?? false,
    },
    assumptions,
    warnings,
    files,
    namePlan,
    namingLintReport,
  };
}

export async function writeArchitecturePlan(
  root: string,
  plan: ArchitecturePlan,
): Promise<ArchitectureWriteResult> {
  const projectRoot = path.resolve(root);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of plan.files) {
    const target = path.resolve(projectRoot, file.relativePath);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Architecture output path escapes project root: '${file.relativePath}'`);
    if (file.action === 'SKIP_EXISTING') {
      skipped.push(file.relativePath);
      continue;
    }
    try {
      await fs.access(target);
      skipped.push(file.relativePath);
      continue;
    } catch {
      // The file is intentionally create-only. Continue to mkdir/write below.
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
    written.push(file.relativePath);
  }
  return { written, skipped };
}
