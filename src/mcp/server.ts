import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { ArchiveReader } from '../trace/archive-reader.js';
import { VersionDetector } from '../trace/version-detector.js';
import { TraceAdapterRegistry } from '../trace/adapters/adapter-registry.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { AstPatcher } from '../repair/ast-patcher.js';
import { AssertionHasher } from '../repair/assertion-hasher.js';
import { DiffAllowlistValidator } from '../repair/diff-allowlist.js';
import { ApprovalService } from '../repair/approval-service.js';
import { WorkspacePromoter } from '../repair/workspace-promoter.js';
import { TestGenerator } from '../generator/test-generator.js';
import { ENGINE_MILESTONE, getRuntimeProvenance, PACKAGE_VERSION } from '../core/version.js';
import { bootstrapProjectIntelligence, recordProjectFailure, recordProjectRepairAccepted } from '../intelligence/project-intelligence.js';
import { initProjectConfig } from '../config/project-config.js';
import { buildRepositoryProfile, writeRepositoryProfile } from '../intelligence/repository-profile.js';
import { clusterFailures, FailureObservation } from '../intelligence/failure-clustering.js';
import { analyzeTestStability, analyzeRepositoryImpact, TestRunObservation } from '../intelligence/suite-intelligence.js';
import { compileSafeRepairOperation } from '../repair/safe-operation-compiler.js';
import { evaluateQualityGate, QualityGateInput } from '../integrations/quality-gate.js';
import { planArchitecture, writeArchitecturePlan, ArchitectureMode } from '../generator/architecture-generator.js';
import { buildCiEvidenceReport } from '../integrations/playwright-report-adapter.js';
import { buildSarifReport } from '../integrations/sarif-report.js';
import { recordArchitectureWorkflow, recordCiWorkflow } from '../governance/workflow-audit.js';
import { buildTeamDashboard, TeamEvidenceRun } from '../governance/team-dashboard.js';
import { parseExternalFailureEvidence, supplementDiagnosticContext } from '../diagnostics/external-failure-evidence.js';
import { runRepairWorkflow } from '../repair/repair-workflow.js';
import { normalizeFailureCategory } from '../diagnostics/failure-category.js';
import { runTraceProposalWorkflow } from '../intelligence/trace-proposal-workflow.js';
import { runAutonomousRepairWorkflow } from '../intelligence/autonomous-repair-workflow.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null | undefined;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServer {
  private readonly rl: readline.Interface;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  }

  /**
   * Asserts that a file path resolves within the authorized workspace boundary.
   * Uses canonical filesystem resolution (fs.realpathSync) to prevent symlink,
   * junction, or reparse point bypasses outside the workspace boundary (AUDIT-05).
   * Unconditionally fails closed if canonical realpath resolution fails.
   */
  public assertPathInWorkspace(targetPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, targetPath);

    if (!fs.existsSync(this.workspaceRoot)) {
      throw new Error(`Workspace root does not exist: '${this.workspaceRoot}'`);
    }

    const canonicalWorkspace = fs.realpathSync(this.workspaceRoot);
    let canonicalTarget: string;

    if (fs.existsSync(resolved)) {
      canonicalTarget = fs.realpathSync(resolved);
    } else {
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        canonicalTarget = path.join(fs.realpathSync(parent), path.basename(resolved));
      } else {
        throw new Error(
          `Workspace Security Violation: Path '${targetPath}' cannot be resolved inside authorized workspace boundary '${canonicalWorkspace}'.`
        );
      }
    }

    const rel = path.relative(canonicalWorkspace, canonicalTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Workspace Security Violation: Path '${targetPath}' resolves to '${canonicalTarget}' outside authorized workspace boundary '${canonicalWorkspace}'.`
      );
    }

    return canonicalTarget;
  }

  public start(): void {
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let req: any;
      try {
        req = JSON.parse(trimmed);
      } catch (err: any) {
        // Spec compliance: Parse error returns id: null
        const errRes: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        };
        process.stdout.write(JSON.stringify(errRes) + '\n');
        return;
      }

      const res = await this.handleRequest(req);
      process.stdout.write(JSON.stringify(res) + '\n');
    });
  }

  public async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? null;

    if (req.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      };
    }

    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'playwright-intelligence-mcp',
              version: PACKAGE_VERSION,
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'diagnose_trace',
                description: 'Analyzes a Playwright trace.zip archive and outputs root-cause classification with causal evidence.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string', description: 'Workspace-relative or absolute path to trace.zip archive' },
                    errorContextPath: { type: 'string', description: 'Optional workspace-relative path to Playwright error-context.md when the trace lacks a failed action' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'repair_trace',
                description: 'Builds a fail-closed repair proposal from a trace, optionally verifies it in an isolated worktree, and never promotes source without explicit approval.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string', description: 'Workspace-relative or absolute path to trace.zip archive' },
                    errorContextPath: { type: 'string', description: 'Optional Playwright error-context.md path' },
                    testPath: { type: 'string', description: 'Failing test spec path, required to build a repair proposal' },
                    pomPath: { type: 'string', description: 'Page Object path, required to build a repair proposal' },
                    className: { type: 'string', description: 'Page Object class name' },
                    memberName: { type: 'string', description: 'Locator member name' },
                    configPath: { type: 'string', description: 'Optional Playwright config path for isolated verification' },
                    execute: { type: 'boolean', description: 'When true, verify only inside a dedicated worktree; still requires approval to promote' },
                    worktreeId: { type: 'string', description: 'Optional stable worktree identifier' },
                    operation: { type: 'object', description: 'Optional allowlisted repair operation, such as replace_locator, add_frame_scope, or add_shadow_scope' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'propose_repair',
                description: 'Runs a bounded, redaction-aware optional model proposal workflow after deterministic PIE classification; never executes or promotes model output.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string', description: 'Workspace-relative or absolute path to trace.zip archive' },
                    errorContextPath: { type: 'string', description: 'Optional Playwright error-context.md path' },
                    executionId: { type: 'string' },
                    testIdentity: { type: 'string' },
                    enableBrowserInvestigation: { type: 'boolean', description: 'Explicitly opt in to read-only browser-state investigation when the model requests it' },
                    browserUrl: { type: 'string', description: 'Browser URL for opt-in investigation' },
                    browserAllowedHosts: { type: 'array', items: { type: 'string' }, description: 'Explicit host allowlist required for browser investigation' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'autonomous_repair',
                description: 'Runs the bounded reasoning agent, allowlisted repository/browser tools, isolated repair verification, and optional explicitly authorized promotion.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string' },
                    errorContextPath: { type: 'string' },
                    testPath: { type: 'string' },
                    pomPath: { type: 'string' },
                    className: { type: 'string' },
                    memberName: { type: 'string' },
                    configPath: { type: 'string' },
                    execute: { type: 'boolean' },
                    autoPromote: { type: 'boolean', description: 'Promote only after isolated verification; use only under explicit repository policy.' },
                    enableBrowserInvestigation: { type: 'boolean' },
                    browserUrl: { type: 'string' },
                    browserAllowedHosts: { type: 'array', items: { type: 'string' } },
                    enableTestExecution: { type: 'boolean' },
                    worktreeId: { type: 'string' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'repair_page_object',
                description: 'Safely refactors a Playwright Page Object file using ts-morph AST within authorized workspace, with strict locator grammar and assertion immutability validation.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    pomPath: { type: 'string', description: 'Path to Page Object file within workspace' },
                    testPath: { type: 'string', description: 'Path to test spec file within workspace' },
                    className: { type: 'string', description: 'Page Object class name' },
                    memberName: { type: 'string', description: 'Target locator member name' },
                    replacementSelector: { type: 'string', description: 'Replacement locator expression' },
                    approvalToken: { type: 'string', description: 'Cryptographic single-use approval token required to apply changes to workspace' },
                  },
                  required: ['pomPath', 'testPath', 'className', 'memberName', 'replacementSelector'],
                },
              },
              {
                name: 'generate_playwright_test',
                description: 'Generates enterprise-grade TypeScript Playwright Page Object and spec code with web-first assertions.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    featureName: { type: 'string', description: 'Name of the feature/page' },
                    baseUrl: { type: 'string', description: 'Target application URL' },
                    steps: { type: 'array', description: 'Array of interaction steps' },
                  },
                  required: ['featureName', 'steps'],
                },
              },
              {
                name: 'plan_test_architecture',
                description: 'Plans a greenfield or repository-aware brownfield Playwright test architecture; optionally creates only missing files when write is explicitly true.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    featureName: { type: 'string' },
                    mode: { type: 'string', enum: ['greenfield', 'brownfield'] },
                    baseUrl: { type: 'string' },
                    requirements: { type: 'string' },
                    steps: { type: 'array' },
                    write: { type: 'boolean' },
                  },
                  required: ['featureName', 'mode'],
                },
              },
              {
                name: 'get_product_status',
                description: 'Returns the verified PIE package identity, safety mode, and currently implemented capability surface.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'initialize_project',
                description: 'Creates or loads the project-local PIE configuration without modifying application source files.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'profile_repository',
                description: 'Builds and persists a repository convention profile for project-aware diagnosis and generation.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'cluster_failures',
                description: 'Groups normalized failure observations by deterministic fingerprints.',
                inputSchema: { type: 'object', properties: { observations: { type: 'array' } }, required: ['observations'] },
              },
              {
                name: 'suite_health',
                description: 'Calculates flaky-test, pass-rate, failure-history, and duration summaries.',
                inputSchema: { type: 'object', properties: { runs: { type: 'array' } }, required: ['runs'] },
              },
              {
                name: 'build_team_dashboard',
                description: 'Aggregates normalized CI evidence across repositories into a team quality dashboard and deterministic gate.',
                inputSchema: { type: 'object', properties: { runs: { type: 'array' }, policy: { type: 'object' } }, required: ['runs'] },
              },
              {
                name: 'analyze_repository_impact',
                description: 'Discovers Playwright test dependencies and selects impacted tests from changed files.',
                inputSchema: { type: 'object', properties: { changedFiles: { type: 'array', items: { type: 'string' } } }, required: ['changedFiles'] },
              },
              {
                name: 'compile_repair_operation',
                description: 'Validates and compiles an allowlisted repair operation into an immutable proposal.',
                inputSchema: { type: 'object', properties: { operation: { type: 'object' } }, required: ['operation'] },
              },
              {
                name: 'evaluate_quality_gate',
                description: 'Evaluates deterministic CI/release quality gates from PIE clusters, stability summaries, oracle state, and repair evidence.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'ingest_playwright_report',
                description: 'Converts a Playwright JSON report into PIE test observations, failure clusters, stability summaries, a deterministic CI quality gate, and SARIF-compatible results.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    report: { type: 'object' },
                    repository: { type: 'string' },
                    runId: { type: 'string' },
                  },
                  required: ['report'],
                },
              },
            ],
          },
        };

      case 'tools/call':
        return this.handleToolCall(id, req.params?.name, req.params?.arguments);

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method '${req.method}' not found` },
        };
    }
  }

  private async handleToolCall(id: number | string | null, toolName: string, args: any): Promise<JsonRpcResponse> {
    try {
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name' },
        };
      }

      if (toolName === 'diagnose_trace') {
        const tracePathRaw = args?.tracePath;
        if (!tracePathRaw || typeof tracePathRaw !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: 'tracePath argument must be a non-empty string' },
          };
        }

        const tracePath = this.assertPathInWorkspace(tracePathRaw);
        if (!fs.existsSync(tracePath)) {
          throw new Error(`Trace file not found: '${tracePath}'`);
        }

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
        const versionInfo = VersionDetector.detectFromLines(traceLines);
        const adapter = TraceAdapterRegistry.getAdapter(versionInfo.traceFormatVersion);
        const manifest = {
          archivePath: tracePath,
          entryNames: [traceEntryName, networkEntryName].filter(Boolean) as string[],
          traceEntryName,
          networkEntryName,
        };
        let context = await adapter.parse(manifest, traceLines, networkLines);
        if (args?.errorContextPath) {
          const errorContextPath = this.assertPathInWorkspace(args.errorContextPath);
          const errorContext = await fs.promises.readFile(errorContextPath, 'utf8');
          context = supplementDiagnosticContext(context, parseExternalFailureEvidence(errorContext));
        }
        const correlated = EvidenceCorrelator.correlate(context);
        const intelligence = await bootstrapProjectIntelligence(this.workspaceRoot);
        await recordProjectFailure(this.workspaceRoot, context.failedAction.selector, correlated.classification.category);
        const report = DiagnosticReportGenerator.generateTerminalReport(correlated, undefined, intelligence);
        const canonicalClassification = {
          ...correlated.classification,
          category: normalizeFailureCategory(correlated.classification.category),
        };

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: report }],
            classification: canonicalClassification,
            rawClassification: correlated.classification.category,
            provenance: getRuntimeProvenance(this.workspaceRoot),
            failureFingerprint: correlated.failureFingerprint,
            failureObservation: correlated.failureObservation,
            causalGraph: correlated.classification.causalGraph,
          },
        };
      }

      if (toolName === 'repair_trace') {
        const tracePath = args?.tracePath;
        if (typeof tracePath !== 'string' || !tracePath.trim()) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tracePath argument must be a non-empty string' } };
        }

        const result = await runRepairWorkflow({
          tracePath,
          workspaceRoot: this.workspaceRoot,
          errorContextPath: typeof args?.errorContextPath === 'string' ? args.errorContextPath : undefined,
          testFilePath: typeof args?.testPath === 'string' ? args.testPath : undefined,
          pomFilePath: typeof args?.pomPath === 'string' ? args.pomPath : undefined,
          className: typeof args?.className === 'string' ? args.className : undefined,
          memberName: typeof args?.memberName === 'string' ? args.memberName : undefined,
          configPath: typeof args?.configPath === 'string' ? args.configPath : undefined,
          execute: args?.execute === true,
          worktreeId: typeof args?.worktreeId === 'string' ? args.worktreeId : undefined,
          operation: args?.operation,
        });

        const response = {
          status: result.status,
          classification: {
            ...result.correlated.classification,
            category: normalizeFailureCategory(result.correlated.classification.category),
          },
          provenance: getRuntimeProvenance(this.workspaceRoot),
          failureFingerprint: result.correlated.failureFingerprint,
          failureObservation: result.correlated.failureObservation,
          failedAction: result.correlated.context.failedAction,
          proposedLocator: result.proposedLocator,
          candidate: result.candidate
            ? { locatorExpression: result.candidate.locatorExpression, score: result.candidate.score }
            : undefined,
          proposal: result.proposal
            ? {
                pattern: result.proposal.pattern,
                replacementSelector: result.proposal.replacementSelector,
                fullDiff: result.proposal.fullDiff,
                target: {
                  testFilePath: result.proposal.testFilePath,
                  pomFilePath: result.proposal.pomFilePath,
                  className: result.proposal.className,
                  memberName: result.proposal.memberName,
                },
              }
            : undefined,
          proposalId: result.stagedProposal?.proposalId,
          worktree: result.worktree,
          verification: result.verification
            ? {
                isReadyForApproval: result.verification.isReadyForApproval,
                state: result.verification.state,
                execution: result.verification.executionProof,
                intentValidation: result.verification.intentValidation,
              }
            : undefined,
          reason: result.reason,
        };

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
            ...response,
          },
        };
      }

      if (toolName === 'propose_repair') {
        if (typeof args?.tracePath !== 'string' || !args.tracePath.trim()) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tracePath argument must be a non-empty string' } };
        }
        const result = await runTraceProposalWorkflow({
          tracePath: args.tracePath,
          workspaceRoot: this.workspaceRoot,
          errorContextPath: typeof args?.errorContextPath === 'string' ? args.errorContextPath : undefined,
          executionId: typeof args?.executionId === 'string' ? args.executionId : undefined,
          testIdentity: typeof args?.testIdentity === 'string' ? args.testIdentity : undefined,
          enableBrowserInvestigation: args?.enableBrowserInvestigation === true,
          browserUrl: typeof args?.browserUrl === 'string' ? args.browserUrl : undefined,
          browserAllowedHosts: Array.isArray(args?.browserAllowedHosts) ? args.browserAllowedHosts.filter((host: unknown): host is string => typeof host === 'string') : undefined,
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ state: result.agent.state, classification: result.agent.classification, proposal: result.agent.proposal, errors: result.agent.errors }, null, 2) }],
            state: result.agent.state,
            modelInvoked: result.agent.modelInvoked,
            classification: result.agent.classification,
            proposal: result.agent.proposal,
            errors: result.agent.errors,
            evidence: {
              bundleId: result.bundle.bundleId,
              redactionComplete: result.bundle.redactionComplete,
              limitations: result.bundle.limitations,
              artifactCount: result.bundle.artifacts.length,
            },
          },
        };
      }

      if (toolName === 'autonomous_repair') {
        if (typeof args?.tracePath !== 'string' || !args.tracePath.trim()) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tracePath argument must be a non-empty string' } };
        }
        const result = await runAutonomousRepairWorkflow({
          tracePath: args.tracePath,
          workspaceRoot: this.workspaceRoot,
          errorContextPath: typeof args?.errorContextPath === 'string' ? args.errorContextPath : undefined,
          testFilePath: typeof args?.testPath === 'string' ? args.testPath : undefined,
          pomFilePath: typeof args?.pomPath === 'string' ? args.pomPath : undefined,
          className: typeof args?.className === 'string' ? args.className : undefined,
          memberName: typeof args?.memberName === 'string' ? args.memberName : undefined,
          configPath: typeof args?.configPath === 'string' ? args.configPath : undefined,
          worktreeId: typeof args?.worktreeId === 'string' ? args.worktreeId : undefined,
          execute: args?.execute === true,
          autoPromote: args?.autoPromote === true,
          enableBrowserInvestigation: args?.enableBrowserInvestigation === true,
          browserUrl: typeof args?.browserUrl === 'string' ? args.browserUrl : undefined,
          browserAllowedHosts: Array.isArray(args?.browserAllowedHosts) ? args.browserAllowedHosts.filter((host: unknown): host is string => typeof host === 'string') : undefined,
          enableTestExecution: args?.enableTestExecution === true,
        });
        const response = {
          status: result.status,
          reason: result.reason,
          modelInvoked: result.proposalRun.agent.modelInvoked,
          state: result.proposalRun.agent.state,
          classification: result.proposalRun.agent.classification,
          proposal: result.proposal,
          verification: result.verification,
          promotion: result.promotion,
        };
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }], ...response } };
      }

      if (toolName === 'initialize_project') {
        const initialized = await initProjectConfig(this.workspaceRoot);
        return { jsonrpc: '2.0', id, result: { status: initialized.created ? 'CREATED' : 'EXISTING', configPath: initialized.configPath, config: initialized.config } };
      }

      if (toolName === 'profile_repository') {
        const profile = await buildRepositoryProfile(this.workspaceRoot);
        const written = await writeRepositoryProfile(this.workspaceRoot, profile);
        return { jsonrpc: '2.0', id, result: { status: 'PROFILE_READY', profilePath: written.profilePath, profile } };
      }

      if (toolName === 'cluster_failures') {
        const observations = args?.observations;
        if (!Array.isArray(observations)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'observations must be an array' } };
        }
        const clusters = clusterFailures(observations as FailureObservation[]);
        return { jsonrpc: '2.0', id, result: { observationCount: observations.length, clusterCount: clusters.length, clusters } };
      }

      if (toolName === 'suite_health') {
        const runs = args?.runs;
        if (!Array.isArray(runs)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'runs must be an array' } };
        }
        const tests = analyzeTestStability(runs as TestRunObservation[]);
        return { jsonrpc: '2.0', id, result: { runCount: runs.length, testCount: tests.length, flakyTestCount: tests.filter((test) => test.flaky).length, tests } };
      }

      if (toolName === 'build_team_dashboard') {
        if (!Array.isArray(args?.runs)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'runs must be an array of TeamEvidenceRun objects' } };
        }
        return { jsonrpc: '2.0', id, result: buildTeamDashboard(args.runs as TeamEvidenceRun[], args?.policy ?? {}) };
      }

      if (toolName === 'analyze_repository_impact') {
        if (!Array.isArray(args?.changedFiles) || args.changedFiles.some((file: unknown) => typeof file !== 'string')) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'changedFiles must be an array of strings' } };
        }
        return { jsonrpc: '2.0', id, result: await analyzeRepositoryImpact(this.workspaceRoot, args.changedFiles as string[]) };
      }

      if (toolName === 'compile_repair_operation') {
        const operation = compileSafeRepairOperation(args?.operation);
        return { jsonrpc: '2.0', id, result: operation };
      }

      if (toolName === 'evaluate_quality_gate') {
        return { jsonrpc: '2.0', id, result: evaluateQualityGate((args ?? {}) as QualityGateInput) };
      }

      if (toolName === 'ingest_playwright_report') {
        if (!args?.report || typeof args.report !== 'object') {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'report must be a Playwright JSON report object' } };
        }
        const evidence = buildCiEvidenceReport(args.report, { repository: args.repository, runId: args.runId });
        await recordCiWorkflow(this.workspaceRoot, evidence);
        return {
          jsonrpc: '2.0',
          id,
          result: { ...evidence, sarif: buildSarifReport(evidence, PACKAGE_VERSION) },
        };
      }

      if (toolName === 'repair_page_object') {
        const { pomPath: pomRaw, testPath: testRaw, className, memberName, replacementSelector, approvalToken } = args ?? {};
        if (!pomRaw || !testRaw || !className || !memberName || !replacementSelector) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: 'Missing required arguments: pomPath, testPath, className, memberName, replacementSelector',
            },
          };
        }

        const pomPath = this.assertPathInWorkspace(pomRaw);
        const testPath = this.assertPathInWorkspace(testRaw);

        if (!fs.existsSync(pomPath)) throw new Error(`Page Object file not found: '${pomPath}'`);
        if (!fs.existsSync(testPath)) throw new Error(`Test spec file not found: '${testPath}'`);

        // Validate locator expression grammar upfront recursively
        const grammar = DiffAllowlistValidator.validateLocatorGrammar(replacementSelector);
        if (!grammar.isValid) {
          throw new Error(`Security Violation: Disallowed replacement expression '${replacementSelector}'. ${grammar.reason}`);
        }

        const origPomSource = await fs.promises.readFile(pomPath, 'utf-8');
        const origTestSource = await fs.promises.readFile(testPath, 'utf-8');
        const initialFingerprint = AssertionHasher.computeFingerprint(testPath);

        // Pre-validate diff allowlist in-memory before writing to disk
        const patcher = new AstPatcher();
        const inMemPatch = patcher.patchPageObjectInMemory(origPomSource, {
          className,
          memberName,
          replacementExpression: replacementSelector,
        });

        const diffValidation = DiffAllowlistValidator.validate({
          originalSource: origPomSource,
          patchedSource: inMemPatch.patchedSource,
          targetClassName: className,
          targetMemberName: memberName,
        });

        if (!diffValidation.isAllowed) {
          throw new Error(`Diff Allowlist Rejected: ${diffValidation.reason}`);
        }

        const fullDiff = inMemPatch.diff ?? '';

        // If an approvalToken is provided, promote atomically via WorkspacePromoter under lock
        if (approvalToken) {
          const tokenPayload = ApprovalService.getInstance().getTokenPayload(approvalToken);
          if (!tokenPayload) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `Repair Authorization Denied: Approval token '${approvalToken}' not found or already consumed/expired.`,
              },
            };
          }

          // Promote verified patch atomically via WorkspacePromoter (which validates CAS and consumes token under lock)
          const promoResult = await WorkspacePromoter.promote({
            targetFilePath: pomPath,
            workspaceRoot: this.workspaceRoot,
            patchedContent: inMemPatch.patchedSource,
            approvalTokenPayload: tokenPayload,
          });

          if (!promoResult.success) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `Workspace Promotion Failed: ${promoResult.error}`,
              },
            };
          }

          await recordProjectRepairAccepted(this.workspaceRoot, replacementSelector).catch(() => {});

          const postFingerprint = AssertionHasher.computeFingerprint(testPath);
          const assertionIntact = initialFingerprint === postFingerprint;

          if (!assertionIntact) {
            // Rollback immediately if assertion fingerprint altered
            await fs.promises.writeFile(pomPath, origPomSource, 'utf8');
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: 'Safety Invariant Violation: Assertion AST SHA-256 fingerprint altered by repair. Mutation rolled back.',
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Successfully applied authorized repair to ${className}.${memberName} via atomic WorkspacePromoter.\nAssertion AST fingerprint verified intact: ${assertionIntact}`,
                },
              ],
              status: 'APPLIED',
              patchResult: {
                filePath: pomPath,
                className,
                memberName,
                pattern: inMemPatch.pattern,
                originalSelector: '',
                replacementSelector,
                success: true,
              },
              assertionIntact: true,
            },
          };
        }

        // When approvalToken is omitted: stage proposal ONLY as a draft. Never leak usable bearer token or fabricate execution verification.
        const staged = ApprovalService.getInstance().stageProposal({
          targetFilePath: pomPath,
          targetClassName: className,
          targetMemberName: memberName,
          originalSourceContent: origPomSource,
          replacementSelector,
          fullDiff,
          patchedSource: inMemPatch.patchedSource,
          testFilePath: testPath,
          testFileContent: origTestSource,
          worktreeId: 'staged-draft',
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Repair proposal staged in-memory. Isolated AST diff validated.\nProposal ID: ${staged.proposalId}\nPattern: ${inMemPatch.pattern}\n\nTo review and authorize promotion, a human operator must run:\n  pw-intel approve ${staged.proposalId}`,
              },
            ],
            status: 'PROPOSAL_READY_FOR_APPROVAL',
            proposalId: staged.proposalId,
            pattern: inMemPatch.pattern,
            diff: inMemPatch.diff,
            target: { className, memberName, replacementSelector },
          },
        };
      }

      if (toolName === 'generate_playwright_test') {
        const { featureName, baseUrl, steps } = args ?? {};
        if (!featureName || !Array.isArray(steps)) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: 'Missing required arguments: featureName (string) and steps (array)' },
          };
        }

        const generated = TestGenerator.generateSuite(featureName, steps, baseUrl);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `// Page Object: ${generated.pageObjectName}.ts\n${generated.pageObjectCode}\n\n// Test Spec\n${generated.specCode}`,
              },
            ],
            generated,
          },
        };
      }

      if (toolName === 'plan_test_architecture') {
        const { featureName, mode, baseUrl, requirements, steps, write } = args ?? {};
        if (typeof featureName !== 'string' || !featureName.trim() || (mode !== 'greenfield' && mode !== 'brownfield')) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'featureName and mode (greenfield|brownfield) are required' } };
        }
        const profile = mode === 'brownfield' ? await buildRepositoryProfile(this.workspaceRoot) : undefined;
        const plan = planArchitecture({ featureName, mode: mode as ArchitectureMode, baseUrl, requirements, steps, profile });
        const writeResult = write === true ? await writeArchitecturePlan(this.workspaceRoot, plan) : undefined;
        await recordArchitectureWorkflow(this.workspaceRoot, plan, writeResult);
        return { jsonrpc: '2.0', id, result: { plan, writeResult } };
      }

      if (toolName === 'get_product_status') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            packageVersion: PACKAGE_VERSION,
            engineeringMilestone: ENGINE_MILESTONE,
            provenance: getRuntimeProvenance(this.workspaceRoot),
            safetyMode: 'fail-closed',
            mutationPolicy: 'approval-required',
            llmPolicy: 'provider-neutral-bounded-agent-with-deterministic-verification',
            capabilities: {
              traceDiagnosis: true,
              liveReproduction: true,
              astPageObjectRepair: true,
              traceToRepairWorkflow: true,
              isolatedWorktreeVerification: true,
              workflowRepairExecution: true,
              allowlistedOperationWorkflow: true,
              browserOperationExecutor: true,
              workspacePromotion: 'explicit-auto-promote-policy',
              builtInLlmProvider: false,
              boundedModelProposalWorkflow: true,
              boundedAutonomousRepairWorkflow: true,
              structuredGenerationAgent: true,
              repositoryInspection: true,
              repositoryBaselineRunner: true,
              externalRepositoryEvaluation: false,
              projectIntelligence: true,
              failureClustering: true,
              suiteHealth: true,
              safeOperationCompiler: true,
              qualityGate: true,
              sarifOutput: true,
              teamDashboard: true,
              architectureGeneration: true,
              firstPartySkills: true,
            },
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool '${toolName}'` },
      };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message },
      };
    }
  }
}
