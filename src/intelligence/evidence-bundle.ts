import { DiagnosticContext, FailureCategory } from '../core/types/diagnostic-context.js';
import { EvidenceBundle, EvidenceBundleSchema } from './llm-proposal.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

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
    sourceContext: input.sourceContext ?? [],
    artifacts: input.artifacts ?? [],
    diagnostic,
    redactionComplete: input.redactionComplete,
    limitations: [...new Set(limitations)],
  });
}
