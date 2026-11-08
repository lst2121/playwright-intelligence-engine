import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { McpServer } from '../mcp/server.js';
import { TestGenerator } from '../generator/test-generator.js';
import { DiagnosticRerunner } from '../reproduce/diagnostic-rerunner.js';
import { ApprovalService } from '../repair/approval-service.js';
import { WorkspacePromoter } from '../repair/workspace-promoter.js';
import { getRuntimeProvenance, PACKAGE_VERSION } from '../core/version.js';
import { inspectTestbed } from '../evaluation/repository-inspector.js';
import { RepositoryRunner } from '../evaluation/repository-runner.js';
import { initProjectConfig } from '../config/project-config.js';
import { buildRepositoryProfile, writeRepositoryProfile } from '../intelligence/repository-profile.js';
import { bootstrapProjectIntelligence, recordProjectFailure, recordProjectRepairAccepted, recordProjectRepairFeedback } from '../intelligence/project-intelligence.js';
import { clusterFailures, FailureObservation } from '../intelligence/failure-clustering.js';
import { analyzeTestStability, analyzeRepositoryImpact, TestRunObservation } from '../intelligence/suite-intelligence.js';
import { planArchitecture, writeArchitecturePlan, ArchitectureMode, ArchitectureGenerationInput } from '../generator/architecture-generator.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';
import { buildCiEvidenceReport } from '../integrations/playwright-report-adapter.js';
import { buildSarifReport } from '../integrations/sarif-report.js';
import { recordArchitectureWorkflow, recordCiWorkflow } from '../governance/workflow-audit.js';
import { buildTeamDashboard, TeamEvidenceRun } from '../governance/team-dashboard.js';
import { parseExternalFailureEvidence, supplementDiagnosticContext } from '../diagnostics/external-failure-evidence.js';
import { runRepairWorkflow } from '../repair/repair-workflow.js';
import { runAutonomousRepairWorkflow } from '../intelligence/autonomous-repair-workflow.js';
import { normalizeFailureCategory } from '../diagnostics/failure-category.js';
import { buildEvaluationScorecard, EvaluationObservation } from '../evaluation/evaluation-scorecard.js';
import { buildTestIntelligencePlan, ExistingTestInput, RequirementInput } from '../intelligence/test-intelligence.js';
import { runGenerationAgent } from '../intelligence/generation-agent.js';

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(PACKAGE_VERSION);
    return;
  }

  if (command === 'mcp') {
    const server = new McpServer();
    server.start();
    return;
  }

  if (command === 'inspect-testbed') {
    const testbedPath = argv[3];
    if (!testbedPath) {
      console.error('Error: testbed directory required. Usage: pw-intel inspect-testbed <directory> [--json] [--out <manifest.json>]');
      process.exit(1);
    }

    try {
      const manifests = await inspectTestbed(testbedPath);
      const outputPathIndex = argv.indexOf('--out');
      const outputPath = outputPathIndex >= 0 ? argv[outputPathIndex + 1] : undefined;
      const serialized = JSON.stringify({ generatedAt: new Date().toISOString(), testbedPath, repositories: manifests }, null, 2);

      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), serialized, 'utf8');
      }

      if (argv.includes('--json') || outputPath) {
        console.log(serialized);
      } else {
        console.log(`Testbed: ${testbedPath}`);
        for (const manifest of manifests) {
          console.log(`- ${manifest.name}: ${manifest.status}; ${manifest.testFiles} test files; ${manifest.pageObjectFiles} Page Object files; ${manifest.packageManager}`);
        }
      }
      return;
    } catch (err: any) {
      console.error(`Testbed inspection failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
  }

  if (command === 'run-testbed') {
    const testbedPath = argv[3];
    if (!testbedPath) {
      console.error('Error: testbed directory required. Usage: pw-intel run-testbed <directory> [--script <name>]');
      process.exit(1);
    }

    try {
      const manifests = await inspectTestbed(testbedPath);
      const scriptIndex = argv.indexOf('--script');
      const script = scriptIndex >= 0 ? argv[scriptIndex + 1] : undefined;
      const repositoryIndex = argv.indexOf('--repository');
      const repository = repositoryIndex >= 0 ? argv[repositoryIndex + 1] : undefined;
      const timeoutIndex = argv.indexOf('--timeout');
      const timeoutValue = timeoutIndex >= 0 ? Number(argv[timeoutIndex + 1]) : undefined;
      if (timeoutValue !== undefined && (!Number.isFinite(timeoutValue) || timeoutValue <= 0)) {
        throw new Error('--timeout must be a positive number of milliseconds');
      }
      const outputPathIndex = argv.indexOf('--out');
      const outputPath = outputPathIndex >= 0 ? argv[outputPathIndex + 1] : undefined;
      const selectedManifests = repository ? manifests.filter((manifest) => manifest.name === repository) : manifests;
      if (repository && selectedManifests.length === 0) {
        throw new Error(`Repository '${repository}' was not found in the testbed manifest`);
      }
      const results = [];
      for (const manifest of selectedManifests) {
        results.push(await RepositoryRunner.runBaseline(manifest, { script, timeoutMs: timeoutValue }));
      }
      const serialized = JSON.stringify({ generatedAt: new Date().toISOString(), testbedPath, results }, null, 2);
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), serialized, 'utf8');
      }
      console.log(serialized);
      return;
    } catch (err: any) {
      console.error(`Testbed execution failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
  }

  if (command === 'diagnose') {
    const tracePath = argv[3];
    if (!tracePath) {
      console.error('Error: trace.zip path required. Usage: pw-intel diagnose <path-to-trace.zip> [--error-context <error-context.md>]');
      process.exit(1);
    }

    try {
        const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
      if (!traceEntryName) {
        throw new Error(`No .trace event stream found in archive '${tracePath}'`);
      }

        const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? [traceEntryName]);
        const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
          ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames ?? [networkEntryName!])
        : '';

      const traceLines = traceText.split('\n');
      const networkLines = networkText.split('\n');
      let context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
      const errorContextIndex = argv.indexOf('--error-context');
      const errorContextPath = errorContextIndex >= 0 ? argv[errorContextIndex + 1] : undefined;
      if (errorContextPath) {
        const errorContext = await fs.promises.readFile(path.resolve(errorContextPath), 'utf8');
        context = supplementDiagnosticContext(context, parseExternalFailureEvidence(errorContext));
      }
      const correlated = EvidenceCorrelator.correlate(context);
      const intelligence = await bootstrapProjectIntelligence(process.cwd());
      await recordProjectFailure(process.cwd(), context.failedAction.selector, correlated.classification.category);

      if (argv.includes('--json')) {
        const proposedLocator = DiagnosticReportGenerator.extractProposedLocator(correlated, intelligence);
        const shouldAbstain = correlated.classification.shouldAbstain || !proposedLocator;
        const actionOutcome = shouldAbstain ? 'ABSTAIN' : 'REPAIR';
        const canonicalCategory = normalizeFailureCategory(correlated.classification.category);
        const abstentionReason =
          correlated.classification.abstentionReason ??
          (!proposedLocator ? 'No safe, unique replacement locator candidate discovered in DOM snapshot.' : undefined);

        console.log(JSON.stringify({
          provenance: getRuntimeProvenance(process.cwd()),
          classification: canonicalCategory,
          rawClassification: correlated.classification.category,
          confidence: correlated.classification.confidence,
          shouldAbstain,
          actionOutcome,
          reason: correlated.classification.reason,
          abstentionReason,
          failedAction: correlated.context.failedAction,
          failureFingerprint: correlated.failureFingerprint,
          proposedLocator,
        }, null, 2));
        return;
      }

      const report = DiagnosticReportGenerator.generateTerminalReport(correlated, undefined, intelligence);

      console.log(report);
    } catch (err: any) {
      console.error(`Diagnostic execution failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'repair') {
    const tracePath = argv[3];
    if (!tracePath) {
      console.error('Error: trace.zip path required. Usage: pw-intel repair <trace.zip> --test <spec> --pom <page-object> --class <Class> --member <member> [--execute]');
      process.exit(1);
    }
    try {
      const option = (name: string): string | undefined => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      const operationText = option('--operation');
      const operation = operationText ? JSON.parse(operationText) as unknown : undefined;
      const result = await runRepairWorkflow({
        tracePath,
        workspaceRoot: option('--workspace') ?? process.cwd(),
        errorContextPath: option('--error-context'),
        testFilePath: option('--test'),
        pomFilePath: option('--pom'),
        className: option('--class'),
        memberName: option('--member'),
        configPath: option('--config'),
        project: option('--project'),
        execute: argv.includes('--execute'),
        worktreeId: option('--worktree-id'),
        operation,
      });
      const canonicalClassification = {
        ...result.correlated.classification,
        category: normalizeFailureCategory(result.correlated.classification.category),
      };
      console.log(JSON.stringify({
        provenance: getRuntimeProvenance(process.cwd()),
        status: result.status,
        classification: canonicalClassification,
        failureFingerprint: result.correlated.failureFingerprint,
        proposedLocator: result.proposedLocator,
        candidate: result.candidate,
        proposalId: result.stagedProposal?.proposalId,
        worktree: result.worktree,
        verification: result.verification,
        reason: result.reason,
      }, null, 2));
      if (result.status === 'REJECTED') process.exitCode = 1;
    } catch (err: any) {
      console.error(`Repair workflow failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'autonomous-repair') {
    const tracePath = argv[3];
    if (!tracePath) {
      console.error('Error: trace.zip path required. Usage: pw-intel autonomous-repair <trace.zip> [--execute] [--test <spec>] [--pom <page-object>] [--class <Class>] [--member <member>]');
      process.exit(1);
    }
    try {
      const option = (name: string): string | undefined => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      const result = await runAutonomousRepairWorkflow({
        tracePath,
        workspaceRoot: option('--workspace') ?? process.cwd(),
        errorContextPath: option('--error-context'),
        testFilePath: option('--test'),
        pomFilePath: option('--pom'),
        className: option('--class'),
        memberName: option('--member'),
        configPath: option('--config'),
        worktreeId: option('--worktree-id'),
        enableBrowserInvestigation: argv.includes('--browser'),
        browserUrl: option('--browser-url'),
        browserAllowedHosts: (option('--allow-host') ?? '').split(',').map((host) => host.trim()).filter(Boolean),
        enableTestExecution: argv.includes('--run-tests'),
        autoPromote: argv.includes('--promote'),
        execute: argv.includes('--execute'),
      });
      console.log(JSON.stringify({
        provenance: getRuntimeProvenance(process.cwd()),
        status: result.status,
        reason: result.reason,
        agent: {
          state: result.proposalRun.agent.state,
          modelInvoked: result.proposalRun.agent.modelInvoked,
          classification: result.proposalRun.agent.classification,
          proposal: result.proposal,
          errors: result.proposalRun.agent.errors,
          steps: result.proposalRun.agent.steps,
        },
        verification: result.verification,
        promotion: result.promotion,
      }, null, 2));
      if (result.status === 'PROPOSAL_REJECTED' || result.status === 'VERIFICATION_FAILED') process.exitCode = 1;
    } catch (err: any) {
      console.error(`Autonomous repair failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'reproduce') {
    const specFile = argv[3];
    if (!specFile) {
      console.error('Error: spec file path required. Usage: pw-intel reproduce <specFilePath>');
      process.exit(1);
    }

    try {
      const option = (name: string): string | undefined => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      console.log(`Running diagnostic reproduction for '${specFile}'...`);
      const result = await DiagnosticRerunner.rerunAndDiagnose({
        specFilePath: specFile,
        workspaceRoot: option('--workspace') ?? process.cwd(),
      });

      console.log(result.report);
      if (!result.passed) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Reproduction execution failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'benchmark') {
    // Resolve benchmark script from package directory first, falling back to process.cwd()
    const cliDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const packageRootDir = path.resolve(cliDir, '..');
    const packageBenchmarkScript = path.resolve(packageRootDir, 'benchmarks', 'runner', 'master-benchmark-runner.ts');
    const localBenchmarkScript = path.resolve(process.cwd(), 'benchmarks', 'runner', 'master-benchmark-runner.ts');
    const benchmarkScript = fs.existsSync(packageBenchmarkScript)
      ? packageBenchmarkScript
      : localBenchmarkScript;

    // Locate tsx CLI entry point
    const tsxCandidatePaths = [
      path.resolve(packageRootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    ];
    const tsxCli = tsxCandidatePaths.find((p) => fs.existsSync(p));

    let executable: string;
    let finalArgs: string[];

    if (tsxCli) {
      executable = process.execPath;
      finalArgs = [tsxCli, benchmarkScript, ...argv.slice(3)];
    } else {
      executable = process.platform === 'win32' ? 'cmd.exe' : 'npx';
      finalArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npx', 'tsx', benchmarkScript, ...argv.slice(3)]
        : ['tsx', benchmarkScript, ...argv.slice(3)];
    }

    const child = spawn(executable, finalArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'init') {
    const workspaceRoot = argv[3] && !argv[3].startsWith('--') ? argv[3] : process.cwd();
    try {
      const result = await initProjectConfig(workspaceRoot, { force: argv.includes('--force') });
      if (argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${result.created ? 'Created' : 'Found'} PIE project configuration: ${result.configPath}`);
        console.log(`  Package manager : ${result.config.test.packageManager}`);
        console.log(`  Test command    : ${result.config.test.command ?? 'not detected'}`);
        console.log(`  Fail-closed     : ${result.config.diagnostics.failClosed ? 'enabled' : 'disabled'}`);
      }
    } catch (err: any) {
      console.error(`PIE initialization failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'profile') {
    const workspaceRoot = argv[3] && !argv[3].startsWith('--') ? argv[3] : process.cwd();
    try {
      const profile = await buildRepositoryProfile(workspaceRoot);
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
      } else {
        await writeRepositoryProfile(workspaceRoot, profile);
      }
      if (argv.includes('--json') || outputPath) console.log(JSON.stringify(profile, null, 2));
      else {
        console.log(`Repository profile generated for ${profile.repository.name}`);
        console.log(`  Tests           : ${profile.structure.testFiles}`);
        console.log(`  Page Objects    : ${profile.structure.pageObjectFiles}`);
        console.log(`  Fixtures        : ${profile.structure.fixtureFiles}`);
        console.log(`  Preferred loc.  : ${profile.locatorConventions.preferred}`);
        console.log(`  Domain terms    : ${profile.domainTerms.slice(0, 10).join(', ') || 'none detected'}`);
      }
    } catch (err: any) {
      console.error(`Repository profiling failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'cluster-failures') {
    const inputPath = argv[3];
    if (!inputPath) {
      console.error('Error: input JSON path required. Usage: pw-intel cluster-failures <observations.json> [--out <report.json>]');
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.resolve(inputPath), 'utf8')) as { observations?: FailureObservation[] } | FailureObservation[];
      const observations = Array.isArray(parsed) ? parsed : parsed.observations ?? [];
      const clusters = clusterFailures(observations);
      const report = {
        generatedAt: new Date().toISOString(),
        observationCount: observations.length,
        clusterCount: clusters.length,
        clusters,
      };
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Failure clustering failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'evaluation-scorecard') {
    const inputPath = argv[3];
    if (!inputPath) {
      console.error('Error: evaluation JSON path required. Usage: pw-intel evaluation-scorecard <results.json> [--out <scorecard.json>]');
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.resolve(inputPath), 'utf8')) as EvaluationObservation[] | { observations?: EvaluationObservation[]; diagnosisResults?: EvaluationObservation[] };
      const observations = Array.isArray(parsed) ? parsed : parsed.observations ?? parsed.diagnosisResults ?? [];
      const scorecard = buildEvaluationScorecard(observations);
      const report = { generatedAt: new Date().toISOString(), inputPath: path.resolve(inputPath), ...scorecard };
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Evaluation scorecard failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'plan-test-intelligence') {
    const requirementsPath = argv[3];
    if (!requirementsPath) {
      console.error('Error: requirements JSON path required. Usage: pw-intel plan-test-intelligence <requirements.json> [--tests <tests.json>] [--out <plan.json>]');
      process.exit(1);
    }
    try {
      const requirementsRaw = JSON.parse(await fs.promises.readFile(path.resolve(requirementsPath), 'utf8')) as RequirementInput[] | { requirements?: RequirementInput[] | string; title?: string; steps?: ArchitectureGenerationInput['steps']; baseUrl?: string; includeCi?: boolean };
      const requirements = Array.isArray(requirementsRaw)
        ? requirementsRaw
        : Array.isArray(requirementsRaw.requirements)
          ? requirementsRaw.requirements
          : typeof requirementsRaw.requirements === 'string'
            ? [{ id: 'requirement-1', title: requirementsRaw.title ?? requirementsRaw.requirements.slice(0, 100), description: requirementsRaw.requirements }]
            : [];
      if (requirements.length === 0) throw new Error('The requirements document contains no requirements');
      const testsIndex = argv.indexOf('--tests');
      const testsPath = testsIndex >= 0 ? argv[testsIndex + 1] : undefined;
      let existingTests: ExistingTestInput[] = [];
      if (testsPath) {
        const testsRaw = JSON.parse(await fs.promises.readFile(path.resolve(testsPath), 'utf8')) as ExistingTestInput[] | { tests?: ExistingTestInput[] };
        existingTests = Array.isArray(testsRaw) ? testsRaw : testsRaw.tests ?? [];
      }
      const plan = buildTestIntelligencePlan(requirements, existingTests);
      const report = { generatedAt: new Date().toISOString(), requirementsPath: path.resolve(requirementsPath), testsPath: testsPath ? path.resolve(testsPath) : undefined, ...plan };
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Test intelligence planning failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'generate-agent') {
    const requirementsPath = argv[3];
    if (!requirementsPath) {
      console.error('Error: requirements JSON path required. Usage: pw-intel generate-agent <requirements.json> [--mode greenfield|brownfield] [--tests <tests.json>] [--write]');
      process.exit(1);
    }
    try {
      const requirementsRaw = JSON.parse(await fs.promises.readFile(path.resolve(requirementsPath), 'utf8')) as RequirementInput[] | { requirements?: RequirementInput[] | string; title?: string; steps?: ArchitectureGenerationInput['steps']; baseUrl?: string; includeCi?: boolean };
      const requirementsDocument = Array.isArray(requirementsRaw) ? undefined : requirementsRaw;
      const requirements = Array.isArray(requirementsRaw)
        ? requirementsRaw
        : Array.isArray(requirementsRaw.requirements)
          ? requirementsRaw.requirements
          : typeof requirementsRaw.requirements === 'string'
            ? [{ id: 'requirement-1', title: requirementsRaw.title ?? requirementsRaw.requirements.slice(0, 100), description: requirementsRaw.requirements }]
            : [];
      if (requirements.length === 0) throw new Error('The requirements document contains no requirements');
      const testsIndex = argv.indexOf('--tests');
      const testsPath = testsIndex >= 0 ? argv[testsIndex + 1] : undefined;
      let existingTests: ExistingTestInput[] = [];
      if (testsPath) {
        const testsRaw = JSON.parse(await fs.promises.readFile(path.resolve(testsPath), 'utf8')) as ExistingTestInput[] | { tests?: ExistingTestInput[] };
        existingTests = Array.isArray(testsRaw) ? testsRaw : testsRaw.tests ?? [];
      }
      const modeIndex = argv.indexOf('--mode');
      const mode = (modeIndex >= 0 ? argv[modeIndex + 1] : 'brownfield') as 'greenfield' | 'brownfield';
      if (mode !== 'greenfield' && mode !== 'brownfield') throw new Error("--mode must be 'greenfield' or 'brownfield'");
      const baseUrlIndex = argv.indexOf('--base-url');
      const baseUrl = baseUrlIndex >= 0 ? argv[baseUrlIndex + 1] : requirementsDocument?.baseUrl;
      const authorArg = argv.find((arg) => arg.startsWith('--author='));
      const authorIndex = argv.indexOf('--author');
      const author = authorArg
        ? (authorArg.slice('--author='.length) as 'template' | 'hybrid' | 'llm')
        : authorIndex >= 0
          ? (argv[authorIndex + 1] as 'template' | 'hybrid' | 'llm')
          : 'hybrid';
      const result = await runGenerationAgent({
        requirements,
        existingTests,
        mode,
        author,
        workspaceRoot: (argv.indexOf('--workspace') >= 0 ? argv[argv.indexOf('--workspace') + 1] : undefined) ?? process.cwd(),
        ...(baseUrl ? { baseUrl } : {}),
        ...(requirementsDocument?.steps ? { suggestedSteps: requirementsDocument.steps } : {}),
        ...(requirementsDocument?.includeCi !== undefined ? { includeCi: requirementsDocument.includeCi } : {}),
        write: argv.includes('--write'),
        verify: argv.includes('--verify'),
      });
      console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requirementsPath: path.resolve(requirementsPath), ...result }, null, 2));
      if (result.status === 'ABSTAINED' || result.status === 'MODEL_NOT_CONFIGURED' || result.status === 'NEEDS_INPUT' || result.status === 'VERIFICATION_FAILED' || result.status === 'AGENT_NO_PROGRESS') process.exitCode = 1;
    } catch (err: any) {
      console.error(`Generation agent failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'stability-feedback') {
    const selector = argv[3];
    const outcomeIndex = argv.indexOf('--outcome');
    const outcome = outcomeIndex >= 0 ? argv[outcomeIndex + 1] : undefined;
    if (!selector || (outcome !== 'accepted' && outcome !== 'rejected')) {
      console.error('Error: selector and outcome are required. Usage: pw-intel stability-feedback <selector> --outcome accepted|rejected');
      process.exit(1);
    }
    try {
      await recordProjectRepairFeedback(process.cwd(), selector, outcome);
      console.log(JSON.stringify({ selector, outcome, recorded: true }));
    } catch (err: any) {
      console.error(`Stability feedback failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'suite-health') {
    const inputPath = argv[3];
    if (!inputPath) {
      console.error('Error: run-record JSON path required. Usage: pw-intel suite-health <runs.json> [--out <report.json>]');
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.resolve(inputPath), 'utf8')) as { runs?: TestRunObservation[] } | TestRunObservation[];
      const runs = Array.isArray(parsed) ? parsed : parsed.runs ?? [];
      const summaries = analyzeTestStability(runs);
      const report = { generatedAt: new Date().toISOString(), runCount: runs.length, testCount: summaries.length, flakyTestCount: summaries.filter((summary) => summary.flaky).length, tests: summaries };
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Suite health analysis failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'team-dashboard') {
    const inputPath = argv[3];
    if (!inputPath) {
      console.error('Error: team evidence JSON path required. Usage: pw-intel team-dashboard <evidence.json> [--out <report.json>]');
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.resolve(inputPath), 'utf8')) as { runs?: TeamEvidenceRun[] } | TeamEvidenceRun[];
      const runs = Array.isArray(parsed) ? parsed : parsed.runs ?? [];
      const report = buildTeamDashboard(runs);
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Team dashboard generation failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'impact') {
    const changedPath = argv[3];
    if (!changedPath) {
      console.error('Error: changed-files JSON path required. Usage: pw-intel impact <changed-files.json> [--root <directory>] [--out <report.json>]');
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.resolve(changedPath), 'utf8')) as { changedFiles?: string[] } | string[];
      const changedFiles = Array.isArray(parsed) ? parsed : parsed.changedFiles ?? [];
      const rootIndex = argv.indexOf('--root');
      const root = (rootIndex >= 0 ? argv[rootIndex + 1] : undefined) ?? process.cwd();
      const report = await analyzeRepositoryImpact(root, changedFiles);
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Impact analysis failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'architect') {
    const featureName = argv[3];
    if (!featureName || featureName.startsWith('--')) {
      console.error('Error: feature name required. Usage: pw-intel architect <featureName> [--mode greenfield|brownfield] [--requirements <json>] [--write]');
      process.exit(1);
    }
    try {
      const modeIndex = argv.indexOf('--mode');
      const mode = (modeIndex >= 0 ? argv[modeIndex + 1] : 'greenfield') as ArchitectureMode;
      if (mode !== 'greenfield' && mode !== 'brownfield') throw new Error("--mode must be 'greenfield' or 'brownfield'");
      const requirementsIndex = argv.indexOf('--requirements');
      const requirementsPath = requirementsIndex >= 0 ? argv[requirementsIndex + 1] : undefined;
      const requirements = requirementsPath
        ? JSON.parse(await fs.promises.readFile(path.resolve(requirementsPath), 'utf8')) as Partial<ArchitectureGenerationInput>
        : {};
      const profile = mode === 'brownfield' ? await buildRepositoryProfile(process.cwd()) : undefined;
      const plan = planArchitecture({
        featureName,
        mode,
        profile,
        baseUrl: requirements.baseUrl,
        requirements: requirements.requirements,
        steps: requirements.steps,
        includeCi: requirements.includeCi,
      });
      let writeResult;
      if (argv.includes('--write')) writeResult = await writeArchitecturePlan(process.cwd(), plan);
      let verification;
      if (argv.includes('--verify') && writeResult && writeResult.written.length > 0) {
        const spec = plan.files.find((file) => file.relativePath.endsWith('.spec.ts'));
        if (spec) {
          verification = await ExecutionRunner.run('npx', {
            cwd: process.cwd(),
            args: ['playwright', 'test', spec.relativePath, '--reporter=line'],
            timeoutMs: 60_000,
          });
        }
      }
      await recordArchitectureWorkflow(process.cwd(), plan, writeResult);
      const report = { generatedAt: new Date().toISOString(), plan, writeResult, ...(verification ? { verification } : {}) };
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (err: any) {
      console.error(`Architecture generation failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'ci-report') {
    const reportPath = argv[3];
    if (!reportPath) {
      console.error('Error: Playwright JSON report path required. Usage: pw-intel ci-report <playwright-report.json> [--repository <name>] [--out <report.json>]');
      process.exit(1);
    }
    try {
      const report = JSON.parse(await fs.promises.readFile(path.resolve(reportPath), 'utf8')) as unknown;
      const repositoryIndex = argv.indexOf('--repository');
      const repository = repositoryIndex >= 0 ? argv[repositoryIndex + 1] : undefined;
      const evidence = buildCiEvidenceReport(report, { repository, runId: process.env.GITHUB_RUN_ID ?? process.env.CI_PIPELINE_ID });
      await recordCiWorkflow(process.cwd(), evidence);
      const outputIndex = argv.indexOf('--out');
      const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
      if (outputPath) {
        await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      }
      const sarifIndex = argv.indexOf('--sarif-out');
      const sarifPath = sarifIndex >= 0 ? argv[sarifIndex + 1] : undefined;
      if (sarifPath) {
        const sarif = buildSarifReport(evidence, PACKAGE_VERSION);
        await fs.promises.mkdir(path.dirname(path.resolve(sarifPath)), { recursive: true });
        await fs.promises.writeFile(path.resolve(sarifPath), `${JSON.stringify(sarif, null, 2)}\n`, 'utf8');
      }
      console.log(evidence.markdown);
      for (const annotation of evidence.annotations) console.log(annotation);
      if (evidence.qualityGate.status === 'FAIL') process.exitCode = 1;
    } catch (err: any) {
      console.error(`CI report ingestion failed: ${err?.message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'approve') {
    const proposalId = argv[3];
    if (!proposalId) {
      console.error('Error: proposalId required. Usage: pw-intel approve <proposalId>');
      process.exit(1);
    }

    const proposal = ApprovalService.getInstance().getProposal(proposalId);
    if (!proposal) {
      console.error(`Error: Proposal '${proposalId}' not found or expired.`);
      process.exit(1);
    }

    console.log('========================================================================');
    console.log(' PLAYWRIGHT INTELLIGENCE ENGINE — OPERATOR REPAIR APPROVAL');
    console.log('========================================================================\n');
    console.log(`Proposal ID      : ${proposal.proposalId}`);
    console.log(`Target File      : ${proposal.targetFilePath}`);
    console.log(`Target Class     : ${proposal.targetClassName}`);
    console.log(`Target Member    : ${proposal.targetMemberName}`);
    console.log(`Original Hash    : ${proposal.originalSourceHash.slice(0, 16)}...`);
    console.log(`Patched Hash     : ${proposal.patchedSourceHash.slice(0, 16)}...`);
    console.log(`Worktree Status  : ${proposal.worktreeExecutionVerified ? 'VERIFIED (Target test passed in isolated worktree)' : 'UNVERIFIED'}`);
    console.log('\n--- Proposed Unified Diff ---');
    console.log(proposal.fullDiff || '(No diff recorded)');
    console.log('-----------------------------\n');

    if (!proposal.worktreeExecutionVerified) {
      console.error('Security Violation: Cannot authorize proposal. Worktree test execution was not verified.');
      process.exit(1);
    }

    try {
      const tokenPayload = ApprovalService.getInstance().authorizeProposal({ proposalId });
      console.log('PROPOSAL AUTHORIZED.');
      console.log(`Single-Use Approval Token: ${tokenPayload.tokenId}\n`);
      console.log(`To atomically apply this patch to your workspace, run:`);
      console.log(`  pw-intel promote --token ${tokenPayload.tokenId}\n`);
    } catch (err: any) {
      console.error(`Authorization failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'promote') {
    const tokenIndex = argv.indexOf('--token');
    const token = tokenIndex !== -1 ? argv[tokenIndex + 1] : undefined;
    if (!token) {
      console.error('Error: --token argument required. Usage: pw-intel promote --token <approvalToken>');
      process.exit(1);
    }

    const tokenPayload = ApprovalService.getInstance().getTokenPayload(token);
    if (!tokenPayload) {
      console.error(`Error: Invalid or expired approval token '${token}'.`);
      process.exit(1);
    }

    const proposal = ApprovalService.getInstance().getProposal(tokenPayload.proposalId);
    if (!proposal) {
      console.error(`Error: Staged proposal '${tokenPayload.proposalId}' no longer available.`);
      process.exit(1);
    }

    console.log(`Applying authorized repair to '${tokenPayload.targetFilePath}'...`);
    const promoResult = await WorkspacePromoter.promote({
      targetFilePath: tokenPayload.targetFilePath,
      workspaceRoot: process.cwd(),
      patchedContent: proposal.patchedSource,
      approvalTokenPayload: tokenPayload,
    });

    if (!promoResult.success) {
      console.error(`Promotion failed: ${promoResult.error}`);
      process.exit(1);
    }

    await recordProjectRepairAccepted(process.cwd(), proposal.replacementSelector).catch(() => {});

    console.log(`Successfully promoted verified repair!`);
    console.log(`Target File   : ${promoResult.targetFilePath}`);
    console.log(`Bytes Written : ${promoResult.bytesWritten}`);
    console.log(`Final Hash    : ${promoResult.finalHash.slice(0, 16)}...`);
    return;
  }

  if (command === 'generate') {
    const featureName = argv[3] ?? 'Dashboard';
    const suite = TestGenerator.generateSuite(featureName, [
      { action: 'fill', name: 'Search', value: 'query' },
      { action: 'click', role: 'button', name: 'Submit' },
      { action: 'assert-visible', role: 'heading', name: 'Results' },
    ]);

    console.log(`Generated Page Object (${suite.pageObjectName}.ts):`);
    console.log(suite.pageObjectCode);
    console.log('─────────────────────────────────────────────────────────────────');
    console.log(`Generated Spec:`);
    console.log(suite.specCode);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function runDoctor(): Promise<void> {
  console.log('Running Playwright Intelligence Engine Diagnostic Healthcheck (pw-intel doctor)...\n');
  let healthy = true;

  // 1. Node.js version
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0] || '0', 10);
  if (major >= 20) {
    console.log(`  ✓ Node.js Runtime     : v${nodeVer} (Supported >= 20.0.0)`);
  } else {
    console.log(`  ✗ Node.js Runtime     : v${nodeVer} (Unsupported, requires Node >= 20.0.0)`);
    healthy = false;
  }

  // 2. Git CLI availability
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
    console.log(`  ✓ Git Version Control : ${gitVer}`);
  } catch {
    console.log(`  ✗ Git Version Control : Not found in PATH (Required for isolated worktrees)`);
    healthy = false;
  }

  // 3. Playwright availability
  let pwFound = false;
  try {
    const cwdPkg = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(cwdPkg)) {
      const pkg = JSON.parse(fs.readFileSync(cwdPkg, 'utf-8'));
      const pwVer = pkg.devDependencies?.['@playwright/test'] || pkg.dependencies?.['@playwright/test'];
      if (pwVer) {
        console.log(`  ✓ Playwright Test     : ${pwVer} (Found in package.json)`);
        pwFound = true;
      }
    }
  } catch {}
  if (!pwFound) {
    try {
      const pwCliVer = execSync('npx --no-install playwright --version', {
        encoding: 'utf-8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      console.log(`  ✓ Playwright CLI      : ${pwCliVer}`);
      pwFound = true;
    } catch {
      console.log(`  ! Playwright Test     : Not detected in current working directory (Optional for offline trace analysis)`);
    }
  }

  // 4. Workspace write access
  try {
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    console.log(`  ✓ Workspace Access    : Read/Write verified for '${process.cwd()}'`);
  } catch {
    console.log(`  ✗ Workspace Access    : Permission denied writing to '${process.cwd()}'`);
    healthy = false;
  }

  // 5. Host platform info
  console.log(`  ✓ Host Platform       : ${process.platform} (${process.arch})`);

  console.log('\nHealthcheck Verdict: ' + (healthy ? 'HEALTHY (Ready for diagnostic and repair workflows)' : 'DEGRADED (Check failed items above)'));
  if (!healthy) {
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Playwright Intelligence Engine CLI (pw-intel)

Usage:
  pw-intel init [directory]      Creates or loads the project-local .pie/config.json
  pw-intel profile [directory]   Builds the project repository convention profile
  pw-intel cluster-failures <json> Groups failure observations by deterministic fingerprints
  pw-intel evaluation-scorecard <json> Reconciles expected/predicted categories, repairs, abstentions, and latency
  pw-intel plan-test-intelligence <requirements.json> Plans coverage, missing scenarios, and duplicate tests
  pw-intel generate-agent <requirements.json> Uses structured LLM planning, then deterministic Playwright generation
                                   --mode greenfield|brownfield --tests <tests.json> --base-url <url> --write --verify
  pw-intel stability-feedback <selector> --outcome accepted|rejected Records operator repair feedback
  pw-intel suite-health <json>    Calculates flaky-test and duration summaries
  pw-intel team-dashboard <json> Aggregates repository CI evidence into a team dashboard
  pw-intel impact <json>         Selects impacted tests from changed files and repository imports
  pw-intel architect <featureName> Plans greenfield/brownfield Playwright architecture; add --write to create missing files
  pw-intel ci-report <playwright-report.json> Ingests Playwright JSON and emits clusters, stability, gate, and CI annotations
                                   --sarif-out <file> writes GitHub/code-scanning SARIF output
  pw-intel doctor                   Inspects host environment, Node, Git, Playwright & workspace readiness
  pw-intel diagnose <trace.zip>     Diagnoses a Playwright trace archive and outputs root cause
                                   --error-context <file> supplements traces with Playwright error-context.md
  pw-intel repair <trace.zip>       Creates a proposal; add --execute for isolated verification
                                   --test <spec> --pom <page-object> --class <Class> --member <member>
                                   --config <playwright.config> --error-context <file> --worktree-id <id>
                                   --operation <JSON> for an allowlisted frame/shadow/locator operation
  pw-intel autonomous-repair <trace.zip> Runs the bounded LLM agent and deterministic isolated verifier
                                   --execute applies the proposal only in a disposable worktree
                                   --browser --browser-url <url> --allow-host <hostname[,hostname]>
                                   --run-tests allows the agent to run an explicitly requested target test
                                   --promote promotes only an independently verified repair; implies execution
  pw-intel reproduce <spec.ts>      Reruns a failing test with live multi-source diagnostic instrumentation
  pw-intel inspect-testbed <dir>    Inspects external Playwright repositories and emits a reproducible manifest
  pw-intel run-testbed <dir>       Runs bounded baseline commands for discovered repositories
                                   --repository <name> --script <name> --timeout <ms> --out <file>
  pw-intel approve <proposalId>     Human review and cryptographic authorization of staged repair proposal
  pw-intel promote --token <token>  Atomically applies authorized repair proposal to active workspace
  pw-intel benchmark [options]      Executes empirical real browser benchmark suite against Controlled App Server
  pw-intel mcp                      Starts the Model Context Protocol (MCP) JSON-RPC server on stdio
  pw-intel generate <featureName>   Generates verified Page Object and Spec scaffolding
  pw-intel --help                   Shows this help message

Benchmark Options:
  --family <name>                   Filter mutation scenarios by family name (e.g. "Dynamic IDs")
  --scenario <id>                   Filter negative control scenarios by category or name
  --browser <browser>               Target browser (default: chromium)
`);
}

