import {
  DiagnosticContext,
  NetworkEvent,
  ConsoleEvent,
} from '../core/types/diagnostic-context.js';
import { FailureClassifier, ClassificationResult } from './failure-classifier.js';
import { FailureFingerprint, FailureObservation, fingerprintFailure } from '../intelligence/failure-clustering.js';

export interface CorrelatedEvidence {
  context: DiagnosticContext;
  classification: ClassificationResult;
  failureObservation: FailureObservation;
  failureFingerprint: FailureFingerprint;
  suspiciousNetworkEvents: NetworkEvent[];
  suspiciousConsoleEvents: ConsoleEvent[];
  temporalWindowMs: number;
}

export class EvidenceCorrelator {
  /**
   * Correlates network and console anomalies within an action-anchored temporal window
   * leading up to the failure (AUDIT-12).
   * Filters events FIRST before classification so the classifier evaluates only
   * causally relevant, frame-matched events.
   */
  public static correlate(
    context: DiagnosticContext,
    windowMs = 5000
  ): CorrelatedEvidence {
    // 1. Anchor reference time strictly to failedAction.timestamp if available
    let refTime: number | undefined = context.failedAction.timestamp;

    if (refTime === undefined) {
      // Fallback: collect timestamps from network and console events
      const allTimestamps: number[] = [];
      for (const net of context.networkEvents) {
        if (typeof net.timestamp === 'number') allTimestamps.push(net.timestamp);
      }
      for (const con of context.consoleEvents) {
        if (typeof con.timestamp === 'number') allTimestamps.push(con.timestamp);
      }
      refTime = allTimestamps.length > 0 ? Math.max(...allTimestamps) : undefined;
    }

    const windowStart = refTime !== undefined ? refTime - windowMs : undefined;
    const windowEnd = refTime !== undefined ? refTime + 1000 : undefined;

    // 2. Filter network events that occurred within the action-anchored temporal window with error status codes (4xx, 5xx)
    const suspiciousNetworkEvents = context.networkEvents.filter((event) => {
      const isError = event.status >= 400 || Boolean(event.errorText);
      if (!isError) return false;

      if (windowStart !== undefined && windowEnd !== undefined && typeof event.timestamp === 'number') {
        const sameScale =
          (refTime! > 1e11 && event.timestamp > 1e11) ||
          (refTime! < 1e11 && event.timestamp < 1e11);

        if (sameScale) {
          return event.timestamp >= windowStart && event.timestamp <= windowEnd;
        }
      }
      return true;
    });

    // 3. If frameId is specified, sort matching frame events to the front
    if (context.failedAction.frameId) {
      const targetFrame = context.failedAction.frameId;
      suspiciousNetworkEvents.sort((a, b) => {
        const aMatch = a.frameId === targetFrame ? 1 : 0;
        const bMatch = b.frameId === targetFrame ? 1 : 0;
        return bMatch - aMatch;
      });
    }

    // 4. Filter console errors within the action-anchored temporal window
    const suspiciousConsoleEvents = context.consoleEvents.filter((event) => {
      const isConsoleError = event.type === 'error' || event.text.toLowerCase().includes('uncaught');
      if (!isConsoleError) return false;

      if (windowStart !== undefined && windowEnd !== undefined && typeof event.timestamp === 'number') {
        return event.timestamp >= windowStart && event.timestamp <= windowEnd;
      }
      return true;
    });

    // 5. Pipe filtered, frame-matched events directly to the FailureClassifier
    const windowedContext: DiagnosticContext = {
      ...context,
      networkEvents: suspiciousNetworkEvents,
      consoleEvents: suspiciousConsoleEvents,
    };

    const classification = FailureClassifier.classify(windowedContext);
    const failureObservation: FailureObservation = {
      id: context.failedAction.callId,
      category: classification.category,
      action: context.failedAction.action,
      selector: context.failedAction.selector,
      sourceFile: context.failedAction.sourceFile,
      errorMessage: context.failedAction.errorMessage,
      errorStack: context.failedAction.errorStack,
      networkStatuses: suspiciousNetworkEvents.map((event) => event.status),
      timestamp: context.failedAction.timestamp,
      durationMs: context.failedAction.durationMs,
    };

    return {
      context,
      classification,
      failureObservation,
      failureFingerprint: fingerprintFailure(failureObservation),
      suspiciousNetworkEvents,
      suspiciousConsoleEvents,
      temporalWindowMs: windowMs,
    };
  }
}
