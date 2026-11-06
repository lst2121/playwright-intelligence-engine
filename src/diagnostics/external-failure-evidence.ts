import { DiagnosticContext, FailedAction } from '../core/types/diagnostic-context.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

export interface ExternalFailureEvidence {
  errorMessage: string;
  errorStack?: string | undefined;
  action?: string | undefined;
  selector?: string | undefined;
  sourceFile?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

function extractSelector(text: string): string | undefined {
  const match = text.match(/waiting for (?:locator|getByRole|getByText|getByTestId|getByLabel|getByPlaceholder)\((['"`])([\s\S]*?)\1\)/i)
    ?? text.match(/locator\((['"`])([\s\S]*?)\1\)/i);
  return match?.[2];
}

function extractAction(text: string): string | undefined {
  const match = text.match(/\b(page|locator|frameLocator)\.(click|fill|press|check|uncheck|hover|selectOption|goto|waitFor|dblclick)\b/i);
  return match ? `${match[1]}.${match[2]}` : undefined;
}

function extractLocation(text: string): Pick<ExternalFailureEvidence, 'sourceFile' | 'line' | 'column'> {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(?:at\s+.*?\s+)?((?:[A-Za-z]:[\\/]|\/)?[^()\r\n]+?\.(?:ts|tsx|js|jsx):([0-9]+):([0-9]+))/i);
    if (match?.[1] && match[2] && match[3]) {
      return { sourceFile: match[1].trim(), line: Number(match[2]), column: Number(match[3]) };
    }
  }
  return {};
}

/** Parses a Playwright error-context.md file without treating it as trusted source code. */
export function parseExternalFailureEvidence(rawText: string): ExternalFailureEvidence {
  const raw = rawText.trim();
  const { redactedText: errorMessage } = EvidenceRedactor.redactText(raw);
  const location = extractLocation(raw);
  return {
    errorMessage: errorMessage.slice(0, 20000),
    errorStack: errorMessage.slice(0, 20000),
    action: extractAction(raw),
    selector: extractSelector(raw),
    ...location,
  };
}

/**
 * Supplements a trace context only when the trace did not contain a usable
 * failed action. Existing trace evidence remains authoritative.
 */
export function supplementDiagnosticContext(
  context: DiagnosticContext,
  external: ExternalFailureEvidence,
): DiagnosticContext {
  const isFallback = context.failedAction.callId === 'unknown' || context.failedAction.errorMessage === 'No explicit action failure recorded in trace';
  if (!isFallback) return context;

  const failedAction: FailedAction = {
    ...context.failedAction,
    ...(external.action ? { action: external.action } : {}),
    ...(external.selector ? { selector: external.selector } : {}),
    ...(external.sourceFile ? { sourceFile: external.sourceFile } : {}),
    ...(external.line !== undefined ? { line: external.line } : {}),
    ...(external.column !== undefined ? { column: external.column } : {}),
    errorMessage: external.errorMessage,
    ...(external.errorStack ? { errorStack: external.errorStack } : {}),
  };
  return { ...context, failedAction };
}
