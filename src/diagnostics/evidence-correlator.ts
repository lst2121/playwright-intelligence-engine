import {
  DiagnosticContext,
  FailedAction,
  NetworkEvent,
  ConsoleEvent,
} from '../core/types/diagnostic-context.js';
import { FailureClassifier, ClassificationResult } from './failure-classifier.js';

export interface CorrelatedEvidence {
  context: DiagnosticContext;
  classification: ClassificationResult;
  suspiciousNetworkEvents: NetworkEvent[];
  suspiciousConsoleEvents: ConsoleEvent[];
  temporalWindowMs: number;
}

export class EvidenceCorrelator {
  /**
   * Correlates network and console anomalies within a temporal window leading up to the failure.
   */
  public static correlate(
    context: DiagnosticContext,
    windowMs = 5000
  ): CorrelatedEvidence {
    const classification = FailureClassifier.classify(context);

    // Filter network events that occurred with error status codes (4xx, 5xx)
    const suspiciousNetworkEvents = context.networkEvents.filter(
      (event) => event.status >= 400 || Boolean(event.errorText)
    );

    // Filter console errors
    const suspiciousConsoleEvents = context.consoleEvents.filter(
      (event) => event.type === 'error' || event.text.toLowerCase().includes('uncaught')
    );

    return {
      context,
      classification,
      suspiciousNetworkEvents,
      suspiciousConsoleEvents,
      temporalWindowMs: windowMs,
    };
  }
}
