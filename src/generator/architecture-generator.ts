import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedStep } from './test-generator.js';
import type { RepositoryConventionProfile } from '../intelligence/repository-profile.js';
import { NamePlanner, NamingLinter, type NamePlan, type NamingLintReport } from '../authoring/naming/index.js';

export type ArchitectureMode = 'greenfield' | 'brownfield';
export type ArchitecturePlanStatus = 'READY' | 'PARTIAL' | 'ABSTAIN';

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

function defaultSteps(input: ArchitectureGenerationInput): GeneratedStep[] {
  if (input.steps && input.steps.length > 0) return input.steps;
  return [
    { action: 'navigate' },
    { action: 'assert-visible', role: 'heading', name: input.featureName },
  ];
}

function renderLocator(step: GeneratedStep, preferredLocator: string): string {
  if (step.action === 'click' && step.role && step.name) {
    return `this.page.getByRole('${step.role}', { name: '${step.name}' })`;
  }
  if (step.action === 'fill' && step.name) {
    if (preferredLocator === 'getByLabel') return `this.page.getByLabel('${step.name}')`;
    return `this.page.getByRole('textbox', { name: '${step.name}' })`;
  }
  if (step.selector && preferredLocator === 'getByTestId' && /^[A-Za-z0-9_-]+$/.test(step.selector)) {
    return `this.page.getByTestId('${step.selector}')`;
  }
  return `this.page.locator('${step.selector ?? (step.action === 'fill' ? 'input' : 'button')}')`;
}

function renderPageObject(className: string, baseUrl: string, steps: GeneratedStep[], preferredLocator: string, namePlan: NamePlan): string {
  const declarations: string[] = [];
  const assignments: string[] = [];
  const methods: string[] = [];
  steps.forEach((step, index) => {
    if (step.action !== 'click' && step.action !== 'fill') return;
    const symbol = namePlan.symbols[index] ?? namePlan.symbols.find((s) => s.ref === `step-${index + 1}`);
    const property = symbol?.property ?? (step.action === 'click' ? `actionButton` : `inputField`);
    const method = symbol?.method ?? (step.action === 'click' ? `clickAction` : `fillInput`);

    declarations.push(`  readonly ${property}: Locator;`);
    assignments.push(`    this.${property} = ${renderLocator(step, preferredLocator)};`);
    if (step.action === 'click') {
      methods.push(`  async ${method}(): Promise<void> {\n    await this.${property}.click();\n  }`);
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

function renderSpec(featureName: string, className: string, pageImport: string, steps: GeneratedStep[], namePlan: NamePlan, requirements?: string): string {
  const variable = className[0]!.toLowerCase() + className.slice(1);
  const lines: string[] = [`    await ${variable}.goto();`];
  steps.forEach((step, index) => {
    const symbol = namePlan.symbols[index] ?? namePlan.symbols.find((s) => s.ref === `step-${index + 1}`);
    const method = symbol?.method ?? (step.action === 'click' ? `clickAction` : `fillInput`);

    if (step.action === 'navigate' && step.value) {
      lines.push(`    await page.goto(${quote(step.value)});`);
    }
    if (step.action === 'click') {
      lines.push(`    await ${variable}.${method}();`);
    }
    if (step.action === 'fill') {
      lines.push(`    await ${variable}.${method}(${quote(step.value ?? 'test-data')});`);
    }
    if (step.action === 'assert-visible') {
      lines.push(`    await expect(page.getByRole('${step.role ?? 'heading'}', { name: '${step.name ?? featureName}' })).toBeVisible();`);
    }
    if (step.action === 'assert-text') {
      lines.push(`    await expect(page.locator('${step.selector ?? 'body'}')).toContainText('${step.expectedText ?? ''}');`);
    }
  });
  const requirementComment = requirements?.trim()
    ? `\n    // Requirement: ${requirements.trim().replace(/\r?\n/g, ' ').replace(/\*\//g, '* /')}`
    : '';
  return `import { test, expect } from '@playwright/test';
import { ${className} } from ${quote(pageImport)};

test.describe(${quote(`${featureName} workflow`)}, () => {
  test(${quote(`should complete ${featureName}`)}, async ({ page }) => {${requirementComment}
    const ${variable} = new ${className}(page);
${lines.join('\n')}
  });
});
`;
}

function renderFixtureFile(): string {
  return `import { test as base } from '@playwright/test';

export const test = base.extend({});
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
    baseURL: ${quote(baseUrl)},
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
  const steps = defaultSteps(input);
  const namePlan = input.namePlan ?? NamePlanner.planNames(featureName, steps, input.mode === 'greenfield' ? { existingPageClassName: fallbackClassName } : undefined);
  const className = input.mode === 'brownfield' && namePlan.pageClassName ? namePlan.pageClassName : fallbackClassName;
  const namingLintReport = NamingLinter.lint(namePlan);

  const profile = input.profile;
  const testDirectory = normalizeRelativeDirectory(profile?.paths?.testDirectory, 'tests');
  const pageObjectDirectory = normalizeRelativeDirectory(profile?.paths?.pageObjectDirectory, `${testDirectory}/pages`);
  const fixtureDirectory = normalizeRelativeDirectory(profile?.paths?.fixtureDirectory, `${testDirectory}/fixtures`);
  const preferredLocator = profile?.locatorConventions.preferred ?? 'getByRole';
  const existingFiles = new Set((input.existingFiles ?? []).map((file) => file.replace(/\\/g, '/')));
  const baseUrl = input.baseUrl ?? 'http://localhost:3000';
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
    if ((profile?.pathConfidence?.testDirectory ?? 1) < 0.5) {
      warnings.push('Test-directory convention has low confidence because matching files are distributed across the repository.');
    }
    assumptions.push('Existing project configuration, fixtures, authentication, and test data remain authoritative.');
    assumptions.push('Generated files are additive and do not replace existing files.');
  }

  const files: ArchitectureFile[] = [];
  files.push(makeFile(pagePath, renderPageObject(className, baseUrl, steps, preferredLocator, namePlan), 'Feature Page Object with explicit locators and actions.', existingFiles));
  files.push(makeFile(testPath, renderSpec(featureName, className, normalizedPageImport, steps, namePlan, input.requirements), 'Workflow spec with web-first assertions.', existingFiles));

  if (input.mode === 'greenfield') {
    files.push(makeFile('playwright.config.ts', renderPlaywrightConfig(baseUrl, testDirectory), 'Minimal reproducible Playwright configuration.', existingFiles));
    files.push(makeFile(`${fixtureDirectory}/test.ts`, renderFixtureFile(), 'Composable fixture entry point.', existingFiles));
    if (input.includeCi !== false) files.push(makeFile('.github/workflows/playwright.yml', renderCiWorkflow(), 'Pull-request Playwright execution workflow.', existingFiles));
  } else if (profile?.structure.usesCustomFixtures) {
    files.push(makeFile(`${fixtureDirectory}/test.ts`, renderFixtureFile(), 'Fixture extension point matching the profiled repository layout.', existingFiles));
  }

  const status: ArchitecturePlanStatus = warnings.some((warning) => warning.includes('No repository profile')) ? 'PARTIAL' : 'READY';
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
