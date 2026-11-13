import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { parseExternalFailureEvidence, supplementDiagnosticContext } from '../diagnostics/external-failure-evidence.js';
import { buildEvidenceBundle } from './evidence-bundle.js';
import { runRepairProposalAgent, RepairAgentResult } from './repair-agent.js';
import { OpenAiCompatibleProposalProvider, ProposalProvider } from './model-provider.js';
import { EvidenceBundle } from './llm-proposal.js';
import { CorrelatedEvidence } from '../diagnostics/evidence-correlator.js';
import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { bootstrapProjectIntelligence, getHistoricalSelectorScore } from './project-intelligence.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { discoverRepairSourceMapping } from '../repair/source-mapper.js';
import { DirectBrowserInvestigator } from '../reproduce/direct-browser-investigator.js';
import { CandidateExtractor } from '../selector/candidate-extractor.js';
import { RepairCandidateRanker } from '../selector/repair-candidate-ranker.js';
import { AbstentionPolicy } from '../selector/abstention-policy.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';

export interface TraceProposalWorkflowInput {
  tracePath: string;
  workspaceRoot?: string | undefined;
  errorContextPath?: string | undefined;
  executionId?: string | undefined;
  testIdentity?: string | undefined;
  enableBrowserInvestigation?: boolean | undefined;
  browserUrl?: string | undefined;
  browserAllowedHosts?: string[] | undefined;
  enableTestExecution?: boolean | undefined;
  provider?: ProposalProvider | undefined;
}

export interface TraceProposalWorkflowResult {
  context: DiagnosticContext;
  correlated: CorrelatedEvidence;
  bundle: EvidenceBundle;
  agent: RepairAgentResult;
}

function assertWorkspacePath(root: string, target: string, label: string): string {
  const canonicalRoot = fsSync.realpathSync(root);
  const resolved = path.resolve(root, target);
  if (!fsSync.existsSync(resolved)) throw new Error(`${label} not found: '${resolved}'`);
  const canonicalTarget = fsSync.realpathSync(resolved);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes workspace root: '${target}'`);
  return canonicalTarget;
}

function resolveReadOnlyPath(root: string, target: string, label: string): string {
  const resolved = path.isAbsolute(target) ? target : path.resolve(root, target);
  if (!fsSync.existsSync(resolved)) throw new Error(`${label} not found: '${resolved}'`);
  return fsSync.realpathSync(resolved);
}

async function searchRepository(root: string, query: string): Promise<Array<{ filePath: string; line: number; snippet: string }>> {
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.pie', '.pw-intelligence']);
  const results: Array<{ filePath: string; line: number; snippet: string }> = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6 || results.length >= 30) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= 30 || ignored.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!/\.(?:ts|tsx|js|jsx|json|md|yaml|yml)$/i.test(entry.name)) continue;
      let content: string;
      try { content = await fs.readFile(full, 'utf8'); } catch { continue; }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length >= 30 || !line.toLowerCase().includes(query.toLowerCase())) return;
        results.push({ filePath: path.relative(root, full), line: index + 1, snippet: EvidenceRedactor.redactText(line.slice(0, 500)).redactedText });
      });
    }
  };
  await walk(root, 0);
  return results;
}

function configuredProvider(): ProposalProvider | undefined {
  const apiKey = process.env.PIE_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const endpoint = process.env.PIE_LLM_ENDPOINT ?? (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : (apiKey ? 'https://api.deepseek.com/chat/completions' : undefined));
  const model = process.env.PIE_LLM_MODEL ?? (process.env.OPENAI_API_KEY ? 'gpt-4o' : (apiKey ? 'deepseek-chat' : undefined));
  if (!endpoint || !model) return undefined;
  const timeoutRaw = process.env.PIE_LLM_TIMEOUT_MS;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
  return new OpenAiCompatibleProposalProvider({
    endpoint,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(Number.isFinite(timeoutMs) && timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
  });
}

/**
 * Runs one bounded, redaction-aware model proposal step from a trace archive.
 * Deterministic classification executes before the provider and the returned
 * proposal is never executed or promoted by this function.
 */
export async function runTraceProposalWorkflow(input: TraceProposalWorkflowInput): Promise<TraceProposalWorkflowResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const tracePath = resolveReadOnlyPath(workspaceRoot, input.tracePath, 'Trace archive');
  const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
  if (!traceEntryName) throw new Error(`No .trace event stream found in archive '${tracePath}'`);

  const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? [traceEntryName]);
  const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
    ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames ?? [networkEntryName!])
    : '';
  let context = TraceParser.assembleDiagnosticContext(traceText.split('\n'), networkText.split('\n'));
  if (input.errorContextPath) {
    const errorContextPath = resolveReadOnlyPath(workspaceRoot, input.errorContextPath, 'Error context');
    context = supplementDiagnosticContext(context, parseExternalFailureEvidence(await fs.readFile(errorContextPath, 'utf8')));
  }

  const correlated = EvidenceCorrelator.correlate(context);
  const intelligence = await bootstrapProjectIntelligence(workspaceRoot);
  const deterministicProposedLocator = DiagnosticReportGenerator.extractProposedLocator(correlated, intelligence);
  const sourceMapping = await discoverRepairSourceMapping({ workspaceRoot, failedAction: correlated.context.failedAction });
  const sourceContext: EvidenceBundle['sourceContext'] = [];
  const profile = intelligence.profile;
  const projectContext = profile
    ? {
        preferredLocator: profile.locatorConventions.preferred,
        usesPageObjects: profile.structure.usesPageObjects,
        usesCustomFixtures: profile.structure.usesCustomFixtures,
        usesStorageState: profile.structure.usesStorageState,
        domainTerms: profile.domainTerms.slice(0, 30),
        ...(context.failedAction.selector
          ? { historicalSelectorReliability: getHistoricalSelectorScore(intelligence, context.failedAction.selector) }
          : {}),
      }
    : undefined;
  if (projectContext) {
    sourceContext.push({ filePath: '.pie/project-intelligence.json', content: JSON.stringify(projectContext, null, 2) });
  }
  if (sourceMapping?.pomFilePath) {
    try {
      const source = await fs.readFile(sourceMapping.pomFilePath, 'utf8');
      const lines = source.split(/\r?\n/);
      const center = correlated.context.failedAction.line ?? 1;
      const start = Math.max(0, center - 8);
      const end = Math.min(lines.length, center + 8);
      sourceContext.push({
        filePath: path.relative(workspaceRoot, sourceMapping.pomFilePath),
        startLine: start + 1,
        endLine: end,
        content: lines.slice(start, end).join('\n'),
      });
    } catch {
      // Source mapping remains available as an action observation even when a snippet cannot be read.
    }
  }
  const bundle = buildEvidenceBundle({
    executionId: input.executionId ?? `trace-${Date.now()}`,
    testIdentity: input.testIdentity ?? context.failedAction.sourceFile ?? 'unknown-test',
    context,
    failureCategory: correlated.classification.category,
    redactionComplete: true,
    sourceContext,
    artifacts: [
      { kind: 'trace', reference: path.relative(workspaceRoot, tracePath), redacted: true },
      ...(networkEntryName ? [{ kind: 'network' as const, reference: path.relative(workspaceRoot, networkEntryName), redacted: true }] : []),
    ],
  });
  const agent = await runRepairProposalAgent({
    context,
    bundle,
    provider: input.provider ?? configuredProvider(),
    allowModelEscalation: true,
    strategy: correlated.classification.category === 'LOCATOR_DRIFT'
      && correlated.classification.confidence >= 0.85
      && Boolean(deterministicProposedLocator)
      ? 'single-shot'
      : 'agent',
    maxDurationMs: (() => {
      const raw = Number(process.env.PIE_LLM_AGENT_MAX_DURATION_MS ?? 180000);
      return Number.isFinite(raw) && raw > 0 ? raw : 180000;
    })(),
    // Step budget prevents deadlocks; token limits remain provider/user controlled.
    maxSteps: 6,
    actionHandlers: {
      inspect_evidence: async () => ({
        category: correlated.classification.category,
        failedAction: correlated.context.failedAction,
        evidenceCompleteness: correlated.context.evidenceCompleteness,
        networkEvents: correlated.context.networkEvents.length,
        consoleEvents: correlated.context.consoleEvents.length,
      }),
      inspect_browser_state: async () => {
        if (input.enableBrowserInvestigation !== true) {
          return { status: 'DISABLED', reason: 'Browser investigation requires explicit opt-in.' };
        }
        if (!input.browserUrl) {
          return { status: 'INSUFFICIENT_EVIDENCE', reason: 'No explicit browser URL was supplied.' };
        }
        let browserHost: string;
        try {
          browserHost = new URL(input.browserUrl).hostname;
        } catch {
          return { status: 'INSUFFICIENT_EVIDENCE', reason: 'The supplied browser URL is invalid.' };
        }
        if (!input.browserAllowedHosts?.includes(browserHost)) {
          return { status: 'POLICY_BLOCKED', reason: 'Browser investigation requires an explicit allowed-host list.' };
        }
        const investigation = await DirectBrowserInvestigator.investigateUrl({
          url: input.browserUrl,
          executionId: `${input.executionId ?? 'trace'}-browser-investigation`,
          timeoutMs: 10000,
        });
        const clip = (value: unknown, limit: number): string | undefined => {
          const text = typeof value === 'string' ? value : value === undefined ? undefined : JSON.stringify(value);
          if (text === undefined || text.length <= limit) return text;
          return `${text.slice(0, limit)}\n[PIE browser evidence clipped]`;
        };
        return {
          status: investigation.status,
          pageUrl: investigation.pageUrl,
          error: investigation.error,
          domSnapshot: clip(investigation.domSnapshotRecord?.payload, 8000),
          ariaSnapshot: clip(investigation.ariaSnapshotRecord?.payload, 8000),
          recordKinds: investigation.records.map((record) => record.evidenceType).slice(0, 20),
        };
      },
      inspect_repository: async () => ({
        repository: intelligence.profile?.repository,
        structure: intelligence.profile?.structure,
        paths: intelligence.profile?.paths,
        locatorConventions: intelligence.profile?.locatorConventions,
        testConventions: intelligence.profile?.testConventions,
        domainTerms: intelligence.profile?.domainTerms?.slice(0, 50),
      }),
      read_source_file: async (action) => {
        const sourcePath = action.path ?? action.sourceFile;
        if (!sourcePath) return { status: 'INPUT_REQUIRED', reason: 'A path or sourceFile is required.' };
        const resolved = assertWorkspacePath(workspaceRoot, sourcePath, 'Source file');
        const content = await fs.readFile(resolved, 'utf8');
        const clipped = content.length > 16000 ? `${content.slice(0, 16000)}\n[PIE source evidence clipped]` : content;
        return { status: 'FOUND', filePath: path.relative(workspaceRoot, resolved), content: EvidenceRedactor.redactText(clipped).redactedText };
      },
      search_repository: async (action) => {
        if (!action.query) return { status: 'INPUT_REQUIRED', reason: 'A query is required.' };
        return { status: 'FOUND', query: action.query, matches: await searchRepository(workspaceRoot, action.query) };
      },
      discover_source_mapping: async () => sourceMapping ?? {
        status: 'NOT_FOUND',
        reason: 'No unique source mapping was discovered.',
      },
      rank_locator_candidates: async () => ({
        ...(() => {
          const domRoot = (correlated.context as unknown as { domRoot?: unknown }).domRoot;
          if (!domRoot) return { status: 'NO_DOM_EVIDENCE', candidates: [], proposedLocator: null };
          try {
            const candidates = CandidateExtractor.extractCandidates(domRoot as Parameters<typeof CandidateExtractor.extractCandidates>[0], correlated.context.failedAction);
            const ranked = RepairCandidateRanker.rank(
              candidates,
              correlated.context.failedAction.selector,
              correlated.context.failedAction.action,
              intelligence,
              domRoot as Parameters<typeof CandidateExtractor.extractCandidates>[0],
              correlated.context.failedAction.selector
            );
            const decision = AbstentionPolicy.evaluate(ranked);
            return {
              status: decision.shouldAbstain ? 'CANDIDATES_REQUIRE_REVIEW' : 'CANDIDATE_AVAILABLE',
              proposedLocator: deterministicProposedLocator ?? null,
              abstentionStage: decision.stage,
              abstentionReason: decision.reason ?? null,
              candidates: ranked.slice(0, 10).map((candidate) => ({
                locator: candidate.locatorExpression,
                score: candidate.breakdown.score,
                identityMatch: candidate.breakdown.identityMatch,
                matchCount: candidate.breakdown.matchCount,
                element: {
                  tag: candidate.element.tag,
                  role: candidate.element.role,
                  accessibleName: candidate.element.accessibleName,
                  text: candidate.element.text,
                  attributes: candidate.element.attributes,
                },
              })),
            };
          } catch (error) {
            return { status: 'CANDIDATE_EXTRACTION_FAILED', candidates: [], proposedLocator: deterministicProposedLocator ?? null, reason: error instanceof Error ? error.message : String(error) };
          }
        })(),
      }),
      build_repair_proposal: async (action) => ({
        status: 'PROPOSAL_ONLY',
        target: action.target ?? null,
        locator: action.locator ?? deterministicProposedLocator ?? null,
        message: 'PIE has not modified or executed any source. The model must return the final schema-validated proposal.',
      }),
      run_target_test: async (action) => {
        if (input.enableTestExecution !== true) return { status: 'DISABLED', reason: 'Targeted test execution requires explicit opt-in.' };
        const target = action.testFile ?? action.sourceFile;
        if (!target) return { status: 'INPUT_REQUIRED', reason: 'testFile or sourceFile is required.' };
        const testPath = assertWorkspacePath(workspaceRoot, target, 'Target test');
        const relativeTest = path.relative(workspaceRoot, testPath);
        const args = ['playwright', 'test', relativeTest, '--reporter=line'];
        if (action.configPath) args.push('--config', path.relative(workspaceRoot, assertWorkspacePath(workspaceRoot, action.configPath, 'Playwright config')));
        const execution = await ExecutionRunner.run('npx', { cwd: workspaceRoot, args, timeoutMs: 120000 });
        const clip = (value: string): string => EvidenceRedactor.redactText(value.slice(0, 8000)).redactedText;
        return { status: execution.exitCode === 0 ? 'PASSED' : 'FAILED', exitCode: execution.exitCode, timedOut: execution.timedOut, stdout: clip(execution.stdout), stderr: clip(execution.stderr), durationMs: execution.durationMs };
      },
      verify_repair: async () => ({
        status: 'NOT_EXECUTED',
        reason: 'Trace proposal workflow is proposal-only. Isolated verification requires the repair workflow and explicit execution policy.',
      }),
    },
  });
  return { context, correlated, bundle, agent };
}
