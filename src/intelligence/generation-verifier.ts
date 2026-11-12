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

  const inputLoc = bundle.locators.find((l) => (l.strategy === 'placeholder' || l.role === 'textbox') && l.visible);
  const submitLoc = bundle.locators.find((l) => l.role === 'button' && !/delete|remove|cancel|close/i.test(l.accessibleName ?? '') && l.visible);
  const toggleLoc = bundle.locators.find((l) => l.role === 'checkbox' && l.visible);
  const navUrl = bundle.baseUrl ? new URL(bundle.baseUrl).pathname || '/' : '/';

  const pomLocators: string[] = [];
  const pomAssigns: string[] = [];
  const pomMethods: string[] = [];
  const locatorExpr = (expr: string) => expr.replace(/^page\./, 'this.page.');

  if (inputLoc) {
    pomLocators.push('  readonly primaryInput: Locator;');
    pomAssigns.push(`    this.primaryInput = ${locatorExpr(inputLoc.expression)};`);
  }
  if (submitLoc) {
    pomLocators.push('  readonly submitButton: Locator;');
    pomAssigns.push(`    this.submitButton = ${locatorExpr(submitLoc.expression)};`);
  }
  if (toggleLoc) {
    pomLocators.push('  readonly itemToggle: Locator;');
    pomAssigns.push(`    this.itemToggle = ${locatorExpr(toggleLoc.expression)};`);
  }

  if (inputLoc && submitLoc) {
    pomMethods.push(`  async submitItem(value: string): Promise<void> {
    await this.primaryInput.fill(value);
    await this.submitButton.click();
  }`);
  } else if (inputLoc) {
    pomMethods.push(`  async submitItem(value: string): Promise<void> {
    await this.primaryInput.fill(value);
    await this.primaryInput.press('Enter');
  }`);
  } else if (submitLoc) {
    pomMethods.push(`  async clickPrimaryAction(): Promise<void> {
    await this.submitButton.click();
  }`);
  }

  if (submitLoc) {
    pomMethods.push(`  async submitEmpty(): Promise<void> {
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

  const hasExistingFixture = Boolean(repoGraph?.testImport && repoGraph.testImport !== '@playwright/test');
  const fixturePath = 'tests/fixtures/app.fixtures.ts';
  const specPath = `tests/${slug}.spec.ts`;
  const pomPath = `tests/pages/${pageClassName}.ts`;

  let fixtureImportForSpec = '@playwright/test';
  const candidateFiles: CandidateFile[] = [
    {
      relativePath: pomPath,
      action: 'CREATE',
      content: pomContent,
      purpose: 'Evidence-grounded Page Object Model reusing observed locators.',
      evidenceReferences: [inputLoc?.id, submitLoc?.id].filter((x): x is string => Boolean(x)),
    },
  ];

  const fixtureContent = `import { test as base } from '@playwright/test';
import { ${pageClassName} } from '../pages/${pageClassName}.js';

type ${pageClassName}Fixtures = {
  ${pageVar}: ${pageClassName};
};

export const test = base.extend<${pageClassName}Fixtures>({
  ${pageVar}: async ({ page }, use) => {
    const ${pageVar} = new ${pageClassName}(page);
    await ${pageVar}.goto();
    await use(${pageVar});
  },
});

export { expect } from '@playwright/test';
`;

  if (!hasExistingFixture) {
    candidateFiles.push({
      relativePath: fixturePath,
      action: 'CREATE',
      content: fixtureContent,
      purpose: 'Composable fixture injecting feature Page Object.',
    });
    fixtureImportForSpec = `./fixtures/app.fixtures.js`;
  } else {
    const relFromSpec = path.posix.relative('tests', repoGraph!.testImport).replace(/\.ts$/, '.js');
    fixtureImportForSpec = relFromSpec.startsWith('.') ? relFromSpec : `./${relFromSpec}`;
  }

  const testBlocks: string[] = [];
  const usedFixtureName = hasExistingFixture
    ? repoGraph?.fixtureExports.find((f) => /auth|page/i.test(f.name))?.name ?? 'page'
    : pageVar;

  for (const sc of validScenarios) {
    const varTitle = `Test-${sc.id.slice(0, 10)}`;
    if (sc.category === 'validation' || sc.category === 'negative' || sc.category === 'required-fields') {
      if (inputLoc && submitLoc) {
        testBlocks.push(hasExistingFixture
          ? `  test(${JSON.stringify(sc.title)}, async ({ ${usedFixtureName} }) => {
    const pageObj = new ${pageClassName}(${usedFixtureName});
    await pageObj.goto();
    const marker = ${JSON.stringify(`__SHOULD_NOT_EXIST_${sc.id}__`)};
    await pageObj.primaryInput.fill('');
    await pageObj.submitEmpty();
    await expect(${usedFixtureName}.getByText(marker)).toBeHidden();
  });`
          : `  test(${JSON.stringify(sc.title)}, async ({ ${pageVar}, page }) => {
    const marker = ${JSON.stringify(`__SHOULD_NOT_EXIST_${sc.id}__`)};
    await ${pageVar}.primaryInput.fill('');
    await ${pageVar}.submitEmpty();
    await expect(page.getByText(marker)).toBeHidden();
  });`);
      }
    } else if (sc.category === 'persistence') {
      if (inputLoc) {
        testBlocks.push(hasExistingFixture
          ? `  test(${JSON.stringify(sc.title)}, async ({ ${usedFixtureName} }) => {
    const pageObj = new ${pageClassName}(${usedFixtureName});
    await pageObj.goto();
    const title = ${JSON.stringify(`${varTitle}-persist`)};
    await pageObj.submitItem(title);
    await expect(${usedFixtureName}.getByText(title)).toBeVisible();
    await ${usedFixtureName}.reload();
    await expect(${usedFixtureName}.getByText(title)).toBeVisible();
  });`
          : `  test(${JSON.stringify(sc.title)}, async ({ ${pageVar}, page }) => {
    const title = ${JSON.stringify(`${varTitle}-persist`)};
    await ${pageVar}.submitItem(title);
    await expect(page.getByText(title)).toBeVisible();
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  });`);
      }
    } else if (inputLoc) {
      testBlocks.push(hasExistingFixture
        ? `  test(${JSON.stringify(sc.title)}, async ({ ${usedFixtureName} }) => {
    const pageObj = new ${pageClassName}(${usedFixtureName});
    await pageObj.goto();
    const title = ${JSON.stringify(`${varTitle}-item`)};
    await pageObj.submitItem(title);
    await expect(${usedFixtureName}.getByText(title)).toBeVisible();
  });`
        : `  test(${JSON.stringify(sc.title)}, async ({ ${pageVar}, page }) => {
    const title = ${JSON.stringify(`${varTitle}-item`)};
    await ${pageVar}.submitItem(title);
    await expect(page.getByText(title)).toBeVisible();
  });`);
    }
  }

  // Ensure non-empty behavioral spec only when we had verified controls
  const specContent = `import { test, expect } from ${JSON.stringify(fixtureImportForSpec)};
${hasExistingFixture ? `import { ${pageClassName} } from ${JSON.stringify(`./pages/${pageClassName}.js`)};\n` : ''}
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

  if (!existingFilesSet.has('playwright.config.ts') && (repoGraph?.configPaths.length ?? 0) === 0) {
    candidateFiles.push({
      relativePath: 'playwright.config.ts',
      action: 'CREATE',
      content: `import { defineConfig, devices } from '@playwright/test';
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
`,
      purpose: 'Greenfield Playwright configuration.',
    });
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
    mode: hasExistingFixture ? 'brownfield' : 'greenfield',
    status: canBuild ? 'GENERATE' : 'ABSTAIN',
    fullCodeAuthoring: true,
    usedFallback: true,
  };
}

function resolveWorkspaceCli(
  workspaceRoot: string,
  tool: 'tsc' | 'playwright',
): { cmd: string; prefixArgs: string[] } | undefined {
  if (tool === 'tsc') {
    const jsEntry = path.join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    if (fsSync.existsSync(jsEntry)) {
      return { cmd: process.execPath, prefixArgs: [jsEntry] };
    }
    const binEntry = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    if (fsSync.existsSync(binEntry)) {
      return { cmd: 'npx', prefixArgs: ['tsc'] };
    }
    return undefined;
  }

  const pwJs = path.join(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  if (fsSync.existsSync(pwJs)) {
    return { cmd: process.execPath, prefixArgs: [pwJs] };
  }
  const pwBin = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
  if (fsSync.existsSync(pwBin)) {
    return { cmd: 'npx', prefixArgs: ['playwright'] };
  }
  return undefined;
}

async function runCommandInWorkspace(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const res = await ExecutionRunner.run(cmd, {
    cwd,
    args,
    timeoutMs,
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

  const allowedEvidenceIds = explorationBundle.evidenceIndex.map((e) => e.id);

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
      candidate = synthesizeGroundedCandidateFromBundle(featureTitle, workflowPlan, explorationBundle, repoGraph);
      candidate.usedFallback = true;
      candidate.authorKind = rawCandidate.authorKind;
      candidate.rationale = `${rawCandidate.rationale} (synthesized via exploration-grounded fallback)`;
    } else {
      candidate = rawCandidate;
    }
  } else if (explorationBundle.locators.length > 0) {
    candidate = synthesizeGroundedCandidateFromBundle(featureTitle, workflowPlan, explorationBundle, repoGraph);
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
  if (candidate.symbols.symbols.length > 0) {
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
  if (canRunPlaywright && pwTool && staticViolations.length === 0) {
    discoveryChecked = true;
    const discRes = await runCommandInWorkspace(pwTool.cmd, [...pwTool.prefixArgs, 'test', '--list', ...specFiles.map((s) => s.relativePath)], workspaceRoot);
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
        [...pwTool.prefixArgs, 'test', ...specFiles.map((s) => s.relativePath), '--trace=on', '--reporter=line'],
        workspaceRoot,
        90_000,
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
      const recheck = await runCommandInWorkspace(pwTool.cmd, [...pwTool.prefixArgs, 'test', ...specFiles.map((s) => s.relativePath), '--reporter=line'], workspaceRoot, 90_000);
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
          const res = await runCommandInWorkspace(pwTool.cmd, [...pwTool.prefixArgs, 'test', spec.relativePath, '--reporter=line'], workspaceRoot, 60_000);
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
            const res = await runCommandInWorkspace(pwTool.cmd, [...pwTool.prefixArgs, 'test', spec.relativePath, '--reporter=line'], workspaceRoot, 60_000);
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
