import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import {
  AuthorKind,
  CandidateChange,
  CandidateFile,
  FullCodeGenerationProvider,
  HybridAuthor,
  LlmAuthor,
  NamingLinter,
} from '../authoring/index.js';
import { AssertionQualityGate } from '../generator/assertion-quality-gate.js';
import { toClassName, toSlug } from '../generator/architecture-generator.js';
import { CandidateWriter } from '../generator/candidate-writer.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';
import {
  ExplorationContextBundle,
  ExplorationFinding,
  ScenarioExplorationStatus,
  saveExplorationContextBundle,
  VerificationLayerStatus,
} from './evidence-bundle.js';
import { buildBrownfieldRepositoryGraph, BrownfieldRepositoryGraph } from './repository-profile.js';
import { normalizeFormFieldName, findPrimarySubmitButton } from './semantic-normalizer.js';
import { composeFixtureAst } from './fixture-composer.js';
import {
  buildWorkflowPlan,
  exportWorkflowToGherkin,
  GenerationWorkflowPlan,
  importGherkinToWorkflowPlan,
  isStaleWorkflowPlan,
  WorkflowPlanInput,
} from './workflow-planner.js';
import {
  ControlledLoginConfig,
  DbVerificationResult,
  InteractiveWorkflowRunner,
  synthesizeValueForLocator,
} from '../reproduce/interactive-workflow-runner.js';

export interface MutationResultEntry {
  id: string;
  level: 'LEVEL_C_ASSERTION' | 'LEVEL_B_API_FAULT';
  specFile: string;
  description: string;
  status: 'KILLED' | 'SURVIVED' | 'INVALID' | 'EQUIVALENT';
  exitCode?: number | undefined;
}

export interface QaReport {
  reportVersion: '1.0';
  generatedAt: string;
  status: 'VERIFIED' | 'VERIFIED_WITH_WARNINGS' | 'GENERATED' | 'NEEDS_INPUT' | 'ABSTAINED' | 'VERIFICATION_FAILED';
  featureName: string;
  topology: ExplorationContextBundle['topology'];
  runtimeVerified: boolean;
  requirementCoverage: Array<{
    requirementId: string;
    title: string;
    status: 'COVERED' | 'BLOCKED' | 'NOT_APPLICABLE' | 'NOT_COVERED';
    scenarioIds: string[];
  }>;
  scenarioCoverage: Array<{
    scenarioId: string;
    title: string;
    category: string;
    applicability: string;
    explorationStatus?: string | undefined;
  }>;
  workflowStatuses: ScenarioExplorationStatus[];
  generatedFiles: string[];
  modifiedFiles: string[];
  staticValidation: {
    passed: boolean;
    tscChecked: boolean;
    tscPassed?: boolean | undefined;
    discoveryChecked: boolean;
    discoveryPassed?: boolean | undefined;
    violations: string[];
  };
  execution: {
    executed: boolean;
    passed: boolean;
    exitCode?: number | undefined;
    durationMs?: number | undefined;
    stdoutSnippet?: string | undefined;
  };
  failureClassifications: Array<{
    category: string;
    summary: string;
    defectOwner: 'automation' | 'application' | 'environment' | 'unknown';
  }>;
  repairAttempts: Array<{
    iteration: number;
    category: string;
    action: string;
    assertionsPreserved: boolean;
    succeeded: boolean;
  }>;
  intentInvariantPreserved: boolean;
  mutationResults: {
    executed: boolean;
    total: number;
    validTotal: number;
    killed: number;
    survived: number;
    invalid: number;
    equivalent: number;
    mutationScore: number | null;
    entries: MutationResultEntry[];
  };
  verificationLayers: {
    UI: VerificationLayerStatus;
    API: VerificationLayerStatus;
    CLIENT_RELOAD: VerificationLayerStatus;
    DB: VerificationLayerStatus;
  };
  findings: ExplorationFinding[];
  unverifiedBehaviors: string[];
  limitations: string[];
  artifacts: {
    workflowPlanPath?: string | undefined;
    featureFilePath?: string | undefined;
    explorationBundlePath?: string | undefined;
    qaReportJsonPath?: string | undefined;
    qaReportMarkdownPath?: string | undefined;
  };
  environment: {
    nodeVersion: string;
    platform: string;
    workspaceRoot: string;
    mcpDependenciesUsed: 'none';
  };
}

export interface EvidenceDrivenGenerationInput extends WorkflowPlanInput {
  workspaceRoot: string;
  outArtifactDir?: string | undefined;
  author?: AuthorKind | undefined;
  fullCodeProvider?: FullCodeGenerationProvider | undefined;
  editedFeatureText?: string | undefined;
  storageStatePath?: string | undefined;
  loginConfig?: ControlledLoginConfig | undefined;
  allowMutatingActions?: boolean | undefined;
  allowDestructiveActions?: boolean | undefined;
  designatedTestEnvironment?: boolean | undefined;
  dbVerifier?: ((scenario: any, actions: any[]) => Promise<DbVerificationResult>) | undefined;
  write?: boolean | undefined;
  verify?: boolean | undefined;
  runMutations?: boolean | undefined;
  maxRepairIterations?: number | undefined;
  repairCallback?: ((context: {
    specFiles: CandidateFile[];
    failureCategory: string;
    errorText: string;
    iteration: number;
  }) => Promise<CandidateFile[] | undefined>) | undefined;
}

export interface EvidenceDrivenGenerationResult {
  workflowPlan: GenerationWorkflowPlan;
  featureText: string;
  explorationBundle: ExplorationContextBundle;
  candidate: CandidateChange;
  qaReport: QaReport;
}

export const QaReportSchema = z.object({
  reportVersion: z.literal('1.0'),
  generatedAt: z.string(),
  status: z.enum(['VERIFIED', 'VERIFIED_WITH_WARNINGS', 'GENERATED', 'NEEDS_INPUT', 'ABSTAINED', 'VERIFICATION_FAILED']),
  featureName: z.string().min(1),
  topology: z.enum(['monorepo', 'standalone', 'source-only']),
  runtimeVerified: z.boolean(),
});

function extractExpectLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bexpect(?:\.soft|\.poll)?\s*\(/.test(line));
}

export function assertionsPreserved(originalSpec: string, repairedSpec: string): boolean {
  const orig = extractExpectLines(originalSpec);
  if (orig.length === 0) return true;
  const rep = extractExpectLines(repairedSpec);
  if (rep.length < orig.length) return false;

  const repJoined = rep.join('\n');
  for (const line of orig) {
    // Reject replacing specific locator assertions with generic body/html checks
    if (!/locator\s*\(\s*['"]body['"]\s*\)/i.test(line) && /expect\s*\(\s*page\.locator\s*\(\s*['"]body['"]\s*\)\s*\)/i.test(repJoined)) {
      return false;
    }

    // Preserve every semantic expected target literal inside getByText/getByRole/getByTestId/getByLabel
    const semanticLiterals = [...line.matchAll(/(?:getByText|getByTestId|getByLabel|getByPlaceholder)\s*\(\s*(['"`][^'"`]+['"`])/g)];
    for (const m of semanticLiterals) {
      if (m[1] && !repJoined.includes(m[1])) {
        return false;
      }
    }
    const roleNames = [...line.matchAll(/name\s*:\s*(['"`][^'"`]+['"`]|\/[^/]+\/[gimuy]*)/g)];
    for (const m of roleNames) {
      if (m[1] && !repJoined.includes(m[1])) {
        return false;
      }
    }

    // Preserve every expected outcome matcher and expected argument value
    const matcherMatch = line.match(/\)\.(to[A-Za-z]+)\(([^)]*)\)/);
    if (matcherMatch) {
      const matcherName = matcherMatch[1]!;
      const expectedArg = matcherMatch[2]!.trim();
      if (expectedArg && !repJoined.includes(expectedArg)) {
        return false;
      }
      if (!repJoined.includes(`.${matcherName}(`)) {
        return false;
      }
    }
  }
  return true;
}

function summarizeLayerStatus(statuses: ScenarioExplorationStatus[], layer: keyof ScenarioExplorationStatus['verificationLayers']): VerificationLayerStatus {
  const vals = statuses.map((s) => s.verificationLayers[layer]);
  if (vals.includes('FAIL')) return 'FAIL';
  if (vals.includes('PASS')) return 'PASS';
  if (vals.includes('NOT_VERIFIED')) return 'NOT_VERIFIED';
  return 'NOT_APPLICABLE';
}

function synthesizeGroundedCandidateFromBundle(
  featureName: string,
  workflowPlan: GenerationWorkflowPlan,
  bundle: ExplorationContextBundle,
  repoGraph?: BrownfieldRepositoryGraph,
  workspaceRoot?: string,
): CandidateChange {
  const slug = toSlug(featureName);
  const rawBase = toClassName(featureName);
  const pageClassName = rawBase.endsWith('Page') ? rawBase : `${rawBase}Page`;
  const pageVar = pageClassName[0]!.toLowerCase() + pageClassName.slice(1);

  const validScenarios = workflowPlan.scenarios.filter((sc) => {
    const st = bundle.scenarioStatuses.find((s) => s.scenarioId === sc.id);
    return (
      sc.applicability === 'applicable' &&
      st?.status !== 'BLOCKED' &&
      st?.status !== 'DEFECT_DETECTED'
    );
  });

  const existingFilesSet = new Set<string>([
    ...(repoGraph?.configPaths ?? []),
    ...(repoGraph?.pomExports.map((p) => p.sourceFile) ?? []),
  ]);

  const navUrl = bundle.baseUrl ? new URL(bundle.baseUrl).pathname || '/' : '/';
  const routeLocators = bundle.locators.filter((l) => !l.route || l.route === navUrl);
  const scopedLocators = routeLocators.length > 0 ? routeLocators : bundle.locators;

  // Filter out readonly inputs, Flatpickr floating inputs, and devtools controls
  const allInputs = scopedLocators.filter((l) =>
    (l.strategy === 'placeholder' || l.role === 'textbox' || l.role === 'combobox') &&
    l.visible &&
    !/flatpickr-input|dev ?tools/i.test(l.expression ?? '')
  );
  const submitLoc = findPrimarySubmitButton(scopedLocators);
  const toggleLoc = scopedLocators.find((l) => l.role === 'checkbox' && l.visible);

  const usedPropNames = new Set<string>();
  const inputEntries = allInputs.map((loc, idx) => {
    const finalName = normalizeFormFieldName(loc, idx, usedPropNames);
    const synthValue = synthesizeValueForLocator(loc, 'verify');
    return { identifier: finalName, loc, synthValue };
  });

  const inputLoc = allInputs[0];

  const pomLocators: string[] = [];
  const pomAssigns: string[] = [];
  const pomMethods: string[] = [];
  const locatorExpr = (expr: string) => expr.replace(/^page\./, 'this.page.');

  if (inputEntries.length > 1) {
    for (const entry of inputEntries) {
      pomLocators.push(`  readonly ${entry.identifier}: Locator;`);
      pomAssigns.push(`    this.${entry.identifier} = ${locatorExpr(entry.loc.expression ?? '')};`);
    }
  } else if (inputEntries.length === 1) {
    pomLocators.push(`  readonly ${inputEntries[0]!.identifier}: Locator;`);
    pomAssigns.push(`    this.${inputEntries[0]!.identifier} = ${locatorExpr(inputEntries[0]!.loc.expression ?? '')};`);
  }
  if (submitLoc) {
    pomLocators.push('  readonly submitButton: Locator;');
    pomAssigns.push(`    this.submitButton = ${locatorExpr(submitLoc.expression ?? '')};`);
  }
  if (toggleLoc) {
    pomLocators.push('  readonly itemToggle: Locator;');
    pomAssigns.push(`    this.itemToggle = ${locatorExpr(toggleLoc.expression ?? '')};`);
  }

  if (inputEntries.length > 1) {
    pomMethods.push(`  async fillForm(data: Partial<{ ${inputEntries.map((e) => `${e.identifier}: string`).join('; ')} }>): Promise<void> {
${inputEntries.map((e) => `    if (data.${e.identifier} !== undefined) await this.${e.identifier}.fill(data.${e.identifier});`).join('\n')}
  }`);
    if (submitLoc) {
      pomMethods.push(`  async submit(): Promise<void> {
    await this.submitButton.click();
  }`);
      pomMethods.push(`  async submitEmpty(): Promise<void> {
    await this.submitButton.click();
  }`);
    }
  } else if (inputEntries.length === 1 && submitLoc) {
    pomMethods.push(`  async submitItem(value: string): Promise<void> {
    await this.${inputEntries[0]!.identifier}.fill(value);
    await this.submitButton.click();
  }`);
    pomMethods.push(`  async submitEmpty(): Promise<void> {
    await this.submitButton.click();
  }`);
  } else if (inputEntries.length === 1) {
    pomMethods.push(`  async submitItem(value: string): Promise<void> {
    await this.${inputEntries[0]!.identifier}.fill(value);
    await this.${inputEntries[0]!.identifier}.press('Enter');
  }`);
  } else if (submitLoc) {
    pomMethods.push(`  async clickPrimaryAction(): Promise<void> {
    await this.submitButton.click();
  }`);
  }

  const pomContent = `import type { Page, Locator } from '@playwright/test';

export class ${pageClassName} {
${pomLocators.length > 0 ? `${pomLocators.join('\n')}\n` : ''}
  constructor(public readonly page: Page) {
${pomAssigns.join('\n')}
  }

  async goto(): Promise<void> {
    await this.page.goto(${JSON.stringify(navUrl)});
  }
${pomMethods.length > 0 ? `\n${pomMethods.join('\n\n')}\n` : ''}}
`;

  const testDir = repoGraph?.testDirectory ?? 'tests';
  const testExt = repoGraph?.testExtension ?? '.spec.ts';
  const pageObjDir = repoGraph?.pageObjectDirectory ?? 'tests/pages';
  const fixtureDir = repoGraph?.fixtureDirectory ?? 'tests/fixtures';

  const pomPath = `${pageObjDir}/${pageClassName}.ts`;
  const specPath = `${testDir}/${slug}${testExt}`;
  const specDir = path.posix.dirname(specPath);

  const relPomFromSpec = path.posix.relative(specDir, pomPath).replace(/\.ts$/, '.js');
  const pomImportForSpec = relPomFromSpec.startsWith('.') ? relPomFromSpec : `./${relPomFromSpec}`;

  // Adaptive Convention Mirroring:
  // If the repository already has an established POM/test suite that intentionally does NOT use fixtures,
  // or uses an internal custom test harness (e.g. #tests/playwright-utils.ts) without a dedicated POM fixtures folder, respect it.
  // Otherwise (greenfield or repos with dedicated POM fixtures), scaffold and compose into modern Playwright fixtures.
  const hasDedicatedPomFixtures = Boolean(
    repoGraph?.fixtureExports?.some((f) => /fixtures?[/\\]/i.test(f.sourceFile) || /fixtures?\.ts$/i.test(f.sourceFile))
    || (workspaceRoot && fsSync.existsSync(path.join(workspaceRoot, `${fixtureDir}/test.ts`)))
    || (workspaceRoot && fsSync.existsSync(path.join(workspaceRoot, `${fixtureDir}/app.fixtures.ts`)))
  );

  const hasEstablishedSuiteWithoutFixtures = Boolean(
    repoGraph &&
    (
      (repoGraph.pomExports.length > 0 && !hasDedicatedPomFixtures && repoGraph.testImport === '@playwright/test') ||
      (repoGraph.testImport && repoGraph.testImport !== '@playwright/test' && !hasDedicatedPomFixtures)
    )
  );
  const usesCustomFixtures = !hasEstablishedSuiteWithoutFixtures;

  const candidateFiles: CandidateFile[] = [
    {
      relativePath: pomPath,
      action: 'CREATE',
      content: pomContent,
      purpose: 'Evidence-grounded Page Object Model reusing observed locators.',
      evidenceReferences: [inputLoc?.id, submitLoc?.id].filter((x): x is string => Boolean(x)),
    },
  ];

  let fixtureImportForSpec = '@playwright/test';
  let targetFixtureRel: string | undefined;

  if (usesCustomFixtures) {
    const defaultFixturePath = `${fixtureDir}/test.ts`;

    const dedicatedFixture = repoGraph?.fixtureExports?.find((f) => /fixtures?[/\\]/i.test(f.sourceFile) || /fixtures?\.ts$/i.test(f.sourceFile));
    if (dedicatedFixture) {
      targetFixtureRel = dedicatedFixture.sourceFile;
    } else if (workspaceRoot && fsSync.existsSync(path.join(workspaceRoot, `${fixtureDir}/test.ts`))) {
      targetFixtureRel = `${fixtureDir}/test.ts`;
    } else if (workspaceRoot && fsSync.existsSync(path.join(workspaceRoot, `${fixtureDir}/app.fixtures.ts`))) {
      targetFixtureRel = `${fixtureDir}/app.fixtures.ts`;
    }

    const relPomFromFixture = path.posix.relative(
      path.posix.dirname(targetFixtureRel ?? defaultFixturePath),
      pomPath
    ).replace(/\.ts$/, '.js');
    const pomImportForFixture = relPomFromFixture.startsWith('.') ? relPomFromFixture : `./${relPomFromFixture}`;

    if (targetFixtureRel) {
      // Compose into existing fixture via AST Fixture Composition
      try {
        const fullFixturePath = workspaceRoot ? path.join(workspaceRoot, targetFixtureRel) : targetFixtureRel;
        const existingContent = fsSync.existsSync(fullFixturePath)
          ? fsSync.readFileSync(fullFixturePath, 'utf8')
          : '';
        if (existingContent) {
          const composed = composeFixtureAst(existingContent, pageClassName, pageVar, pomImportForFixture);
          candidateFiles.push({
            relativePath: targetFixtureRel,
            action: 'MODIFY',
            content: composed,
            purpose: `Compose ${pageClassName} into existing fixture.`,
          });
        }
      } catch {
        // Fallback safely if fixture read/composition fails
      }
      const relFixtureFromSpec = path.posix.relative(specDir, targetFixtureRel).replace(/\.ts$/, '.js');
      fixtureImportForSpec = relFixtureFromSpec.startsWith('.') ? relFixtureFromSpec : `./${relFixtureFromSpec}`;
    } else {
      // Create initial fixture entry point
      const fixtureContent = `import { test as base } from '@playwright/test';
import { ${pageClassName} } from ${JSON.stringify(pomImportForFixture)};

type AppFixtures = {
  ${pageVar}: ${pageClassName};
};

export const test = base.extend<AppFixtures>({
  ${pageVar}: async ({ page }, use) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await use(${pageVar});
  },
});

export { expect } from '@playwright/test';
`;
      candidateFiles.push({
        relativePath: defaultFixturePath,
        action: 'CREATE',
        content: fixtureContent,
        purpose: 'Composable fixture entry point injecting feature Page Object.',
      });
      const relFixtureFromSpec = path.posix.relative(specDir, defaultFixturePath).replace(/\.ts$/, '.js');
      fixtureImportForSpec = relFixtureFromSpec.startsWith('.') ? relFixtureFromSpec : `./${relFixtureFromSpec}`;
    }
  }

  const mutAction = bundle.actions.find((a) => a.action === 'fill-and-click' || a.action === 'click-action');
  const addedTexts = (mutAction?.domDiff ?? [])
    .filter((d) => d.startsWith('+ '))
    .map((d) => d.slice(2).trim())
    .filter((t) => t.length > 3 && !/error|invalid|required/i.test(t));
  const verifiedHeadingOrText = addedTexts.find((t) => /thanks|welcome|created|success|saved|confirmed/i.test(t)) ?? addedTexts[0];
  const targetRouteAfter = mutAction?.routeAfter && mutAction.routeAfter !== navUrl ? mutAction.routeAfter : undefined;

  const testBlocks: string[] = [];

  const addHappyPath = (title: string) => {
    if (inputEntries.length > 1) {
      const fillEntries = inputEntries.map((e) => `      ${e.identifier}: ${JSON.stringify(e.synthValue)}`).join(',\n');
      const assertLine = verifiedHeadingOrText
        ? `    await expect(page.getByText(${JSON.stringify(verifiedHeadingOrText)})).toBeVisible();`
        : targetRouteAfter
          ? `    await expect(page).toHaveURL(new RegExp(${JSON.stringify(targetRouteAfter)}));`
          : submitLoc
            ? `    await expect(${pageVar}.submitButton).toBeVisible();`
            : `    await expect(page.locator('body')).toBeVisible();`;

      testBlocks.push(usesCustomFixtures
        ? `  test(${JSON.stringify(title)}, async ({ ${pageVar}, page }) => {
    await ${pageVar}.fillForm({
${fillEntries}
    });
    await ${pageVar}.submit();
${assertLine}
  });`
        : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await ${pageVar}.fillForm({
${fillEntries}
    });
    await ${pageVar}.submit();
${assertLine}
  });`);
    } else if (inputEntries.length === 1 && submitLoc) {
      const itemTitle = `Test-${slug}-item`;
      const assertLine = verifiedHeadingOrText
        ? `    await expect(page.getByText(${JSON.stringify(verifiedHeadingOrText)})).toBeVisible();`
        : `    await expect(page.getByText(${JSON.stringify(itemTitle)})).toBeVisible();`;

      testBlocks.push(usesCustomFixtures
        ? `  test(${JSON.stringify(title)}, async ({ ${pageVar}, page }) => {
    await ${pageVar}.submitItem(${JSON.stringify(itemTitle)});
${assertLine}
  });`
        : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await ${pageVar}.submitItem(${JSON.stringify(itemTitle)});
${assertLine}
  });`);
    } else if (submitLoc) {
      const assertLine = verifiedHeadingOrText
        ? `    await expect(page.getByText(${JSON.stringify(verifiedHeadingOrText)})).toBeVisible();`
        : targetRouteAfter
          ? `    await expect(page).toHaveURL(new RegExp(${JSON.stringify(targetRouteAfter)}));`
          : `    await expect(page.locator('main, body').first()).toBeVisible();`;

      testBlocks.push(usesCustomFixtures
        ? `  test(${JSON.stringify(title)}, async ({ ${pageVar}, page }) => {
    await ${pageVar}.clickPrimaryAction();
${assertLine}
  });`
        : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await ${pageVar}.clickPrimaryAction();
${assertLine}
  });`);
    } else {
      testBlocks.push(usesCustomFixtures
        ? `  test(${JSON.stringify(title)}, async ({ ${pageVar}, page }) => {
    await expect(page.locator('body')).toBeVisible();
  });`
        : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await expect(page.locator('body')).toBeVisible();
  });`);
    }
  };

  const addValidation = (title: string) => {
    if (!submitLoc || inputEntries.length === 0) return;
    const submitCall = `await ${pageVar}.submitEmpty();`;
    const inputCheck = inputEntries.length > 0
      ? `    await expect(${pageVar}.${inputEntries[0]!.identifier}).toBeVisible();\n`
      : '';

    testBlocks.push(usesCustomFixtures
      ? `  test(${JSON.stringify(title)}, async ({ ${pageVar}, page }) => {
    ${submitCall}
    await expect(page).toHaveURL(new RegExp(${JSON.stringify(navUrl)}));
${inputCheck}    await expect(${pageVar}.submitButton).toBeVisible();
  });`
      : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    ${submitCall}
    await expect(page).toHaveURL(new RegExp(${JSON.stringify(navUrl)}));
${inputCheck}    await expect(${pageVar}.submitButton).toBeVisible();
  });`);
  };

  const addUiState = (title: string) => {
    const checks: string[] = [];
    for (const e of inputEntries.slice(0, 4)) {
      checks.push(`    await expect(${pageVar}.${e.identifier}).toBeVisible();`);
      checks.push(`    await expect(${pageVar}.${e.identifier}).toBeEditable();`);
    }
    if (submitLoc) {
      checks.push(`    await expect(${pageVar}.submitButton).toBeVisible();`);
      checks.push(`    await expect(${pageVar}.submitButton).toBeEnabled();`);
    }
    if (checks.length > 0) {
      testBlocks.push(usesCustomFixtures
        ? `  test(${JSON.stringify(title)}, async ({ ${pageVar} }) => {
${checks.join('\n')}
  });`
        : `  test(${JSON.stringify(title)}, async ({ page }) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
${checks.join('\n')}
  });`);
    }
  };

  addHappyPath(`should complete ${featureName} workflow successfully`);
  if (submitLoc) {
    addValidation(`should enforce input validation when submitted empty`);
  }
  if (inputEntries.length > 0 || submitLoc) {
    addUiState(`should present interactive controls in ready and accessible state`);
  }

  let resolvedTestImport = repoGraph?.testImport ?? '@playwright/test';
  if (resolvedTestImport !== '@playwright/test' && !resolvedTestImport.startsWith('.') && !resolvedTestImport.startsWith('#')) {
    // Check if it matches a package.json subpath import
    const pkgJsonPath = workspaceRoot ? path.join(workspaceRoot, 'package.json') : undefined;
    let subpathImport: string | undefined;
    if (pkgJsonPath && fsSync.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.imports) {
          for (const [alias, target] of Object.entries(pkg.imports as Record<string, string>)) {
            const cleanTarget = target.replace(/^\.\//, '').replace(/\*$/, '');
            const cleanAlias = alias.replace(/\*$/, '');
            if (resolvedTestImport.startsWith(cleanTarget)) {
              subpathImport = resolvedTestImport.replace(cleanTarget, cleanAlias);
              break;
            }
          }
        }
      } catch {}
    }
    if (subpathImport) {
      resolvedTestImport = subpathImport;
    } else {
      const rel = path.posix.relative(specDir, resolvedTestImport);
      resolvedTestImport = rel.startsWith('.') ? rel : `./${rel}`;
    }
  }

  const specImports = usesCustomFixtures
    ? `import { test, expect } from ${JSON.stringify(fixtureImportForSpec)};`
    : `import { test, expect } from ${JSON.stringify(resolvedTestImport)};\nimport { ${pageClassName} } from ${JSON.stringify(pomImportForSpec)};`;

  const specContent = `${specImports}

test.describe(${JSON.stringify(`${featureName} verified workflows`)}, () => {
${testBlocks.join('\n\n')}
});
`;

  candidateFiles.push({
    relativePath: specPath,
    action: 'CREATE',
    content: specContent,
    purpose: 'Evidence-grounded Playwright test specification.',
    scenarioIds: validScenarios.map((s) => s.id),
  });

  // Greenfield Project-Level Authentication & Config Scaffolding
  if (!existingFilesSet.has('playwright.config.ts') && (repoGraph?.configPaths.length ?? 0) === 0) {
    const isAuthRoute = /login|signin|join|register|account|auth/i.test(navUrl) || /login|sign ?in|join|auth/i.test(featureName);
    const configContent = isAuthRoute
      ? `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: ${JSON.stringify(bundle.baseUrl ?? 'http://localhost:3000')},
    trace: 'on',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\\.setup\\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
`
      : `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: ${JSON.stringify(bundle.baseUrl ?? 'http://localhost:3000')},
    trace: 'on',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;

    candidateFiles.push({
      relativePath: 'playwright.config.ts',
      action: 'CREATE',
      content: configContent,
      purpose: 'Greenfield Playwright configuration with project setup.',
    });

    if (isAuthRoute) {
      candidateFiles.push({
        relativePath: '.auth/user.json',
        action: 'CREATE',
        content: `{\n  "cookies": [],\n  "origins": []\n}\n`,
        purpose: 'Storage state placeholder for authenticated projects.',
      });
      candidateFiles.push({
        relativePath: `${testDir}/auth.setup.ts`,
        action: 'CREATE',
        content: `import { test as setup } from '@playwright/test';
import path from 'node:path';

const authFile = path.posix.join('.auth', 'user.json');

setup('authenticate', async ({ page }) => {
  await page.goto(${JSON.stringify(navUrl)});
  await page.context().storageState({ path: authFile });
});
`,
        purpose: 'Playwright 1.31+ project-level authentication setup.',
      });
    }
  }

  const canBuild = testBlocks.length > 0;
  return {
    files: canBuild ? candidateFiles : [],
    symbols: {
      planVersion: '1',
      pageClassName,
      pageVariable: pageVar,
      symbols: [],
      assumptions: [],
    },
    rationale: canBuild
      ? 'Evidence-grounded deterministic fallback suite synthesized from ExplorationContextBundle.'
      : 'Insufficient verified interactive controls or all applicable scenarios blocked.',
    authorKind: 'hybrid',
    featureName,
    slug,
    mode: usesCustomFixtures ? (targetFixtureRel ? 'brownfield' : 'greenfield') : 'brownfield',
    status: canBuild ? 'GENERATE' : 'ABSTAIN',
    fullCodeAuthoring: true,
    usedFallback: true,
  };
}

function resolveWorkspaceCli(
  workspaceRoot: string,
  tool: 'tsc' | 'playwright',
): { cmd: string; prefixArgs: string[] } | undefined {
  let cur = workspaceRoot;
  while (cur && cur !== path.dirname(cur)) {
    if (tool === 'tsc') {
      const jsEntry = path.join(cur, 'node_modules', 'typescript', 'bin', 'tsc');
      if (fsSync.existsSync(jsEntry)) {
        return { cmd: process.execPath, prefixArgs: [jsEntry] };
      }
      const binEntry = path.join(cur, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
      if (fsSync.existsSync(binEntry)) {
        return { cmd: 'npx', prefixArgs: ['tsc'] };
      }
    } else {
      const pwJs = path.join(cur, 'node_modules', '@playwright', 'test', 'cli.js');
      if (fsSync.existsSync(pwJs)) {
        return { cmd: process.execPath, prefixArgs: [pwJs] };
      }
      const pwBin = path.join(cur, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
      if (fsSync.existsSync(pwBin)) {
        return { cmd: 'npx', prefixArgs: ['playwright'] };
      }
    }
    cur = path.dirname(cur);
  }
  return undefined;
}

async function runCommandInWorkspace(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
  extraEnv?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const res = await ExecutionRunner.run(cmd, {
    cwd,
    args,
    timeoutMs,
    ...(extraEnv ? { env: extraEnv } : {}),
  });
  return { exitCode: res.exitCode ?? 1, stdout: res.stdout, stderr: res.stderr };
}

async function findFirstTraceZip(root: string): Promise<string | undefined> {
  const candidates = [path.join(root, 'test-results'), path.join(root, '.playwright-results')];
  for (const base of candidates) {
    if (!fsSync.existsSync(base)) continue;
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const traceFile = path.join(base, entry.name, 'trace.zip');
        if (fsSync.existsSync(traceFile)) return traceFile;
      } else if (entry.name.endsWith('trace.zip')) {
        return path.join(base, entry.name);
      }
    }
  }
  return undefined;
}

function buildAssertionMutants(specPath: string, content: string): Array<{ id: string; description: string; mutatedContent: string }> {
  const mutants: Array<{ id: string; description: string; mutatedContent: string }> = [];

  if (content.includes('.toBeVisible()')) {
    mutants.push({
      id: 'mut-c-invert-visible',
      description: `Invert .toBeVisible() -> .toBeHidden() in ${specPath}`,
      mutatedContent: content.replace('.toBeVisible()', '.toBeHidden()'),
    });
  }
  if (content.includes('.toBeHidden()')) {
    mutants.push({
      id: 'mut-c-invert-hidden',
      description: `Invert .toBeHidden() -> .toBeVisible() in ${specPath}`,
      mutatedContent: content.replace('.toBeHidden()', '.toBeVisible()'),
    });
  }
  const textMatch = content.match(/expect\([^)]*\.getByText\(([^)]+)\)\)/);
  if (textMatch) {
    mutants.push({
      id: 'mut-c-expected-text',
      description: `Corrupt getByText() expected target in ${specPath}`,
      mutatedContent: content.replace(textMatch[0], `expect(page.getByText("__PIE_MUTATED_EXPECTATION__"))`),
    });
  }
  const countMatch = content.match(/\.toHaveCount\((\d+)\)/);
  if (countMatch) {
    const mutatedCount = Number(countMatch[1]) + 99;
    mutants.push({
      id: 'mut-c-count',
      description: `Mutate .toHaveCount(${countMatch[1]}) -> .toHaveCount(${mutatedCount}) in ${specPath}`,
      mutatedContent: content.replace(countMatch[0], `.toHaveCount(${mutatedCount})`),
    });
  }
  return mutants;
}

export function formatQaReportMarkdown(report: QaReport): string {
  const lines: string[] = [
    `# PIE QA Verification Report — ${report.featureName}`,
    '',
    `- **Status:** \`${report.status}\``,
    `- **Topology:** \`${report.topology}\``,
    `- **Runtime Verified:** \`${report.runtimeVerified}\``,
    `- **Generated:** ${report.generatedAt}`,
    `- **MCP Dependencies:** \`${report.environment.mcpDependenciesUsed}\``,
    '',
    '## Verification Layers',
    '| Layer | Status |',
    '|---|---|',
    `| UI | ${report.verificationLayers.UI} |`,
    `| API | ${report.verificationLayers.API} |`,
    `| CLIENT_RELOAD | ${report.verificationLayers.CLIENT_RELOAD} |`,
    `| DB | ${report.verificationLayers.DB} |`,
    '',
    '## Generated & Modified Files',
    ...report.generatedFiles.map((f) => `- CREATE \`${f}\``),
    ...report.modifiedFiles.map((f) => `- MODIFY \`${f}\``),
    '',
    '## Mutation Falsification',
    report.mutationResults.executed
      ? `- **Score:** ${report.mutationResults.mutationScore ?? 'N/A'}% (${report.mutationResults.killed}/${report.mutationResults.validTotal} valid mutants killed, ${report.mutationResults.survived} survived, ${report.mutationResults.invalid} invalid)`
      : '- Mutation testing skipped.',
    '',
    '## Findings',
    ...(report.findings.length > 0
      ? report.findings.map((f) => `- **[${f.category}]** (${f.severity}) ${f.actualBehavior}`)
      : ['- None']),
  ];
  return `${lines.join('\n')}\n`;
}

export async function runEvidenceDrivenGeneration(
  input: EvidenceDrivenGenerationInput,
): Promise<EvidenceDrivenGenerationResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const artifactDir = path.resolve(input.outArtifactDir ?? path.join(workspaceRoot, '.pie'));
  await fs.mkdir(artifactDir, { recursive: true });

  // Phase 1 — Repo graph hints + Requirement intake + Workflow Plan + Gherkin
  const repoGraph = await buildBrownfieldRepositoryGraph(workspaceRoot).catch(() => undefined);
  let workflowPlan = buildWorkflowPlan({
    ...input,
    ...(repoGraph ? { sourceHints: repoGraph.sourceHints } : {}),
  });
  let featureText = exportWorkflowToGherkin(workflowPlan);

  if (input.editedFeatureText) {
    if (isStaleWorkflowPlan(input.editedFeatureText, workflowPlan)) {
      const imported = importGherkinToWorkflowPlan(input.editedFeatureText, workflowPlan);
      if (!imported.success || !imported.plan) {
        throw new Error(`Invalid edited Gherkin feature: ${imported.errors.join('; ')}`);
      }
      workflowPlan = imported.plan;
      featureText = input.editedFeatureText;
    }
  }

  const workflowPlanPath = path.join(artifactDir, 'workflow-plan.json');
  const featureFilePath = path.join(artifactDir, `${workflowPlan.slug}.feature`);
  await fs.writeFile(workflowPlanPath, `${JSON.stringify(workflowPlan, null, 2)}\n`, 'utf8');
  await fs.writeFile(featureFilePath, featureText, 'utf8');

  // Phase 2 — Stateful Live Exploration & Verification
  const explorationBundlePath = path.join(artifactDir, 'exploration-evidence.json');
  const explorationBundle = await InteractiveWorkflowRunner.run({
    baseUrl: input.baseUrl,
    workspaceRoot,
    workflowPlan,
    checkpointPath: explorationBundlePath,
    storageStatePath: input.storageStatePath,
    loginConfig: input.loginConfig,
    allowMutatingActions: input.allowMutatingActions ?? true,
    allowDestructiveActions: input.allowDestructiveActions,
    designatedTestEnvironment: input.designatedTestEnvironment,
    dbVerifier: input.dbVerifier,
    repositoryGraph: repoGraph,
  });
  await saveExplorationContextBundle(explorationBundlePath, explorationBundle);

  const allowedEvidenceIds = [...new Set([
    ...explorationBundle.evidenceIndex.map((e) => e.id),
    ...explorationBundle.actions.map((a) => a.id),
    ...explorationBundle.locators.map((l) => l.id),
    ...explorationBundle.network.map((n) => n.id),
    ...explorationBundle.findings.map((f) => f.id),
    ...explorationBundle.scenarioStatuses.map((s) => s.scenarioId),
  ])];

  // Phase 3 — Authoring (Tier-L2 LlmAuthor if configured/supplied, else grounded synthesis / HybridAuthor)
  let candidate: CandidateChange;
  const featureTitle = workflowPlan.featureName;

  if (input.author === 'llm' || input.fullCodeProvider) {
    const llmAuthor = new LlmAuthor({ provider: input.fullCodeProvider });
    const rawCandidate = await llmAuthor.propose({
      featureName: featureTitle,
      mode: repoGraph && repoGraph.configPaths.length > 0 ? 'brownfield' : 'greenfield',
      baseUrl: input.baseUrl,
      requirements: workflowPlan.requirements.map((r) => `${r.id}: ${r.description}`).join('\n'),
      workflowPlan,
      explorationBundle,
      contextPacket: { repoGraph, explorationBundle },
      allowedEvidenceIds,
      fullCodeProvider: input.fullCodeProvider,
    });
    if (rawCandidate.usedFallback) {
      candidate = synthesizeGroundedCandidateFromBundle(featureTitle, workflowPlan, explorationBundle, repoGraph, workspaceRoot);
      candidate.usedFallback = true;
      candidate.authorKind = rawCandidate.authorKind;
      candidate.rationale = `${rawCandidate.rationale} (synthesized via exploration-grounded fallback)`;
    } else {
      candidate = rawCandidate;
    }
  } else if (explorationBundle.locators.length > 0) {
    candidate = synthesizeGroundedCandidateFromBundle(featureTitle, workflowPlan, explorationBundle, repoGraph, workspaceRoot);
  } else {
    const hybrid = new HybridAuthor();
    candidate = await hybrid.propose({
      featureName: featureTitle,
      mode: repoGraph && repoGraph.configPaths.length > 0 ? 'brownfield' : 'greenfield',
      baseUrl: input.baseUrl,
      requirements: workflowPlan.requirements.map((r) => r.description).join('\n'),
    });
  }

  // Handle NEEDS_INPUT / ABSTAIN cleanly
  if (candidate.status === 'NEEDS_INPUT' || candidate.status === 'ABSTAIN' || candidate.files.length === 0) {
    const report: QaReport = {
      reportVersion: '1.0',
      generatedAt: new Date().toISOString(),
      status: candidate.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'ABSTAINED',
      featureName: featureTitle,
      topology: explorationBundle.topology,
      runtimeVerified: explorationBundle.runtimeVerified,
      requirementCoverage: workflowPlan.requirements.map((r) => ({
        requirementId: r.id,
        title: r.title,
        status: 'NOT_COVERED',
        scenarioIds: workflowPlan.scenarios.filter((s) => s.requirementRefs.includes(r.id)).map((s) => s.id),
      })),
      scenarioCoverage: workflowPlan.scenarios.map((s) => ({
        scenarioId: s.id,
        title: s.title,
        category: s.category,
        applicability: s.applicability,
        explorationStatus: explorationBundle.scenarioStatuses.find((st) => st.scenarioId === s.id)?.status,
      })),
      workflowStatuses: explorationBundle.scenarioStatuses,
      generatedFiles: [],
      modifiedFiles: [],
      staticValidation: { passed: false, tscChecked: false, discoveryChecked: false, violations: candidate.validationErrors ?? [candidate.rationale] },
      execution: { executed: false, passed: false },
      failureClassifications: [],
      repairAttempts: [],
      intentInvariantPreserved: true,
      mutationResults: { executed: false, total: 0, validTotal: 0, killed: 0, survived: 0, invalid: 0, equivalent: 0, mutationScore: null, entries: [] },
      verificationLayers: {
        UI: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'UI'),
        API: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'API'),
        CLIENT_RELOAD: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'CLIENT_RELOAD'),
        DB: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'DB'),
      },
      findings: explorationBundle.findings,
      unverifiedBehaviors: workflowPlan.scenarios.map((s) => s.title),
      limitations: [...explorationBundle.limitations, candidate.rationale],
      artifacts: { workflowPlanPath, featureFilePath, explorationBundlePath },
      environment: { nodeVersion: process.version, platform: process.platform, workspaceRoot, mcpDependenciesUsed: 'none' },
    };
    return { workflowPlan, featureText, explorationBundle, candidate, qaReport: report };
  }

  // Stage 1 — Static Validation & Transactional Write
  const staticViolations: string[] = [];
  if (!candidate.fullCodeAuthoring && candidate.symbols.symbols.length > 0) {
    const nl = NamingLinter.lint(candidate.symbols);
    if (!nl.passed) staticViolations.push(...nl.violations.map((v) => v.message));
  }
  const specFiles = candidate.files.filter((f) => /\.(?:spec|test)\.(?:ts|tsx|js|jsx|mjs)$/i.test(f.relativePath));
  for (const spec of specFiles) {
    const aqg = AssertionQualityGate.evaluate(spec.content, featureTitle);
    if (!aqg.passed) staticViolations.push(...aqg.violations);
  }

  let writtenFiles: string[] = [];
  let modifiedFiles: string[] = [];
  let tscChecked = false;
  let tscPassed: boolean | undefined;
  let discoveryChecked = false;
  let discoveryPassed: boolean | undefined;

  if (input.write !== false) {
    const writeRes = await CandidateWriter.apply(workspaceRoot, candidate, {
      allowModify: true,
      validateLocalImports: true,
      overwriteCreate: true,
    });
    if (!writeRes.success) {
      staticViolations.push(...writeRes.errors);
    } else {
      writtenFiles = writeRes.written;
      modifiedFiles = writeRes.modified;
    }
  }

  // Run tsc if tsconfig exists and node_modules tsc exists
  const targetTsconfig = path.join(workspaceRoot, 'tsconfig.json');
  const tscTool = resolveWorkspaceCli(workspaceRoot, 'tsc');
  if (input.write !== false && staticViolations.length === 0 && fsSync.existsSync(targetTsconfig) && tscTool) {
    tscChecked = true;
    const tscRes = await runCommandInWorkspace(tscTool.cmd, [...tscTool.prefixArgs, '-p', targetTsconfig, '--noEmit'], workspaceRoot);
    tscPassed = tscRes.exitCode === 0;
    if (!tscPassed) {
      staticViolations.push(`TypeScript compilation failed: ${(tscRes.stdout + tscRes.stderr).slice(0, 600)}`);
    }
  }

  const pwTool = resolveWorkspaceCli(workspaceRoot, 'playwright');
  const canRunPlaywright = input.write !== false && Boolean(pwTool);

  const configCandidate = ['playwright.config.ts', 'playwright.config.js'].find((c) => fsSync.existsSync(path.join(workspaceRoot, c)));
  let projectArgs: string[] = [];
  if (configCandidate) {
    try {
      const cfgText = await fs.readFile(path.join(workspaceRoot, configCandidate), 'utf8');
      if (cfgText.includes("name: 'chromium'") || cfgText.includes('name: "chromium"')) {
        projectArgs = ['--project=chromium'];
      }
    } catch {}
  }

  const extraEnv: Record<string, string> = {};
  if (input.baseUrl) {
    extraEnv['PLAYWRIGHT_TEST_BASE_URL'] = input.baseUrl;
    extraEnv['BASE_URL'] = input.baseUrl;
    extraEnv['FRONTEND_BASE_URL'] = input.baseUrl;
    try {
      const parsedUrl = new URL(input.baseUrl);
      if (parsedUrl.port) {
        extraEnv['PORT'] = parsedUrl.port;
      }
    } catch {}
  }

  if (canRunPlaywright && pwTool && staticViolations.length === 0) {
    discoveryChecked = true;
    const discRes = await runCommandInWorkspace(
      pwTool.cmd,
      [...pwTool.prefixArgs, 'test', '--list', ...projectArgs, ...specFiles.map((s) => s.relativePath)],
      workspaceRoot,
      60_000,
      extraEnv,
    );
    discoveryPassed = discRes.exitCode === 0;
    if (!discoveryPassed) {
      staticViolations.push(`Playwright test discovery failed: ${(discRes.stdout + discRes.stderr).slice(0, 600)}`);
    }
  }

  // Stage 2 — Isolated Execution & Bounded Trace-Guided Repair
  let executed = false;
  let execPassed = false;
  let execExitCode: number | undefined;
  let execDurationMs: number | undefined;
  let execStdout = '';
  const failureClassifications: QaReport['failureClassifications'] = [];
  const repairAttempts: QaReport['repairAttempts'] = [];
  let intentInvariantPreserved = true;

  if (input.verify !== false && canRunPlaywright && pwTool && staticViolations.length === 0) {
    const maxIter = Math.min(Math.max(input.maxRepairIterations ?? 3, 1), 5);
    const originalSpecContents = new Map(specFiles.map((s) => [s.relativePath, s.content]));
    const started = Date.now();
    executed = true;

    for (let iter = 0; iter <= maxIter; iter += 1) {
      const runRes = await runCommandInWorkspace(
        pwTool.cmd,
        [...pwTool.prefixArgs, 'test', ...projectArgs, ...specFiles.map((s) => s.relativePath), '--trace=on', '--reporter=line'],
        workspaceRoot,
        90_000,
        extraEnv,
      );
      execExitCode = runRes.exitCode;
      execStdout = (runRes.stdout + '\n' + runRes.stderr).slice(-2000);
      execDurationMs = Date.now() - started;

      if (execExitCode === 0) {
        execPassed = true;
        break;
      }

      // Diagnose failure using PIE's Trace/Diagnostic engine when trace.zip exists
      let category = 'UNKNOWN_ERROR';
      let summary = execStdout.slice(0, 300);
      const traceZip = await findFirstTraceZip(workspaceRoot);
      if (traceZip) {
        try {
          const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(traceZip);
          if (traceEntryName) {
            const traceText = await ArchiveReader.readEntriesAsText(traceZip, traceEntryNames ?? [traceEntryName]);
            const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
              ? await ArchiveReader.readEntriesAsText(traceZip, networkEntryNames ?? [networkEntryName!])
              : '';
            const context = TraceParser.assembleDiagnosticContext(traceText.split('\n'), networkText.split('\n'));
            const correlated = EvidenceCorrelator.correlate(context);
            const has500 =
              context.networkEvents.some((n) => n.status >= 500) ||
              correlated.classification.category === 'BACKEND_500' ||
              explorationBundle.network.some((n) => n.status >= 500);
            category = has500 ? 'BACKEND_500' : correlated.classification.category;
            summary = context.failedAction.errorMessage ?? correlated.classification.reason ?? summary;
          }
        } catch {
          // Keep stdout fallback summary
        }
      }
      if (category === 'UNKNOWN_ERROR' && explorationBundle.network.some((n) => n.status >= 500)) {
        category = 'BACKEND_500';
      }

      const defectOwner: 'automation' | 'application' | 'environment' | 'unknown' =
        category === 'BACKEND_500' ? 'application' : category === 'LOCATOR_DRIFT' ? 'automation' : 'unknown';
      failureClassifications.push({ category, summary, defectOwner });

      // Never auto-repair application/backend defects or exceed repair budget
      if (defectOwner === 'application' || iter === maxIter || !input.repairCallback) {
        break;
      }

      const proposedPatch = await input.repairCallback({
        specFiles: candidate.files,
        failureCategory: category,
        errorText: summary,
        iteration: iter + 1,
      });
      if (!proposedPatch) break;

      // Enforce Assertion Preservation Invariant before accepting repaired spec!
      let invariantOk = true;
      for (const updated of proposedPatch) {
        const orig = originalSpecContents.get(updated.relativePath);
        if (orig && !assertionsPreserved(orig, updated.content)) {
          invariantOk = false;
        }
      }

      repairAttempts.push({
        iteration: iter + 1,
        category,
        action: invariantOk ? 'apply-repaired-files' : 'rejected-assertion-weakening',
        assertionsPreserved: invariantOk,
        succeeded: false,
      });

      if (!invariantOk) {
        intentInvariantPreserved = false;
        break;
      }

      await CandidateWriter.apply(workspaceRoot, { files: proposedPatch.map((f) => ({ ...f, action: 'MODIFY' })) }, { allowModify: true });
      candidate = { ...candidate, files: proposedPatch };
      const recheck = await runCommandInWorkspace(
        pwTool.cmd,
        [...pwTool.prefixArgs, 'test', ...projectArgs, ...specFiles.map((s) => s.relativePath), '--reporter=line'],
        workspaceRoot,
        90_000,
        extraEnv,
      );
      if (recheck.exitCode === 0) {
        repairAttempts[repairAttempts.length - 1]!.succeeded = true;
        execExitCode = 0;
        execPassed = true;
        break;
      }
    }
  }

  // Stage 3 — Mutation Falsification (Level C Assertions + Level B API Fault Injection)
  const mutationEntries: MutationResultEntry[] = [];
  let mutationExecuted = false;

  if (input.runMutations !== false && execPassed && canRunPlaywright && pwTool) {
    mutationExecuted = true;
    for (const spec of specFiles) {
      const targetPath = path.resolve(workspaceRoot, spec.relativePath);
      const original = await fs.readFile(targetPath, 'utf8');
      const levelCMutants = buildAssertionMutants(spec.relativePath, original);

      for (const mut of levelCMutants) {
        try {
          await fs.writeFile(targetPath, mut.mutatedContent, 'utf8');
          const res = await runCommandInWorkspace(
            pwTool.cmd,
            [...pwTool.prefixArgs, 'test', ...projectArgs, spec.relativePath, '--reporter=line'],
            workspaceRoot,
            60_000,
            extraEnv,
          );
          mutationEntries.push({
            id: mut.id,
            level: 'LEVEL_C_ASSERTION',
            specFile: spec.relativePath,
            description: mut.description,
            status: res.exitCode !== 0 ? 'KILLED' : 'SURVIVED',
            exitCode: res.exitCode,
          });
        } catch {
          mutationEntries.push({
            id: mut.id,
            level: 'LEVEL_C_ASSERTION',
            specFile: spec.relativePath,
            description: mut.description,
            status: 'INVALID',
          });
        } finally {
          await fs.writeFile(targetPath, original, 'utf8');
        }
      }

      // Level B: page.route() API fault injection if API calls were observed
      const hasApiEndpoints = explorationBundle.network.some((n) => n.url.includes('/api/'));
      if (hasApiEndpoints) {
        const injected = `test.beforeEach(async ({ page }) => {\n  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'PIE_INJECTED_500' }) }));\n});\n`;
        const mutatedApiContent = original.includes('test.describe')
          ? original.replace(/(test\.describe\s*\()/, `${injected}\n$1`)
          : original.replace(/(test\s*\()/, `${injected}\n$1`);
        if (mutatedApiContent !== original) {
          try {
            await fs.writeFile(targetPath, mutatedApiContent, 'utf8');
            const res = await runCommandInWorkspace(
              pwTool.cmd,
              [...pwTool.prefixArgs, 'test', ...projectArgs, spec.relativePath, '--reporter=line'],
              workspaceRoot,
              60_000,
              extraEnv,
            );
            mutationEntries.push({
              id: 'mut-b-api-500',
              level: 'LEVEL_B_API_FAULT',
              specFile: spec.relativePath,
              description: `Inject HTTP 500 via page.route('**/api/**') in ${spec.relativePath}`,
              status: res.exitCode !== 0 ? 'KILLED' : 'SURVIVED',
              exitCode: res.exitCode,
            });
          } finally {
            await fs.writeFile(targetPath, original, 'utf8');
          }
        }
      }
    }
  }

  const killed = mutationEntries.filter((m) => m.status === 'KILLED').length;
  const survived = mutationEntries.filter((m) => m.status === 'SURVIVED').length;
  const invalid = mutationEntries.filter((m) => m.status === 'INVALID').length;
  const equivalent = mutationEntries.filter((m) => m.status === 'EQUIVALENT').length;
  const validTotal = killed + survived;
  const mutationScore = validTotal > 0 ? Number(((killed / validTotal) * 100).toFixed(2)) : null;

  const hasDefects = explorationBundle.findings.some((f) => f.category === 'SPEC_VIOLATION' || f.category === 'RUNTIME_ERROR');
  const finalStatus: QaReport['status'] = staticViolations.length > 0 || (executed && !execPassed)
    ? 'VERIFICATION_FAILED'
    : execPassed && (!hasDefects && (mutationScore === null || mutationScore >= 80))
      ? 'VERIFIED'
      : execPassed
        ? 'VERIFIED_WITH_WARNINGS'
        : 'GENERATED';

  const qaReportJsonPath = path.join(artifactDir, 'qa-report.json');
  const qaReportMarkdownPath = path.join(artifactDir, 'qa-report.md');

  const qaReport: QaReport = {
    reportVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status: finalStatus,
    featureName: featureTitle,
    topology: explorationBundle.topology,
    runtimeVerified: explorationBundle.runtimeVerified,
    requirementCoverage: workflowPlan.requirements.map((r) => {
      const relatedSc = workflowPlan.scenarios.filter((s) => s.requirementRefs.includes(r.id));
      const statuses = relatedSc.map((s) => explorationBundle.scenarioStatuses.find((st) => st.scenarioId === s.id)?.status);
      const covStatus = statuses.some((st) => st === 'BLOCKED' || st === 'DEFECT_DETECTED')
        ? 'BLOCKED'
        : statuses.some((st) => st === 'VERIFIED')
          ? 'COVERED'
          : 'NOT_COVERED';
      return {
        requirementId: r.id,
        title: r.title,
        status: covStatus,
        scenarioIds: relatedSc.map((s) => s.id),
      };
    }),
    scenarioCoverage: workflowPlan.scenarios.map((s) => ({
      scenarioId: s.id,
      title: s.title,
      category: s.category,
      applicability: s.applicability,
      explorationStatus: explorationBundle.scenarioStatuses.find((st) => st.scenarioId === s.id)?.status,
    })),
    workflowStatuses: explorationBundle.scenarioStatuses,
    generatedFiles: writtenFiles,
    modifiedFiles,
    staticValidation: {
      passed: staticViolations.length === 0,
      tscChecked,
      ...(tscPassed !== undefined ? { tscPassed } : {}),
      discoveryChecked,
      ...(discoveryPassed !== undefined ? { discoveryPassed } : {}),
      violations: staticViolations,
    },
    execution: {
      executed,
      passed: execPassed,
      ...(execExitCode !== undefined ? { exitCode: execExitCode } : {}),
      ...(execDurationMs !== undefined ? { durationMs: execDurationMs } : {}),
      ...(execStdout ? { stdoutSnippet: execStdout } : {}),
    },
    failureClassifications,
    repairAttempts,
    intentInvariantPreserved,
    mutationResults: {
      executed: mutationExecuted,
      total: mutationEntries.length,
      validTotal,
      killed,
      survived,
      invalid,
      equivalent,
      mutationScore,
      entries: mutationEntries,
    },
    verificationLayers: {
      UI: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'UI'),
      API: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'API'),
      CLIENT_RELOAD: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'CLIENT_RELOAD'),
      DB: summarizeLayerStatus(explorationBundle.scenarioStatuses, 'DB'),
    },
    findings: explorationBundle.findings,
    unverifiedBehaviors: explorationBundle.scenarioStatuses.filter((s) => s.status !== 'VERIFIED').map((s) => s.scenarioId),
    limitations: explorationBundle.limitations,
    artifacts: {
      workflowPlanPath,
      featureFilePath,
      explorationBundlePath,
      qaReportJsonPath,
      qaReportMarkdownPath,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      workspaceRoot,
      mcpDependenciesUsed: 'none',
    },
  };

  await fs.writeFile(qaReportJsonPath, `${JSON.stringify(qaReport, null, 2)}\n`, 'utf8');
  await fs.writeFile(qaReportMarkdownPath, formatQaReportMarkdown(qaReport), 'utf8');

  return {
    workflowPlan,
    featureText,
    explorationBundle,
    candidate,
    qaReport,
  };
}
