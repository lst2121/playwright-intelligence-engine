import {
  DiagnosticContext,
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
   * Actually applies the temporalWindowMs filter relative to the latest event timestamp in the trace timeline.
   */
  public static correlate(
    context: DiagnosticContext,
    windowMs = 5000
  ): CorrelatedEvidence {
    const classification = FailureClassifier.classify(context);

    // Compute trace reference failure timestamp from events
    const allTimestamps: number[] = [];
    for (const net of context.networkEvents) {
      if (typeof net.timestamp === 'number') allTimestamps.push(net.timestamp);
    }
    for (const con of context.consoleEvents) {
      if (typeof con.timestamp === 'number') allTimestamps.push(con.timestamp);
    }

    const refTime = allTimestamps.length > 0 ? Math.max(...allTimestamps) : undefined;
    const windowStart = refTime !== undefined ? refTime - windowMs : undefined;
    const windowEnd = refTime !== undefined ? refTime + 1000 : undefined;

    // Filter network events that occurred within the temporal window with error status codes (4xx, 5xx)
    const suspiciousNetworkEvents = context.networkEvents.filter((event) => {
      const isError = event.status >= 400 || Boolean(event.errorText);
      if (!isError) return false;

      if (windowStart !== undefined && windowEnd !== undefined && typeof event.timestamp === 'number') {
        return event.timestamp >= windowStart && event.timestamp <= windowEnd;
      }
      return true;
    });

    // Filter console errors within the temporal window
    const suspiciousConsoleEvents = context.consoleEvents.filter((event) => {
      const isConsoleError = event.type === 'error' || event.text.toLowerCase().includes('uncaught');
      if (!isConsoleError) return false;

      if (windowStart !== undefined && windowEnd !== undefined && typeof event.timestamp === 'number') {
        return event.timestamp >= windowStart && event.timestamp <= windowEnd;
      }
      return true;
    });

    return {
      context,
      classification,
      suspiciousNetworkEvents,
      suspiciousConsoleEvents,
      temporalWindowMs: windowMs,
    };
  }
}
