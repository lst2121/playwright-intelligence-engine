import {
  DiagnosticContext,
  FailedAction,
  NetworkEvent,
  ConsoleEvent,
  FailureCategory,
} from '../core/types/diagnostic-context.js';
import { VersionDetector } from './version-detector.js';

export interface RawTraceEvent {
  type: string;
  callId?: string;
  apiName?: string;
  method?: string;
  params?: Record<string, any>;
  error?: any;
  stack?: Array<{ file: string; line: number; column?: number }>;
  wallTime?: number;
  endTime?: number;
  log?: string[];
  [key: string]: any;
}

export interface ParsedTraceStream {
  actions: Map<string, FailedAction>;
  failedAction?: FailedAction;
  consoleEvents: ConsoleEvent[];
}

export class TraceParser {
  /**
   * Parses the raw lines of a .trace JSONL stream into structured actions and events.
   */
  public static parseTraceLines(lines: string[]): ParsedTraceStream {
    // Track actions by callId: pair 'before' events with corresponding 'after' events
    const actionsByCallId = new Map<string, Partial<FailedAction> & { beforeEvent?: RawTraceEvent }>();
    const consoleEvents: ConsoleEvent[] = [];
    let detectedFailedAction: FailedAction | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let event: RawTraceEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // Skip malformed JSONL records
      }

      // Handle 'before' event (action initiation in Playwright trace)
      if (event.type === 'before' && event.callId) {
        const callId = event.callId;
        const selector =
          event.params?.['selector'] ??
          (typeof event.apiName === 'string' && event.apiName.includes('locator(')
            ? event.apiName
            : undefined);

        const sourceFrame = event.stack?.[0];

        actionsByCallId.set(callId, {
          callId,
          action: event.apiName ?? 'unknown',
          selector,
          sourceFile: sourceFrame?.file,
          line: sourceFrame?.line,
          column: sourceFrame?.column,
          durationMs: 0,
          beforeEvent: event,
        });
      }

      // Handle 'after' event (action termination, contains error if failed)
      if (event.type === 'after' && event.callId) {
        const existing = actionsByCallId.get(event.callId);
        const hasError = Boolean(event.error);

        let errorMessage: string | undefined;
        let errorStack: string | undefined;

        if (event.error) {
          if (typeof event.error === 'string') {
            errorMessage = event.error;
          } else if (event.error.error?.message) {
            errorMessage = event.error.error.message;
            errorStack = event.error.error.stack;
          } else if (event.error.message) {
            errorMessage = event.error.message;
            errorStack = event.error.stack;
          }
        }

        const durationMs =
          existing?.beforeEvent?.wallTime && event.endTime
            ? event.endTime - existing.beforeEvent.wallTime
            : undefined;

        const completedAction: FailedAction = {
          callId: event.callId,
          action: existing?.action ?? event.apiName ?? 'unknown',
          selector: existing?.selector,
          sourceFile: existing?.sourceFile,
          line: existing?.line,
          column: existing?.column,
          errorMessage,
          errorStack,
          durationMs,
        };

        actionsByCallId.set(event.callId, completedAction);

        if (hasError && !detectedFailedAction) {
          detectedFailedAction = completedAction;
        }
      }

      // Handle consolidated 'action' event style
      if (event.type === 'action' && event.callId) {
        const hasError = Boolean(event.error);
        const action: FailedAction = {
          callId: event.callId,
          action: event.action ?? event.apiName ?? 'unknown',
          selector: event.params?.['selector'] ?? event.selector,
          sourceFile: event.stack?.[0]?.file ?? event.sourceFile,
          line: event.stack?.[0]?.line ?? event.line,
          column: event.stack?.[0]?.column,
          errorMessage: typeof event.error === 'string' ? event.error : event.error?.message,
          errorStack: event.error?.stack,
        };
        actionsByCallId.set(event.callId, action);
        if (hasError && !detectedFailedAction) {
          detectedFailedAction = action;
        }
      }

      // Handle console and pageError events
      if (event.type === 'event' && (event.method === 'console' || event.method === 'pageError')) {
        const consoleParams = event.params ?? {};
        consoleEvents.push({
          type: event.method === 'pageError' ? 'error' : (consoleParams['type'] ?? 'log'),
          text: consoleParams['text'] ?? JSON.stringify(consoleParams),
          timestamp: event.wallTime ?? Date.now(),
        });
      }
    }

    const validActions = new Map<string, FailedAction>();
    for (const [id, item] of actionsByCallId.entries()) {
      validActions.set(id, {
        callId: id,
        action: item.action ?? 'unknown',
        selector: item.selector,
        sourceFile: item.sourceFile,
        line: item.line,
        column: item.column,
        errorMessage: item.errorMessage,
        errorStack: item.errorStack,
        durationMs: item.durationMs,
      });
    }

    return {
      actions: validActions,
      failedAction: detectedFailedAction,
      consoleEvents,
    };
  }

  /**
   * Parses raw lines of a .network JSONL stream into structured NetworkEvents.
   */
  public static parseNetworkLines(lines: string[]): NetworkEvent[] {
    const networkEvents: NetworkEvent[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const event = JSON.parse(line);
        // Playwright network events can be request, response, or resource-snapshot
        if (event.type === 'resource-snapshot') {
          const req = event.snapshot?.request;
          const res = event.snapshot?.response;
          if (req && res) {
            networkEvents.push({
              url: req.url ?? 'unknown',
              method: req.method ?? 'GET',
              status: res.status ?? 0,
              statusText: res.statusText,
              timestamp: event.snapshot?.wallTime ?? Date.now(),
              durationMs: event.snapshot?.time,
            });
          }
        } else if (event.type === 'response' || event.response) {
          const res = event.response ?? event;
          networkEvents.push({
            url: res.url ?? event.url ?? 'unknown',
            method: event.method ?? 'GET',
            status: res.status ?? 0,
            statusText: res.statusText,
            timestamp: event.wallTime ?? Date.now(),
          });
        }
      } catch {
        continue;
      }
    }

    return networkEvents;
  }

  /**
   * Assembles a normalized DiagnosticContext from raw trace lines and network lines.
   */
  public static assembleDiagnosticContext(
    traceLines: string[],
    networkLines: string[]
  ): DiagnosticContext {
    const versionInfo = VersionDetector.detectFromLines(traceLines);
    VersionDetector.assertSupported(versionInfo);

    const { failedAction, consoleEvents } = TraceParser.parseTraceLines(traceLines);
    const networkEvents = TraceParser.parseNetworkLines(networkLines);

    const fallbackFailedAction: FailedAction = failedAction ?? {
      callId: 'unknown',
      action: 'unknown',
      errorMessage: 'No explicit action failure recorded in trace',
    };

    return {
      playwrightVersion: versionInfo.playwrightVersion ?? 'unknown',
      traceFormatVersion: versionInfo.traceFormatVersion,
      failedAction: fallbackFailedAction,
      snapshots: {},
      networkEvents,
      consoleEvents,
      evidenceCompleteness: {
        domAvailable: false, // Snapshot resolver will enrich this
        networkAvailable: networkEvents.length > 0,
        sourceAvailable: Boolean(fallbackFailedAction.sourceFile),
      },
    };
  }
}

