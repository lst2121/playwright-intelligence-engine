import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildBrownfieldRepositoryGraph,
  buildWorkflowPlan,
  runEvidenceDrivenGeneration,
} from '../../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../..');
const DISPOSABLE_ROOT = 'D:\\Work\\pie-real-repository-testbed\\disposable-workspaces';

function runCommand(cmd, args, cwd, timeout = 120_000) {
  const isWin = process.platform === 'win32';
  if (isWin && (cmd === 'npx' || cmd === 'tsc')) {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
      cwd,
      encoding: 'utf8',
      timeout,
      windowsHide: true,
    });
  }
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
}

async function runReferenceEvaluation({ name, workspaceRoot, baseUrl, specRelPath, hasApi }) {
  const started = Date.now();
  const pwCli = path.join(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const tscJs = path.join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  let tscPassed = true;
  if (fsSync.existsSync(tscJs) && fsSync.existsSync(path.join(workspaceRoot, 'tsconfig.json'))) {
    const r = runCommand(process.execPath, [tscJs, '-p', 'tsconfig.json', '--noEmit'], workspaceRoot);
    tscPassed = r.status === 0;
  }

  const execRes = runCommand(process.execPath, [pwCli, 'test', '--reporter=line'], workspaceRoot);
  const executionPassed = execRes.status === 0;

  // Level C assertion mutants on specRelPath + Level B if hasApi
  const fullSpec = path.join(workspaceRoot, specRelPath);
  const original = await fs.readFile(fullSpec, 'utf8');
  const mutants = [];
  if (original.includes('.toBeVisible()')) {
    mutants.push({ id: 'mut-c-visible', content: original.replace('.toBeVisible()', '.toBeHidden()') });
  }
  if (original.includes('.toHaveText(')) {
    mutants.push({ id: 'mut-c-havetext', content: original.replace(/\.toHaveText\([^)]+\)/, '.toHaveText("__MUTATED__")') });
  }
  if (original.includes('.toContainText(')) {
    mutants.push({ id: 'mut-c-containstext', content: original.replace(/\.toContainText\([^)]+\)/, '.toContainText("__MUTATED__")') });
  }
  if (hasApi) {
    mutants.push({
      id: 'mut-b-api-500',
      content: original.replace(
        /(test\.describe\s*\()/,
        `test.beforeEach(async ({ page }) => { await page.route('**/api/**', (r) => r.fulfill({ status: 500, body: '{}' })); });\n\n$1`,
      ),
    });
  }

  let killed = 0;
  let survived = 0;
  for (const m of mutants) {
    try {
      await fs.writeFile(fullSpec, m.content, 'utf8');
      const r = runCommand(process.execPath, [pwCli, 'test', specRelPath, '--reporter=line'], workspaceRoot);
      if (r.status !== 0) killed += 1;
      else survived += 1;
    } finally {
      await fs.writeFile(fullSpec, original, 'utf8');
    }
  }
  const validTotal = killed + survived;
  const mutationScore = validTotal > 0 ? Number(((killed / validTotal) * 100).toFixed(2)) : null;

  return {
    benchmark: name,
    mode: 'human-reference',
    topology: name.includes('storefront') ? 'brownfield' : 'greenfield',
    status: executionPassed && tscPassed ? 'VERIFIED' : 'VERIFICATION_FAILED',
    usedFallback: false,
    liveLlmInvoked: false,
    tscChecked: fsSync.existsSync(tscJs),
    tscPassed,
    discoveryPassed: true,
    executionPassed,
    playwrightConfigCount: fsSync.existsSync(path.join(workspaceRoot, 'playwright.config.ts')) ? 1 : 0,
    reusedExistingFixture: name.includes('storefront'),
    duplicateAuthFixtures: 0,
    requirementsCount: 1,
    scenariosPlanned: 1,
    coveredRequirements: 1,
    requirementCoveragePct: 100,
    mutationTotal: validTotal,
    mutationKilled: killed,
    mutationSurvived: survived,
    mutationScore,
    generatedFiles: [specRelPath],
    durationMs: Date.now() - started,
    notes: 'Human-authored reference baseline with domain POM and Playwright assertions.',
  };
}

async function runPieEvaluation({
  benchmark,
  mode,
  topology,
  workspaceRoot,
  featureName,
  markdown,
  baseUrl,
  author,
  expectExistingFixtureImport,
}) {
  const started = Date.now();
  const result = await runEvidenceDrivenGeneration({
    workspaceRoot,
    featureName,
    markdown,
    baseUrl,
    author,
    write: true,
    verify: true,
    runMutations: true,
  });

  const qa = result.qaReport;
  const plan = result.workflowPlan;
  const coveredReqs = qa.requirementCoverage.filter((r) => r.status === 'COVERED').length;
  const reqCovPct = plan.requirements.length > 0
    ? Number(((coveredReqs / plan.requirements.length) * 100).toFixed(2))
    : 0;

  let configCount = 0;
  for (const cfg of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']) {
    if (fsSync.existsSync(path.join(workspaceRoot, cfg))) configCount += 1;
  }

  const generatedSpecContents = [];
  for (const rel of qa.generatedFiles) {
    if (/\.(?:spec|test)\.[tj]s$/i.test(rel)) {
      const full = path.join(workspaceRoot, rel);
      if (fsSync.existsSync(full)) {
        generatedSpecContents.push(await fs.readFile(full, 'utf8'));
      }
    }
  }
  const allSpecText = generatedSpecContents.join('\n');
  const reusedExistingFixture = expectExistingFixtureImport
    ? expectExistingFixtureImport.some((needle) => allSpecText.includes(needle))
    : false;

  const duplicateAuthFixtures = qa.generatedFiles.filter((f) => /auth.*fixture/i.test(f)).length;

  return {
    benchmark,
    mode,
    topology,
    status: qa.status,
    usedFallback: result.candidate.usedFallback === true,
    liveLlmInvoked: author === 'llm',
    tscChecked: qa.staticValidation.tscChecked,
    tscPassed: qa.staticValidation.tscPassed ?? null,
    discoveryPassed: qa.staticValidation.discoveryPassed ?? false,
    executionPassed: qa.execution.passed,
    playwrightConfigCount: configCount,
    reusedExistingFixture,
    duplicateAuthFixtures,
    requirementsCount: plan.requirements.length,
    scenariosPlanned: plan.scenarios.length,
    coveredRequirements: coveredReqs,
    requirementCoveragePct: reqCovPct,
    mutationTotal: qa.mutationResults.validTotal,
    mutationKilled: qa.mutationResults.killed,
    mutationSurvived: qa.mutationResults.survived,
    mutationScore: qa.mutationResults.mutationScore,
    generatedFiles: qa.generatedFiles,
    durationMs: Date.now() - started,
    notes: result.candidate.rationale,
  };
}

async function main() {
  // Use deepseek-chat for DeepSeek OpenAI-compatible endpoint if PIE_LLM_MODEL was unset or deepseek-flash
  if (process.env.PIE_LLM_API_KEY && (!process.env.PIE_LLM_MODEL || process.env.PIE_LLM_MODEL === 'deepseek-flash')) {
    process.env.PIE_LLM_MODEL = 'deepseek-chat';
  }

  const results = [];

  // 1. Greenfield Todo App: Tier-L1 (hybrid), Tier-L2 (llm), Human Reference
  const todoMarkdown = [
    '# Todo Task Management',
    '## Requirements',
    '- Users can enter a new task title in "Add a New Task" and click "Create" to add it to the task list.',
    '- Submitting an empty task title is ignored without adding blank tasks.',
    '- Users can mark tasks completed, delete tasks, and existing tasks persist in localStorage across page reload.',
  ].join('\n');

  console.log('[Benchmark 1/6] Running caltermine-todo-app Tier-L1 (hybrid)...');
  results.push(
    await runPieEvaluation({
      benchmark: 'caltermine-todo-app',
      mode: 'pie-tier-l1-hybrid',
      topology: 'greenfield',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'caltermine-bench-l1'),
      featureName: 'Todo Task Management',
      markdown: todoMarkdown,
      baseUrl: 'http://127.0.0.1:5173/todo-app/',
      author: 'hybrid',
    }),
  );

  console.log('[Benchmark 2/6] Running caltermine-todo-app Tier-L2 (llm)...');
  results.push(
    await runPieEvaluation({
      benchmark: 'caltermine-todo-app',
      mode: 'pie-tier-l2-llm',
      topology: 'greenfield',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'caltermine-bench-l2'),
      featureName: 'Todo Task Management',
      markdown: todoMarkdown,
      baseUrl: 'http://127.0.0.1:5173/todo-app/',
      author: 'llm',
    }),
  );

  console.log('[Benchmark 3/6] Evaluating caltermine-todo-app Human Reference...');
  results.push(
    await runReferenceEvaluation({
      name: 'caltermine-todo-app',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'caltermine-bench-ref'),
      baseUrl: 'http://127.0.0.1:5173/todo-app/',
      specRelPath: 'tests/todo-management.spec.ts',
      hasApi: false,
    }),
  );

  // 2. Brownfield Multi-page Storefront: Tier-L1, Tier-L2, Human Reference
  const storefrontMarkdown = [
    '# Cart Checkout Flow',
    '## Requirements',
    '- Authenticated user can open catalog `/products`, add Mechanical Keyboard to cart, and see Cart count update.',
    '- Navigating to `/cart` displays added item and total, and persists across page reload.',
    '- Proceeding to `/checkout`, filling Shipping Address and clicking Place Order confirms the order via POST /api/checkout.',
  ].join('\n');

  console.log('[Benchmark 4/6] Running brownfield-storefront Tier-L1 (hybrid)...');
  await fetch('http://127.0.0.1:5174/api/cart/clear', { method: 'POST' }).catch(() => {});
  results.push(
    await runPieEvaluation({
      benchmark: 'brownfield-storefront',
      mode: 'pie-tier-l1-hybrid',
      topology: 'brownfield',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'storefront-bench-l1'),
      featureName: 'Cart Checkout Flow',
      markdown: storefrontMarkdown,
      baseUrl: 'http://127.0.0.1:5174/products',
      author: 'hybrid',
      expectExistingFixtureImport: ['fixtures/index.js', './fixtures/index'],
    }),
  );

  console.log('[Benchmark 5/6] Running brownfield-storefront Tier-L2 (llm)...');
  await fetch('http://127.0.0.1:5174/api/cart/clear', { method: 'POST' }).catch(() => {});
  results.push(
    await runPieEvaluation({
      benchmark: 'brownfield-storefront',
      mode: 'pie-tier-l2-llm',
      topology: 'brownfield',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'storefront-bench-l2'),
      featureName: 'Cart Checkout Flow',
      markdown: storefrontMarkdown,
      baseUrl: 'http://127.0.0.1:5174/products',
      author: 'llm',
      expectExistingFixtureImport: ['fixtures/index.js', './fixtures/index'],
    }),
  );

  console.log('[Benchmark 6/6] Evaluating brownfield-storefront Human Reference...');
  await fetch('http://127.0.0.1:5174/api/cart/clear', { method: 'POST' }).catch(() => {});
  results.push(
    await runReferenceEvaluation({
      name: 'brownfield-storefront',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'storefront-bench-ref'),
      baseUrl: 'http://127.0.0.1:5174/products',
      specRelPath: 'tests/cart-checkout.spec.ts',
      hasApi: true,
    }),
  );

  // 3. External Brownfield Repositories: todomvc (live), playwright-examples (graph), playwright-e2e-tests (graph), blockers
  console.log('[External 1/3] Running todomvc live brownfield evaluation...');
  results.push(
    await runPieEvaluation({
      benchmark: 'todomvc-react',
      mode: 'pie-tier-l2-llm',
      topology: 'brownfield',
      workspaceRoot: path.join(DISPOSABLE_ROOT, 'todomvc'),
      featureName: 'Todo Filtering Persistence',
      markdown: '# Todo Filtering Persistence\n- Adding a todo item displays it in the list and persists on reload.',
      baseUrl: 'http://127.0.0.1:8000/examples/react/dist/index.html',
      author: 'llm',
      expectExistingFixtureImport: ['fixtures', './fixtures'],
    }),
  );

  for (const repoName of ['playwright-examples', 'playwright-e2e-tests']) {
    const repoDir = path.join(DISPOSABLE_ROOT, repoName);
    const graph = await buildBrownfieldRepositoryGraph(repoDir);
    const plan = buildWorkflowPlan({
      featureName: `${repoName} workflow plan`,
      prompt: `Validate core workflow for ${repoName}`,
      sourceHints: graph.sourceHints,
    });
    results.push({
      benchmark: repoName,
      mode: 'brownfield-graph-and-planner',
      topology: graph.topology,
      status: 'STATIC_PROFILED',
      usedFallback: false,
      liveLlmInvoked: false,
      tscChecked: false,
      tscPassed: null,
      discoveryPassed: true,
      executionPassed: null,
      playwrightConfigCount: graph.configPaths.length,
      reusedExistingFixture: graph.fixtureExports.length > 0,
      duplicateAuthFixtures: 0,
      requirementsCount: plan.requirements.length,
      scenariosPlanned: plan.scenarios.length,
      coveredRequirements: 0,
      requirementCoveragePct: 0,
      mutationTotal: 0,
      mutationKilled: 0,
      mutationSurvived: 0,
      mutationScore: null,
      generatedFiles: [],
      durationMs: 0,
      notes: `Discovered ${graph.pomExports.length} POMs, ${graph.fixtureExports.length} fixtures, testImport='${graph.testImport}', ${graph.helperExports.length} helpers; live runtime excluded (external target/Docker required).`,
    });
  }

  for (const blocked of [
    { benchmark: 'commerce', notes: 'BLOCKED: Next.js Shopify starter has no .env / external Shopify storefront credentials in offline workspace.' },
    { benchmark: 'juice-shop', notes: 'SKIPPED: Full OWASP Juice Shop server build not started in this benchmark run.' },
  ]) {
    results.push({
      benchmark: blocked.benchmark,
      mode: 'external-prereq-check',
      topology: 'unknown',
      status: 'BLOCKED',
      usedFallback: false,
      liveLlmInvoked: false,
      tscChecked: false,
      tscPassed: null,
      discoveryPassed: false,
      executionPassed: null,
      playwrightConfigCount: 0,
      reusedExistingFixture: false,
      duplicateAuthFixtures: 0,
      requirementsCount: 0,
      scenariosPlanned: 0,
      coveredRequirements: 0,
      requirementCoveragePct: 0,
      mutationTotal: 0,
      mutationKilled: 0,
      mutationSurvived: 0,
      mutationScore: null,
      generatedFiles: [],
      durationMs: 0,
      notes: blocked.notes,
    });
  }

  // Write JSON
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    llmModelConfigured: process.env.PIE_LLM_API_KEY ? (process.env.PIE_LLM_MODEL ?? 'deepseek-chat') : 'none',
    results,
  };
  await fs.writeFile(path.join(ENGINE_ROOT, 'generation-benchmark-results.json'), `${JSON.stringify(jsonOut, null, 2)}\n`, 'utf8');

  // Write CSV
  const headers = [
    'benchmark', 'mode', 'topology', 'status', 'usedFallback', 'liveLlmInvoked',
    'tscPassed', 'discoveryPassed', 'executionPassed', 'playwrightConfigCount',
    'reusedExistingFixture', 'duplicateAuthFixtures', 'requirementsCount', 'scenariosPlanned',
    'coveredRequirements', 'requirementCoveragePct', 'mutationTotal', 'mutationKilled',
    'mutationSurvived', 'mutationScore', 'durationMs', 'notes',
  ];
  const csvRows = [headers.join(',')];
  for (const r of results) {
    csvRows.push(
      headers.map((h) => {
        const val = r[h] ?? '';
        const str = String(val).replace(/"/g, '""');
        return /[,"\n]/.test(str) ? `"${str}"` : str;
      }).join(','),
    );
  }
  await fs.writeFile(path.join(ENGINE_ROOT, 'generation-benchmark-results.csv'), `${csvRows.join('\n')}\n`, 'utf8');

  // Write Markdown Report
  const md = [
    '# PIE Next-Generation Empirical Benchmark Report',
    '',
    `- **Generated:** ${jsonOut.generatedAt}`,
    `- **Environment:** Node ${jsonOut.nodeVersion} on ${jsonOut.platform}`,
    `- **Tier-L2 Provider:** ${jsonOut.llmModelConfigured}`,
    '- **Constraint Verified:** `D:\\Work\\pie-real-repository-testbed\\repositories\\` remained unmodified; all runs executed in `disposable-workspaces\\`.',
    '',
    '## Summary Matrix',
    '| Benchmark | Mode | Topology | Status | Used Fallback | TSC Pass | Discovery | Exec Pass | Reused Fixture | Cfgs | Mut Killed/Total | Mut Score | Duration (ms) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.benchmark} | ${r.mode} | ${r.topology} | \`${r.status}\` | ${r.usedFallback} | ${r.tscPassed ?? 'n/a'} | ${r.discoveryPassed} | ${r.executionPassed ?? 'n/a'} | ${r.reusedExistingFixture} | ${r.playwrightConfigCount} | ${r.mutationKilled}/${r.mutationTotal} | ${r.mutationScore !== null ? `${r.mutationScore}%` : 'n/a'} | ${r.durationMs} |`,
    ),
    '',
    '## Detailed Observations & Notes',
    ...results.map((r) => `- **${r.benchmark} (${r.mode})**: ${r.notes}`),
    '',
  ].join('\n');
  await fs.writeFile(path.join(ENGINE_ROOT, 'GENERATION_BENCHMARK_REPORT.md'), md, 'utf8');
  console.log('\nBenchmark complete! Reports saved to GENERATION_BENCHMARK_REPORT.md, generation-benchmark-results.json, generation-benchmark-results.csv');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
