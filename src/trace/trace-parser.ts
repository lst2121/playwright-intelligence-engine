import {
  DiagnosticContext,
  FailedAction,
  NetworkEvent,
  ConsoleEvent,
} from '../core/types/diagnostic-context.js';
import { VersionDetector } from './version-detector.js';
import { SnapshotResolver, ResolvedElement } from './snapshot-resolver.js';

export interface RawTraceEvent {
  type: string;
  callId?: string;
  apiName?: string;
  method?: string;
  title?: string;
  params?: Record<string, any>;
  error?: any;
  stack?: Array<{ file: string; line: number; column?: number }>;
  wallTime?: number;
  startTime?: number;
  endTime?: number;
  log?: string[];
  message?: string;
  snapshot?: any;
  [key: string]: any;
}

export interface ParsedTraceStream {
  actions: Map<string, FailedAction>;
  failedAction?: FailedAction | undefined;
  consoleEvents: ConsoleEvent[];
  rawSnapshots?: any[];
  latestResolvedDom?: ResolvedElement | null;
  mainFrameDom?: ResolvedElement | null;
  latestChildFrameDom?: ResolvedElement | null;
  domByCallId?: Map<string, ResolvedElement>;
  domByFrameId?: Map<string, ResolvedElement>;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function inferActionDetailsFromError(errorMessage: string | undefined): { action?: string; selector?: string } {
  if (!errorMessage) return {};
  const text = stripAnsi(errorMessage);
  const waitingMatch = text.match(/waiting for\s+([^\r\n]+)/i);
  const waitingTarget = waitingMatch?.[1]?.trim();
  const selector = waitingTarget && /^(?:locator|getBy|frameLocator)\(/i.test(waitingTarget)
    ? waitingTarget
    : undefined;

  // The common Playwright form is "locator.click: ...". Keep the method
  // separate from the human-readable parent test.step title so the classifier
  // evaluates actionability evidence in the correct order.
  const locatorAction = text.match(/\blocator\.([a-zA-Z]+):/i)?.[1];
  const result: { action?: string; selector?: string } = {};
  if (locatorAction) result.action = locatorAction.toLowerCase();
  if (!result.action && /expect\s+failed|expect\s*\(|assert(?:ion)?\s+failed/i.test(text)) {
    result.action = 'expect';
  }
  if (selector) result.selector = selector;
  return result;
}

export class TraceParser {
  private static selectFailedAction(candidates: FailedAction[]): FailedAction | undefined {
    if (candidates.length === 0) return undefined;
    const score = (candidate: FailedAction): number => {
      const action = candidate.action.toLowerCase();
      const message = candidate.errorMessage ?? '';
      let value = 0;
      if (candidate.selector) value += 4;
      if (message.length > 40) value += 1;
      if (/(click|fill|press|check|select|goto|navigate|expect|locator)/i.test(action)) value += 2;
      if (/(fixture|hook|worker cleanup|beforeeach|aftereach)/i.test(action)) value -= 2;
      return value;
    };
    return [...candidates].sort((left, right) => {
      return score(right) - score(left) || (right.timestamp ?? 0) - (left.timestamp ?? 0) || left.callId.localeCompare(right.callId);
    })[0];
  }

  /**
   * Parses the raw lines of a .trace JSONL stream into structured actions, events, and DOM snapshots.
   */
  public static parseTraceLines(lines: string[]): ParsedTraceStream {
    const actionsByCallId = new Map<string, Partial<FailedAction> & { beforeEvent?: RawTraceEvent }>();
    const consoleEvents: ConsoleEvent[] = [];
    const logsByCallId = new Map<string, string[]>();
    const rawSnapshots: any[] = [];
    const domByCallId = new Map<string, ResolvedElement>();
    const domByFrameId = new Map<string, ResolvedElement>();
    let mainFrameId: string | null = null;
    let mainFrameDom: ResolvedElement | null = null;
    let latestChildFrameDom: ResolvedElement | null = null;
    let latestResolvedDom: ResolvedElement | null = null;
    const failedActionCandidates: FailedAction[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let event: RawTraceEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // Skip malformed JSONL records
      }

      // Handle 'log' event
      if (event.type === 'log' && event.callId && typeof event.message === 'string') {
        let logs = logsByCallId.get(event.callId);
        if (!logs) {
          logs = [];
          logsByCallId.set(event.callId, logs);
        }
        logs.push(event.message);
      }

      // Handle 'frame-snapshot' event
      if (event.type === 'frame-snapshot' && event.snapshot) {
        rawSnapshots.push(event.snapshot);
        const snapIndex = rawSnapshots.length - 1;
        const snapContent = event.snapshot.html ?? event.snapshot.node;
        const resolved = SnapshotResolver.resolveDifferentialNode(snapContent, snapIndex, rawSnapshots);
        if (resolved && typeof resolved === 'object' && 'tag' in resolved) {
          const resolvedEl = resolved as ResolvedElement;
          const frameId = event.snapshot.frameId ?? event.frameId;
          const isExplicitMainFrame = event.snapshot.isMainFrame === true || event.isMainFrame === true;
          const isExplicitChildFrame = event.snapshot.isMainFrame === false || event.isMainFrame === false;

          if (frameId) {
            domByFrameId.set(frameId, resolvedEl);
            if (isExplicitMainFrame || (!mainFrameId && !isExplicitChildFrame)) {
              mainFrameId = frameId;
            }
          }

          if (event.snapshot.callId) {
            domByCallId.set(event.snapshot.callId, resolvedEl);
          }

          const isMain = isExplicitMainFrame || (frameId && frameId === mainFrameId) || (!frameId && !isExplicitChildFrame);

          if (isMain) {
            mainFrameDom = resolvedEl;
            latestResolvedDom = resolvedEl;
          } else {
            latestChildFrameDom = resolvedEl;
            // Child iframe snapshot: preserve mainFrameDom, update latestResolvedDom only if mainFrameDom not set
            if (!mainFrameDom) {
              latestResolvedDom = resolvedEl;
            }
          }
        }
      }

      // Handle 'before' event (action initiation in Playwright trace)
      if (event.type === 'before' && event.callId) {
        const callId = event.callId;
        let selector =
          event.params?.['selector'] ??
          event.params?.['locator'] ??
          event.subtitle ??
          (typeof event.apiName === 'string' && event.apiName.includes('locator(')
            ? event.apiName
            : undefined);

        if (!selector && event.params?.['expression']) {
          selector = event.params['selector'] ?? event.params['expression'];
        }

        const sourceFrame = event.stack?.[0];
        const actionName = event.apiName ?? event.title ?? event.method ?? 'unknown';

        actionsByCallId.set(callId, {
          callId,
          action: actionName,
          selector,
          sourceFile: sourceFrame?.file,
          line: sourceFrame?.line,
          column: sourceFrame?.column,
          durationMs: 0,
          timestamp: event.wallTime ?? event.startTime,
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

        const childActions = [...actionsByCallId.values()]
          .filter((item) => item.beforeEvent?.parentId === event.callId)
          .sort((left, right) => (right.beforeEvent?.startTime ?? 0) - (left.beforeEvent?.startTime ?? 0));
        const childAction = childActions.find((item) => /click|fill|press|check|select/i.test(item.action ?? '')) ?? childActions[childActions.length - 1];
        const childLogs = childAction?.callId ? logsByCallId.get(childAction.callId) ?? [] : [];
        const logs = [...(logsByCallId.get(event.callId) ?? []), ...childLogs];
        const inferred = inferActionDetailsFromError(errorMessage);

        // Enrich errorMessage if vague like "Expect failed"
        if ((!errorMessage || errorMessage.toLowerCase().includes('expect failed')) && logs.length > 0) {
          const timeoutOrWaiting = logs.find(
            (l) => l.includes('waiting for locator') || l.includes('resolved to') || l.includes('timeout')
          );
          if (timeoutOrWaiting) {
            errorMessage = errorMessage ? `${errorMessage}: ${timeoutOrWaiting}` : timeoutOrWaiting;
          }
        }

        // If selector was not in params, extract from logs
        let finalSelector = existing?.selector;
        if (!finalSelector) {
          for (const l of logs) {
            const m = l.match(/locator\('([^']+)'\)/i);
            if (m) {
              finalSelector = m[1];
              break;
            }
          }
        }

        const durationMs =
          existing?.beforeEvent?.wallTime && event.endTime
            ? event.endTime - existing.beforeEvent.wallTime
            : undefined;

        const completedAction: FailedAction = {
          callId: event.callId,
          action: inferred.action ?? childAction?.action ?? existing?.action ?? event.apiName ?? 'unknown',
          selector: finalSelector ?? inferred.selector ?? childAction?.selector,
          sourceFile: existing?.sourceFile,
          line: existing?.line,
          column: existing?.column,
          errorMessage,
          errorStack,
          durationMs,
          timestamp: existing?.timestamp ?? event.endTime,
          logs,
        };

        actionsByCallId.set(event.callId, completedAction);

        if (hasError) failedActionCandidates.push(completedAction);
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
          timestamp: event.wallTime ?? event.startTime,
        };
        actionsByCallId.set(event.callId, action);
        if (hasError) failedActionCandidates.push(action);
      }

      // Some trace producers emit a standalone error record rather than
      // attaching the error to an `after` or consolidated `action` event.
      // Preserve it as a candidate so diagnosis does not silently fall back
      // to an unrelated fixture action or an empty unknown action.
      if (event.type === 'error') {
        const callId = event.callId ?? `error@${failedActionCandidates.length}`;
        const existing = actionsByCallId.get(callId);
        const rawError = typeof event.error === 'string' ? event.error : event.error?.message ?? event.message;
        const standalone: FailedAction = {
          callId,
          action: existing?.action ?? event.apiName ?? event.title ?? 'unknown',
          selector: existing?.selector,
          sourceFile: existing?.sourceFile ?? event.stack?.[0]?.file,
          line: existing?.line ?? event.stack?.[0]?.line,
          column: existing?.column ?? event.stack?.[0]?.column,
          errorMessage: rawError,
          errorStack: typeof event.error === 'object' ? event.error?.stack : undefined,
          timestamp: existing?.timestamp ?? event.wallTime ?? event.startTime,
          logs: logsByCallId.get(callId) ?? [],
        };
        if (standalone.errorMessage) {
          actionsByCallId.set(callId, standalone);
          failedActionCandidates.push(standalone);
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
        timestamp: item.timestamp,
        logs: (item as any).logs,
      });
    }

    return {
      actions: validActions,
      failedAction: TraceParser.selectFailedAction(failedActionCandidates),
      consoleEvents,
      rawSnapshots,
      latestResolvedDom,
      mainFrameDom,
      latestChildFrameDom,
      domByCallId,
      domByFrameId,
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
            const rawTime =
              event.snapshot?._monotonicTime ??
              event.snapshot?.monotonicTime ??
              event.snapshot?.wallTime ??
              (event.snapshot?.startedDateTime ? new Date(event.snapshot.startedDateTime).getTime() : Date.now());

            networkEvents.push({
              url: req.url ?? 'unknown',
              method: req.method ?? 'GET',
              status: res.status ?? 0,
              statusText: res.statusText,
              timestamp: rawTime,
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

    const { failedAction, consoleEvents, domByCallId, latestResolvedDom, mainFrameDom, latestChildFrameDom } = TraceParser.parseTraceLines(traceLines);
    const networkEvents = TraceParser.parseNetworkLines(networkLines);

    const fallbackFailedAction: FailedAction = failedAction ?? {
      callId: 'unknown',
      action: 'unknown',
      errorMessage: 'No explicit action failure recorded in trace',
    };

    const snapshots: { before?: string; action?: string; after?: string } = {};

    // Recover DOM snapshot from modern differential stream or latest known frame DOM.
    // Prioritize call-specific DOM, then root/main frame DOM (unless selector specifically targeted an iframe), then child frame DOM, then fallback.
    const isTargetingIframe = Boolean(
      fallbackFailedAction.selector &&
      /frameLocator|iframe|frame\[/i.test(fallbackFailedAction.selector)
    );

    const targetDom: ResolvedElement | undefined =
      (fallbackFailedAction.callId && domByCallId?.get(fallbackFailedAction.callId)) ||
      (isTargetingIframe
        ? (latestChildFrameDom || latestResolvedDom)
        : (mainFrameDom || latestResolvedDom)) ||
      undefined;

    if (targetDom) {
      const htmlStr = SnapshotResolver.toHtml(targetDom);
      snapshots.before = htmlStr;
      snapshots.action = htmlStr;
    }

    const hasSnapshots = Boolean(
      (snapshots.action && snapshots.action.trim().length > 0) ||
      (snapshots.before && snapshots.before.trim().length > 0) ||
      (snapshots.after && snapshots.after.trim().length > 0)
    );

    const context: DiagnosticContext = {
      playwrightVersion: versionInfo.playwrightVersion ?? 'unknown',
      traceFormatVersion: versionInfo.traceFormatVersion,
      failedAction: fallbackFailedAction,
      snapshots,
      networkEvents,
      consoleEvents,
      evidenceCompleteness: {
        domAvailable: hasSnapshots,
        networkAvailable: networkEvents.length > 0,
        sourceAvailable: Boolean(fallbackFailedAction.sourceFile),
      },
    };

    if (targetDom) {
      (context as any).domRoot = targetDom;
    }

    return context;
  }
}

