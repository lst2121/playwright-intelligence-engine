import { DiagnosticContext, FailureCategory, NetworkEvent } from '../core/types/diagnostic-context.js';

export interface CausalEvidenceNode {
  type: 'action' | 'network' | 'console' | 'dom';
  id: string;
  timestamp: number;
  description: string;
  isCausallyRelevant: boolean;
  relevanceReason: string;
  frameId?: string | undefined;
}

export type CausalEdgeRelation =
  | 'TEMPORALLY_PRECEDES'
  | 'SAME_FRAME'
  | 'INITIATED_BY'
  | 'SUPPORTS'
  | 'CONTRADICTS';

export interface CausalEvidenceEdge {
  fromNodeId: string;
  toNodeId: string;
  relation: CausalEdgeRelation;
  description?: string;
}

export interface CausalEvidenceGraph {
  nodes: CausalEvidenceNode[];
  edges: CausalEvidenceEdge[];
  actionNode?: CausalEvidenceNode | undefined;
  domNode?: CausalEvidenceNode | undefined;
  hasCausallyRelevantServerError: boolean;
  hasCausallyRelevantAuthError: boolean;
  offendingNetworkEvent?: NetworkEvent | undefined;
}

export interface ClassificationResult {
  category: FailureCategory;
  confidence: number;
  reason: string;
  shouldAbstain: boolean;
  abstentionReason?: string | undefined;
  supportingEvidence: string[];
  causalGraph?: CausalEvidenceGraph | undefined;
}

export class FailureClassifier {
  private static readonly TELEMETRY_PATTERNS = [
    /analytics/i,
    /telemetry/i,
    /beacon/i,
    /collect/i,
    /metrics/i,
    /google-analytics/i,
    /doubleclick/i,
    /sentry/i,
    /datadog/i,
    /favicon\.ico/i,
    /hotjar/i,
    /segment\.io/i,
  ];

  /**
   * Builds an explicit Causal Evidence Graph to correlate network events with failed actions,
   * distinguishing primary business requests from background analytics and telemetry noise.
   */
  public static buildCausalEvidenceGraph(context: DiagnosticContext): CausalEvidenceGraph {
    const nodes: CausalEvidenceNode[] = [];
    const edges: CausalEvidenceEdge[] = [];
    let hasCausallyRelevantServerError = false;
    let hasCausallyRelevantAuthError = false;
    let offendingNetworkEvent: NetworkEvent | undefined;

    // Action node
    const actionNodeId = context.failedAction.callId || 'failed-action-0';
    const actionTimestamp = context.failedAction.timestamp ?? Date.now();
    const actionNode: CausalEvidenceNode = {
      type: 'action',
      id: actionNodeId,
      timestamp: actionTimestamp,
      description: `Action: ${context.failedAction.action} (${context.failedAction.selector ?? 'no selector'})`,
      isCausallyRelevant: true,
      relevanceReason: 'Primary failed action under diagnosis',
      frameId: context.failedAction.frameId,
    };

    // DOM Snapshot node
    let domNode: CausalEvidenceNode | undefined;
    const hasDom = Boolean(
      context.snapshots?.action || context.snapshots?.before || context.snapshots?.after
    );
    if (hasDom) {
      domNode = {
        type: 'dom',
        id: 'dom-snapshot',
        timestamp: actionTimestamp,
        description: 'DOM Snapshot available at failure point',
        isCausallyRelevant: true,
        relevanceReason: 'Captures target page state at action time',
      };
      edges.push({
        fromNodeId: 'dom-snapshot',
        toNodeId: actionNodeId,
        relation: 'SUPPORTS',
        description: 'DOM snapshot provides ground truth for element availability',
      });
    }

    for (const net of context.networkEvents) {
      const isTelemetry = FailureClassifier.TELEMETRY_PATTERNS.some((p) => p.test(net.url));
      const isServerError = net.status >= 500 && net.status <= 599;
      const isAuthError = net.status === 401 || net.status === 403;
      const isClientApiError = (net.status === 400 || net.status === 404 || net.status === 429) && !isTelemetry;

      let isCausallyRelevant = false;
      let relevanceReason = '';

      if (isTelemetry) {
        isCausallyRelevant = false;
        relevanceReason = 'Ignored: background telemetry/analytics or non-critical resource';
      } else if (isServerError || isAuthError || isClientApiError) {
        // Business endpoint returning 5xx, 401/403, or client API failure 400/404/429
        isCausallyRelevant = true;
        relevanceReason = `Causally relevant: HTTP ${net.status} on application endpoint ${net.method} ${net.url}`;

        if (isServerError || isClientApiError) {
          hasCausallyRelevantServerError = true;
          offendingNetworkEvent = net;
        }
        if (isAuthError) {
          hasCausallyRelevantAuthError = true;
          offendingNetworkEvent = net;
        }
      } else {
        isCausallyRelevant = false;
        relevanceReason = `Normal response (HTTP ${net.status})`;
      }

      const netNodeId = net.requestId ?? net.url;
      nodes.push({
        type: 'network',
        id: netNodeId,
        timestamp: net.timestamp,
        description: `${net.method} ${net.url} -> ${net.status}`,
        isCausallyRelevant,
        relevanceReason,
        frameId: net.frameId,
      });

      // Construct causal edges
      if (typeof net.timestamp === 'number' && typeof context.failedAction.timestamp === 'number') {
        if (net.timestamp <= context.failedAction.timestamp) {
          edges.push({
            fromNodeId: netNodeId,
            toNodeId: actionNodeId,
            relation: 'TEMPORALLY_PRECEDES',
            description: `Network event completed ${context.failedAction.timestamp - net.timestamp}ms before action`,
          });
        } else if (net.timestamp > context.failedAction.timestamp && net.timestamp <= context.failedAction.timestamp + 2000) {
          edges.push({
            fromNodeId: actionNodeId,
            toNodeId: netNodeId,
            relation: 'INITIATED_BY',
            description: `Action initiated network request to ${net.url} (${net.timestamp - context.failedAction.timestamp}ms after action start)`,
          });
        }
      }

      if (
        context.failedAction.frameId &&
        net.frameId &&
        context.failedAction.frameId === net.frameId
      ) {
        edges.push({
          fromNodeId: netNodeId,
          toNodeId: actionNodeId,
          relation: 'SAME_FRAME',
          description: `Network request originated from the same frame (${net.frameId})`,
        });
      }

      if (isServerError || isAuthError) {
        edges.push({
          fromNodeId: netNodeId,
          toNodeId: actionNodeId,
          relation: 'SUPPORTS',
          description: `HTTP ${net.status} directly explains failure of action`,
        });
        edges.push({
          fromNodeId: netNodeId,
          toNodeId: 'hypothesis:locator-drift',
          relation: 'CONTRADICTS',
          description: `HTTP ${net.status} on application endpoint contradicts UI locator drift as root cause`,
        });
      }
    }

    return {
      nodes,
      edges,
      actionNode,
      domNode,
      hasCausallyRelevantServerError,
      hasCausallyRelevantAuthError,
      offendingNetworkEvent,
    };
  }

  /**
   * Evaluates the DiagnosticContext using causal evidence correlation to categorize
   * the failure and strictly enforce negative control abstentions.
   */
  public static classify(context: DiagnosticContext): ClassificationResult {
    const errorMsg = (context.failedAction.errorMessage ?? '').toLowerCase();
    const action = (context.failedAction.action ?? '').toLowerCase();
    const actionLogs = (context.failedAction.logs ?? []).join('\n').toLowerCase();
    // Playwright may embed the browser launch command in an error. That command
    // contains tokens such as "lens-overlay" and "popup-blocking" which can
    // look like actionability evidence. Remove that operational noise before
    // applying root-cause patterns; retain the actual Call log after shutdown.
    const diagnosticText = `${errorMsg}\n${actionLogs}`.replace(
      /<launching>[\s\S]*?<gracefully close start>/gi,
      '',
    );
    const supportingEvidence: string[] = [];

    // An assertion can legitimately observe an authentication response (for
    // example, an invalid-login test expecting an error banner). Explicit
    // assertion mismatch evidence is stronger than the surrounding HTTP
    // status and must be classified before auth/backend heuristics.
    const explicitAssertionMismatch =
      /unexpected value|(?:^|\s)(?:expected|received):|expect\(received\)|to have (?:text|value|attribute|class|count)/i.test(diagnosticText) &&
      (action.includes('expect') || action.includes('assert') || !context.failedAction.selector);
    if (explicitAssertionMismatch) {
      supportingEvidence.push(`Assertion mismatch detected: ${context.failedAction.errorMessage}`);
      return {
        category: 'ASSERTION_FAILURE',
        confidence: 0.95,
        reason: 'Test assertion failed against verified element state or business logic outcome',
        shouldAbstain: true,
        abstentionReason: 'Engine strictly prohibits modifying test assertions to force a passing test run.',
        supportingEvidence,
        causalGraph: FailureClassifier.buildCausalEvidenceGraph(context),
      };
    }

    // Step 1: Build causal evidence graph
    const causalGraph = FailureClassifier.buildCausalEvidenceGraph(context);

    // Step 2: Check for Network Offline / DNS resolution failures
    const hasNetworkOffline = context.networkEvents.some(
      (req) => /err_internet_disconnected|enotfound|err_name_not_resolved|dns_probe_finished_nxdomain|eai_again|eai_fail/i.test(req.errorText ?? '')
    );
    if (
      hasNetworkOffline ||
      /err_internet_disconnected|enotfound|err_name_not_resolved|dns_probe_finished_nxdomain|eai_again|eai_fail/i.test(errorMsg)
    ) {
      supportingEvidence.push('Network transport offline or DNS lookup failure detected');
      return {
        category: 'NETWORK_OFFLINE',
        confidence: 0.99,
        reason: 'Network connectivity offline or DNS resolution failed',
        shouldAbstain: true,
        abstentionReason: 'Negative Control Triggered: Network offline. Test failure is caused by connectivity loss.',
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 3: Environment/service availability failures. These are distinct
    // from an offline host: the machine has a network stack, but the target
    // application/service is unavailable or the connection was interrupted.
    const hasEnvironmentFailure =
      /(?:net::)?err_connection_refused|econnrefused|connection refused|(?:net::)?err_connection_reset|econnreset|(?:net::)?err_connection_closed|ehostunreach|connection reset by peer/i.test(diagnosticText) ||
      context.networkEvents.some((request) => /(?:err_connection_refused|econnrefused|err_connection_reset|econnreset|ehostunreach)/i.test(request.errorText ?? ''));
    if (hasEnvironmentFailure) {
      supportingEvidence.push('Target application or dependent service refused or reset the connection');
      return {
        category: 'ENVIRONMENT_FAILURE',
        confidence: 0.99,
        reason: 'The target application or a required service was unavailable during the test',
        shouldAbstain: true,
        abstentionReason: 'Environment failure detected. UI locator repair cannot restore an unavailable service.',
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 4: Causal Server Errors (Negative Control: MUST ABSTAIN)
    // Only triggers on causally relevant application endpoints, ignoring background analytics 500s
    if (causalGraph.hasCausallyRelevantServerError && causalGraph.offendingNetworkEvent) {
      const offending = causalGraph.offendingNetworkEvent;
      supportingEvidence.push(
        `HTTP ${offending.status} (${offending.statusText ?? 'Server Error'}) on ${offending.method} ${offending.url}`
      );

      return {
        category: 'BACKEND_500',
        confidence: 0.99,
        reason: `Backend server returned HTTP ${offending.status} during or immediately preceding test failure`,
        shouldAbstain: true,
        abstentionReason: `Negative Control Triggered: Test failed due to backend server failure (${offending.status} on ${offending.url}). Modifying UI locators is prohibited.`,
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 5: Causal Auth Expiration / 401 / 403 (Negative Control: MUST ABSTAIN)
    if (causalGraph.hasCausallyRelevantAuthError && causalGraph.offendingNetworkEvent) {
      const offending = causalGraph.offendingNetworkEvent;
      supportingEvidence.push(`HTTP ${offending.status} on authenticated application endpoint: ${offending.url}`);
      return {
        category: 'AUTH_EXPIRED',
        confidence: 0.98,
        reason: `Authentication expired or unauthorized access detected (HTTP ${offending.status})`,
        shouldAbstain: true,
        abstentionReason: `Negative Control Triggered: Authentication session expired or unauthorized (HTTP ${offending.status}). Locator healing must abstain.`,
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 6: Assertion Failure (e.g. expect(received).toBe(expected)) (Negative Control: MUST ABSTAIN)
    // Negative control: engine strictly prohibits modifying test assertions to force a passing test run.
    const isValueAssertionAction =
      /tohavetext|tocontaintext|tohavevalue|tohaveattribute|tohaveclass|tohavecount|tohavetitle|tohaveurl|tobechecked|tobeenabled|tobedisabled/i.test(action) ||
      /tohavetext|tocontaintext|tohavevalue|tohaveattribute|tohaveclass|tohavecount/i.test(errorMsg);

    const hasUnexpectedValueInLog =
      (context.failedAction.logs ?? []).some((l) => /unexpected value/i.test(l)) ||
      /unexpected value/i.test(errorMsg);

    const hasValueMismatch =
      errorMsg.includes('received:') ||
      errorMsg.includes('expected:') ||
      hasUnexpectedValueInLog;

    const isAssertionMethod =
      action === 'expect' ||
      action.startsWith('expect ') ||
      action.includes('expect.') ||
      action.includes('assert') ||
      isValueAssertionAction;

    const hasAssertionErrorPattern =
      errorMsg.includes('expect(received)') ||
      errorMsg.includes('to have attribute') ||
      errorMsg.includes('to have text') ||
      errorMsg.includes('to have value') ||
      errorMsg.includes('to have class') ||
      errorMsg.includes('to have count') ||
      (errorMsg.includes('to be visible') && !context.failedAction.selector);

    if (
      hasValueMismatch ||
      isValueAssertionAction ||
      hasAssertionErrorPattern ||
      (isAssertionMethod && !context.failedAction.selector) ||
      (action.includes('expect') && (errorMsg.includes('expect(') || errorMsg.includes('received:')))
    ) {
      supportingEvidence.push(`Assertion failed: ${context.failedAction.errorMessage}`);
      return {
        category: 'ASSERTION_FAILURE',
        confidence: 0.95,
        reason: 'Test assertion failed against verified element state or business logic outcome',
        shouldAbstain: true,
        abstentionReason: 'Engine strictly prohibits modifying test assertions to force a passing test run.',
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 7: Actionability and browser-context failures. These categories
    // are intentionally abstaining: they explain the failure without claiming
    // that changing the locator would make the application correct.
    const isAssertionAction = action.includes('expect') || action.includes('assert');
    if (!isAssertionAction && /intercepts pointer events|another element would receive|element is obscured|element is covered|overlay.*blocking|blocking.*overlay|subtree intercepts pointer events/i.test(diagnosticText)) {
      supportingEvidence.push('A different element or overlay intercepted the intended pointer action');
      return {
        category: 'OBSTRUCTED_ELEMENT',
        confidence: 0.96,
        reason: 'The target action was obstructed by another element or overlay',
        shouldAbstain: true,
        abstentionReason: 'Actionability failure detected. Changing the locator could mask an obstructed application state.',
        supportingEvidence,
        causalGraph,
      };
    }

    if (!isAssertionAction && /element is not enabled|element is disabled|locator is disabled|button is disabled|aria-disabled["'= ]+true/i.test(diagnosticText)) {
      supportingEvidence.push('The target element was present but disabled by the application');
      return {
        category: 'DISABLED_ELEMENT',
        confidence: 0.97,
        reason: 'The target element was disabled and could not perform the requested action',
        shouldAbstain: true,
        abstentionReason: 'Disabled-control failure detected. Locator repair cannot satisfy the application prerequisite.',
        supportingEvidence,
        causalGraph,
      };
    }

    if (!isAssertionAction && /frame.*(?:not found|detached|unavailable)|iframe.*(?:not found|detached|unavailable)|different frame|content frame|contentFrame|frame locator|frameLocator/i.test(diagnosticText)) {
      supportingEvidence.push('The failed action was associated with a missing, detached, or mismatched frame context');
      return {
        category: 'FRAME_OR_IFRAME',
        confidence: 0.94,
        reason: 'The target element was not available in the expected frame or iframe context',
        shouldAbstain: true,
        abstentionReason: 'Frame-context failure detected. A locator-only repair is unsafe without confirming the frame boundary.',
        supportingEvidence,
        causalGraph,
      };
    }

    if (!isAssertionAction && /hydration|hydrated|networkidle|waiting for load state|delayed content|element is not stable/i.test(diagnosticText)) {
      supportingEvidence.push('Failure evidence indicates delayed application readiness or hydration');
      return {
        category: 'HYDRATION_OR_TIMING',
        confidence: 0.86,
        reason: 'The target page or component was not ready when the action executed',
        shouldAbstain: true,
        abstentionReason: 'Readiness/timing failure detected. Locator modification will not reliably solve delayed application state.',
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 8: Ambiguous Match / Strict Mode Violation
    if (
      errorMsg.includes('strict mode violation') ||
      /resolved to \d+ elements/i.test(errorMsg)
    ) {
      const countMatch = errorMsg.match(/resolved to (\d+) elements/i);
      const matchCount = countMatch && countMatch[1] ? parseInt(countMatch[1], 10) : 0;
      const rawSel = (context.failedAction.selector ?? '').trim().toLowerCase();
      const isAnonymousTag = /^(div|span|p|tr|td|li|ul|ol|table|section|article|header|footer|main|nav)(\.[a-z0-9_-]+)*$/i.test(rawSel);
      const isHighAmbiguity = matchCount >= 20 || (isAnonymousTag && matchCount >= 2);

      // Unresolvable ambiguous match: anonymous tag or >= 20 identical matches without semantic anchors
      if (isHighAmbiguity) {
        supportingEvidence.push(
          `Unresolvable ambiguous match: locator '${context.failedAction.selector}' resolved to ${matchCount} anonymous elements without semantic anchors`
        );
        return {
          category: 'INCOMPLETE_EVIDENCE',
          confidence: 0.95,
          reason: `Locator '${context.failedAction.selector}' resolved to ${matchCount} anonymous elements without semantic anchors`,
          shouldAbstain: true,
          abstentionReason:
            'Insufficient semantic evidence; engine must safely abstain rather than generate arbitrary nth(x) selectors.',
          supportingEvidence,
          causalGraph,
        };
      }

      supportingEvidence.push(`Strict mode violation detected: ${context.failedAction.errorMessage}`);
      return {
        category: 'AMBIGUOUS_MATCH',
        confidence: 0.92,
        reason: 'Locator resolved to multiple matching elements in the DOM (strict mode violation)',
        shouldAbstain: false, // Refinable
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 9: Timing Race / Detached Node
    if (
      errorMsg.includes('element is not attached to the dom') ||
      errorMsg.includes('navigation interrupted') ||
      errorMsg.includes('execution context was destroyed') ||
      errorMsg.includes('target closed') ||
      errorMsg.includes('browser has been closed')
    ) {
      supportingEvidence.push(`DOM lifecycle race: ${context.failedAction.errorMessage}`);
      return {
        category: 'TIMING_RACE',
        confidence: 0.88,
        reason: 'Element detached or page navigated mid-action (asynchronous timing race condition)',
        shouldAbstain: true,
        abstentionReason: 'Timing race condition detected. Locator modification will not solve DOM detachment.',
        supportingEvidence,
        causalGraph,
      };
    }

    // A post-action assertion timeout is not sufficient evidence of locator
    // drift. The application may still be hydrating or waiting for a state
    // transition, and rewriting the assertion target could mask that defect.
    // Keep explicit action timeouts repairable below, but fail closed here.
    const isAssertionTimeout =
      isAssertionMethod &&
      /timeout|timed out|element\(s\) not found|waiting for/i.test(diagnosticText) &&
      Boolean(context.failedAction.selector);
    if (isAssertionTimeout) {
      supportingEvidence.push('Assertion timed out while waiting for a post-action UI state; trace does not prove locator drift');
      return {
        category: 'HYDRATION_OR_TIMING',
        confidence: 0.72,
        reason: 'Post-action assertion timed out before the expected UI state became observable',
        shouldAbstain: true,
        abstentionReason: 'Assertion readiness is unresolved. Locator repair is prohibited without evidence that the target identity changed.',
        supportingEvidence,
        causalGraph,
      };
    }

    // Step 10: Locator Drift (Timeout waiting for locator / locator not found)
    if (
      (errorMsg.includes('timeout') || errorMsg.includes('element(s) not found') || errorMsg.includes('not found')) &&
      (errorMsg.includes('waiting for locator') ||
        errorMsg.includes('waiting for getby') ||
        errorMsg.includes('waiting for selector') ||
        errorMsg.includes('tobevisible') ||
        errorMsg.includes('to be visible') ||
        errorMsg.includes('expect failed') ||
        Boolean(context.failedAction.selector))
    ) {
      // Check if DOM evidence is missing when trying to diagnose locator drift
      // CRITICAL FIX (R-015): Check all snapshot channels before concluding DOM evidence is missing
      const hasSnapshots = Boolean(
        (context.snapshots?.action && context.snapshots.action.trim().length > 0) ||
        (context.snapshots?.before && context.snapshots.before.trim().length > 0) ||
        (context.snapshots?.after && context.snapshots.after.trim().length > 0) ||
        context.evidenceCompleteness.domAvailable
      );
      if (context.evidenceCompleteness.domAvailable === false && !hasSnapshots) {
        return {
          category: 'INCOMPLETE_EVIDENCE',
          confidence: 0.95,
          reason: `Target locator '${context.failedAction.selector}' timed out, but DOM snapshots are missing or incomplete in trace`,
          shouldAbstain: true,
          abstentionReason: 'Insufficient DOM evidence to diagnose or safely extract replacement candidates.',
          supportingEvidence: ['DOM snapshot missing from trace archive'],
          causalGraph,
        };
      }

      supportingEvidence.push(`Locator timeout for selector '${context.failedAction.selector ?? 'unknown'}'`);
      return {
        category: 'LOCATOR_DRIFT',
        confidence: 0.93,
        reason: `Target locator '${context.failedAction.selector}' timed out waiting for matching DOM element`,
        shouldAbstain: false, // Legitimate candidate for candidate extraction & repair
        supportingEvidence,
        causalGraph,
      };
    }

    // Default Unknown
    return {
      category: 'UNKNOWN_ERROR',
      confidence: 0.5,
      reason: `Unclassified failure: ${context.failedAction.errorMessage || 'No error message available'}`,
      shouldAbstain: true,
      abstentionReason: 'Insufficient diagnostic evidence to safely classify failure root cause.',
      supportingEvidence,
      causalGraph,
    };
  }
}
