import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DiagnosticContext, FailureCategory } from '../core/types/diagnostic-context.js';
import { EvidenceBundle, EvidenceBundleSchema } from './llm-proposal.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import type { BrownfieldRepositoryGraph } from './repository-profile.js';

export interface EvidenceBundleBuildInput {
  executionId: string;
  testIdentity: string;
  context: DiagnosticContext;
  failureCategory?: FailureCategory | string | undefined;
  sourceContext?: EvidenceBundle['sourceContext'] | undefined;
  artifacts?: EvidenceBundle['artifacts'] | undefined;
  redactionComplete: boolean;
  limitations?: string[] | undefined;
}

/**
 * Builds the only payload that may cross the model-provider boundary. The
 * builder carries references to artifacts rather than reading or uploading
 * trace archives, and requires the caller to explicitly attest redaction.
 */
export function buildEvidenceBundle(input: EvidenceBundleBuildInput): EvidenceBundle {
  const limitations = [...(input.limitations ?? [])];
  if (!input.context.evidenceCompleteness.domAvailable) limitations.push('DOM/accessibility snapshot is unavailable');
  if (!input.context.evidenceCompleteness.networkAvailable) limitations.push('Network timeline is unavailable');
  if (!input.context.evidenceCompleteness.sourceAvailable) limitations.push('Source location is unavailable');
  if (!input.redactionComplete) limitations.push('Caller has not attested that evidence is redaction-complete');

  const redact = (value: string | undefined): string | undefined => value === undefined ? undefined : EvidenceRedactor.redactText(value).redactedText;
  const diagnostic = {
    playwrightVersion: input.context.playwrightVersion,
    traceFormatVersion: input.context.traceFormatVersion,
    failedAction: {
      callId: input.context.failedAction.callId,
      action: input.context.failedAction.action,
      ...(redact(input.context.failedAction.selector) ? { selector: redact(input.context.failedAction.selector) } : {}),
      ...(redact(input.context.failedAction.sourceFile) ? { sourceFile: redact(input.context.failedAction.sourceFile) } : {}),
      ...(input.context.failedAction.line !== undefined ? { line: input.context.failedAction.line } : {}),
      ...(input.context.failedAction.column !== undefined ? { column: input.context.failedAction.column } : {}),
      ...(redact(input.context.failedAction.errorMessage) ? { errorMessage: redact(input.context.failedAction.errorMessage) } : {}),
      ...(redact(input.context.failedAction.errorStack) ? { errorStack: redact(input.context.failedAction.errorStack) } : {}),
      ...(input.context.failedAction.durationMs !== undefined ? { durationMs: input.context.failedAction.durationMs } : {}),
      ...(input.context.failedAction.logs ? { logs: input.context.failedAction.logs.map((log) => EvidenceRedactor.redactText(log).redactedText) } : {}),
    },
    snapshots: {
      ...(input.context.snapshots.before ? { before: EvidenceRedactor.redactDomContent(input.context.snapshots.before) } : {}),
      ...(input.context.snapshots.action ? { action: EvidenceRedactor.redactDomContent(input.context.snapshots.action) } : {}),
      ...(input.context.snapshots.after ? { after: EvidenceRedactor.redactDomContent(input.context.snapshots.after) } : {}),
    },
    networkEvents: input.context.networkEvents.slice(0, 100).map((event) => ({
      method: event.method,
      url: EvidenceRedactor.redactText(event.url).redactedText,
      status: event.status,
      ...(event.statusText ? { statusText: EvidenceRedactor.redactText(event.statusText).redactedText } : {}),
      ...(event.errorText ? { errorText: EvidenceRedactor.redactText(event.errorText).redactedText } : {}),
    })),
    consoleEvents: input.context.consoleEvents.slice(0, 100).map((event) => ({
      type: event.type,
      text: EvidenceRedactor.redactText(event.text).redactedText,
    })),
    evidenceCompleteness: input.context.evidenceCompleteness,
  };

  return EvidenceBundleSchema.parse({
    bundleId: `bundle-${input.executionId}`,
    executionId: input.executionId,
    testIdentity: input.testIdentity,
    failedActionId: input.context.failedAction.callId,
    failureCategory: input.failureCategory,
    sourceContext: (input.sourceContext ?? []).map((source) => ({
      ...source,
      content: EvidenceRedactor.redactText(source.content).redactedText,
    })),
    artifacts: input.artifacts ?? [],
    diagnostic,
    redactionComplete: input.redactionComplete,
    limitations: [...new Set(limitations)],
  });
}

export const VerificationLayerStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'NOT_VERIFIED',
  'NOT_APPLICABLE',
]);
export type VerificationLayerStatus = z.infer<typeof VerificationLayerStatusSchema>;

export const ExplorationFindingCategorySchema = z.enum([
  'SPEC_VIOLATION',
  'RUNTIME_ERROR',
  'AUTOMATION_GAP',
  'OBSERVED_BEHAVIOR',
  'NOT_VERIFIED',
]);
export type ExplorationFindingCategory = z.infer<typeof ExplorationFindingCategorySchema>;

export const VerifiedLocatorEvidenceSchema = z.object({
  id: z.string().min(1),
  route: z.string().min(1),
  strategy: z.enum(['role', 'label', 'placeholder', 'testId', 'text', 'css', 'frame']),
  expression: z.string().min(1),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  frameSelector: z.string().optional(),
  matchCount: z.number().int().min(0),
  visible: z.boolean(),
  enabled: z.boolean(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string(),
});
export type VerifiedLocatorEvidence = z.infer<typeof VerifiedLocatorEvidenceSchema>;

export const ExplorationNetworkRecordSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().optional(),
  method: z.string(),
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().optional(),
  isError: z.boolean(),
  resourceType: z.string().optional(),
  errorText: z.string().optional(),
  timestamp: z.string(),
});
export type ExplorationNetworkRecord = z.infer<typeof ExplorationNetworkRecordSchema>;

export const ExplorationActionRecordSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  stepIndex: z.number().int().min(0),
  action: z.string().min(1),
  targetLocatorId: z.string().optional(),
  targetExpression: z.string().optional(),
  valueRedacted: z.string().optional(),
  routeBefore: z.string(),
  routeAfter: z.string(),
  domBeforeSummary: z.string(),
  domAfterSummary: z.string(),
  domDiff: z.array(z.string()).default([]),
  networkIds: z.array(z.string()).default([]),
  consoleErrors: z.array(z.string()).default([]),
  screenshotPath: z.string().optional(),
  status: z.enum(['EXECUTED', 'FAILED', 'BLOCKED_BY_POLICY', 'SKIPPED']),
  timestamp: z.string(),
});
export type ExplorationActionRecord = z.infer<typeof ExplorationActionRecordSchema>;

export const ExplorationFindingSchema = z.object({
  id: z.string().min(1),
  category: ExplorationFindingCategorySchema,
  scenarioId: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  expectedSource: z.string().optional(),
  expectedBehavior: z.string().optional(),
  actualBehavior: z.string().min(1),
  confidence: z.number().min(0).max(1),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
});
export type ExplorationFinding = z.infer<typeof ExplorationFindingSchema>;

export const ScenarioExplorationStatusSchema = z.object({
  scenarioId: z.string().min(1),
  status: z.enum(['VERIFIED', 'BLOCKED', 'DEFECT_DETECTED', 'NOT_VERIFIED', 'PARTIAL']),
  verificationLayers: z.object({
    UI: VerificationLayerStatusSchema,
    API: VerificationLayerStatusSchema,
    CLIENT_RELOAD: VerificationLayerStatusSchema,
    DB: VerificationLayerStatusSchema,
  }),
  reason: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type ScenarioExplorationStatus = z.infer<typeof ScenarioExplorationStatusSchema>;

export const ExplorationRouteObservationSchema = z.object({
  route: z.string().min(1),
  title: z.string().optional(),
  discoveredAt: z.string(),
  locatorIds: z.array(z.string()).default([]),
});

export const EvidenceIndexEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.string(),
  confidence: z.number().min(0).max(1),
  scenarioIds: z.array(z.string()).default([]),
  description: z.string(),
});

export const ExplorationContextBundleSchema = z.object({
  bundleVersion: z.literal('1.0').default('1.0'),
  bundleId: z.string().min(1),
  createdAt: z.string(),
  topology: z.enum(['monorepo', 'standalone', 'source-only']),
  runtimeVerified: z.boolean(),
  baseUrl: z.string().optional(),
  authentication: z.object({
    configured: z.boolean(),
    method: z.enum(['none', 'storage-state', 'login-flow', 'existing-fixture']),
    authenticated: z.boolean(),
    secretsExposed: z.literal(false).default(false),
  }),
  requirements: z.object({
    featureName: z.string().min(1),
    requirementIds: z.array(z.string()).default([]),
    scenarioIds: z.array(z.string()).default([]),
    workflowPlanHash: z.string().optional(),
  }),
  routes: z.array(ExplorationRouteObservationSchema).default([]),
  locators: z.array(VerifiedLocatorEvidenceSchema).default([]),
  actions: z.array(ExplorationActionRecordSchema).default([]),
  network: z.array(ExplorationNetworkRecordSchema).default([]),
  consoleErrors: z.array(z.string()).default([]),
  persistenceObservations: z.array(z.object({
    scenarioId: z.string(),
    clientReloadPreserved: z.boolean().optional(),
    dbStatus: VerificationLayerStatusSchema,
    note: z.string(),
  })).default([]),
  scenarioStatuses: z.array(ScenarioExplorationStatusSchema).default([]),
  findings: z.array(ExplorationFindingSchema).default([]),
  repositoryGraph: z.custom<BrownfieldRepositoryGraph>().optional(),
  evidenceIndex: z.array(EvidenceIndexEntrySchema).default([]),
  limitations: z.array(z.string()).default([]),
  redactionComplete: z.literal(true).default(true),
});
export type ExplorationContextBundle = z.infer<typeof ExplorationContextBundleSchema>;

export function sanitizeUrlSecrets(rawUrl: string): string {
  const redactedText = EvidenceRedactor.redactText(rawUrl).redactedText;
  try {
    const parsed = new URL(redactedText);
    const sensitiveParamRe = /^(?:token|access_token|id_token|refresh_token|auth|secret|password|passwd|api_?key|key|session|jwt|code)$/i;
    let changed = false;
    for (const paramKey of [...parsed.searchParams.keys()]) {
      if (sensitiveParamRe.test(paramKey)) {
        parsed.searchParams.set(paramKey, '[REDACTED]');
        changed = true;
      }
    }
    return changed ? parsed.toString() : redactedText;
  } catch {
    return redactedText.replace(/([?&](?:token|access_token|id_token|refresh_token|auth|secret|password|api_?key|key|session|jwt)=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

export function redactExplorationBundle(bundle: ExplorationContextBundle): ExplorationContextBundle {
  const redact = (value: string): string => EvidenceRedactor.redactText(value).redactedText;
  return ExplorationContextBundleSchema.parse({
    ...bundle,
    ...(bundle.baseUrl ? { baseUrl: sanitizeUrlSecrets(bundle.baseUrl) } : {}),
    authentication: {
      ...bundle.authentication,
      secretsExposed: false,
    },
    actions: bundle.actions.map((a) => ({
      ...a,
      domBeforeSummary: EvidenceRedactor.redactDomContent(a.domBeforeSummary),
      domAfterSummary: EvidenceRedactor.redactDomContent(a.domAfterSummary),
      domDiff: a.domDiff.map(redact),
      consoleErrors: a.consoleErrors.map(redact),
      ...(a.valueRedacted ? { valueRedacted: redact(a.valueRedacted) } : {}),
    })),
    network: bundle.network.map((n) => ({
      ...n,
      url: sanitizeUrlSecrets(n.url),
      ...(n.errorText ? { errorText: redact(n.errorText) } : {}),
    })),
    consoleErrors: bundle.consoleErrors.map(redact),
    findings: bundle.findings.map((f) => ({
      ...f,
      actualBehavior: redact(f.actualBehavior),
      ...(f.expectedBehavior ? { expectedBehavior: redact(f.expectedBehavior) } : {}),
    })),
    redactionComplete: true,
  });
}

export async function saveExplorationContextBundle(
  bundlePath: string,
  bundle: ExplorationContextBundle,
): Promise<void> {
  const clean = redactExplorationBundle(bundle);
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.writeFile(bundlePath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

export async function loadExplorationContextBundle(bundlePath: string): Promise<ExplorationContextBundle> {
  const raw = await fs.readFile(bundlePath, 'utf8');
  return ExplorationContextBundleSchema.parse(JSON.parse(raw));
}
