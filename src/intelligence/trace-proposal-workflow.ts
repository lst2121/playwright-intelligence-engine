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

export interface TraceProposalWorkflowInput {
  tracePath: string;
  workspaceRoot?: string | undefined;
  errorContextPath?: string | undefined;
  executionId?: string | undefined;
  testIdentity?: string | undefined;
  enableBrowserInvestigation?: boolean | undefined;
  browserUrl?: string | undefined;
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

function configuredProvider(): ProposalProvider | undefined {
  const endpoint = process.env.PIE_LLM_ENDPOINT;
  const model = process.env.PIE_LLM_MODEL;
  if (!endpoint || !model) return undefined;
  const timeoutRaw = process.env.PIE_LLM_TIMEOUT_MS;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
  return new OpenAiCompatibleProposalProvider({
    endpoint,
    model,
    apiKey: process.env.PIE_LLM_API_KEY,
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
  const tracePath = assertWorkspacePath(workspaceRoot, input.tracePath, 'Trace archive');
  const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
  if (!traceEntryName) throw new Error(`No .trace event stream found in archive '${tracePath}'`);

  const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? [traceEntryName]);
  const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
    ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames ?? [networkEntryName!])
    : '';
  let context = TraceParser.assembleDiagnosticContext(traceText.split('\n'), networkText.split('\n'));
  if (input.errorContextPath) {
    const errorContextPath = assertWorkspacePath(workspaceRoot, input.errorContextPath, 'Error context');
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
    strategy: correlated.classification.category === 'LOCATOR_DRIFT'
      && correlated.classification.confidence >= 0.85
      && Boolean(deterministicProposedLocator)
      ? 'single-shot'
      : 'agent',
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
      discover_source_mapping: async () => sourceMapping ?? {
        status: 'NOT_FOUND',
        reason: 'No unique source mapping was discovered.',
      },
      rank_locator_candidates: async () => ({
        status: deterministicProposedLocator ? 'CANDIDATE_AVAILABLE' : 'NO_SAFE_CANDIDATE',
        proposedLocator: deterministicProposedLocator ?? null,
      }),
      build_repair_proposal: async (action) => ({
        status: 'PROPOSAL_ONLY',
        target: action.target ?? null,
        locator: action.locator ?? deterministicProposedLocator ?? null,
        message: 'PIE has not modified or executed any source. The model must return the final schema-validated proposal.',
      }),
      verify_repair: async () => ({
        status: 'NOT_EXECUTED',
        reason: 'Trace proposal workflow is proposal-only. Isolated verification requires the repair workflow and explicit execution policy.',
      }),
    },
  });
  return { context, correlated, bundle, agent };
}
