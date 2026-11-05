import { DiagnosticContext, FailureCategory, NetworkEvent } from '../core/types/diagnostic-context.js';

export interface CausalEvidenceNode {
  type: 'action' | 'network' | 'console' | 'dom';
  id: string;
  timestamp: number;
  description: string;
  isCausallyRelevant: boolean;
  relevanceReason: string;
}

export interface CausalEvidenceGraph {
  nodes: CausalEvidenceNode[];
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
    let hasCausallyRelevantServerError = false;
    let hasCausallyRelevantAuthError = false;
    let offendingNetworkEvent: NetworkEvent | undefined;

    for (const net of context.networkEvents) {
      const isTelemetry = FailureClassifier.TELEMETRY_PATTERNS.some((p) => p.test(net.url));
      const isServerError = net.status >= 500 && net.status <= 599;
      const isAuthError = net.status === 401 || net.status === 403;

      let isCausallyRelevant = false;
      let relevanceReason = '';

      if (isTelemetry) {
        isCausallyRelevant = false;
        relevanceReason = 'Ignored: background telemetry/analytics or non-critical resource';
      } else if (isServerError || isAuthError) {
        // Business endpoint returning 5xx or 401/403
        isCausallyRelevant = true;
        relevanceReason = `Causally relevant: HTTP ${net.status} on application endpoint ${net.method} ${net.url}`;

        if (isServerError) {
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

      nodes.push({
        type: 'network',
        id: net.requestId ?? net.url,
        timestamp: net.timestamp,
        description: `${net.method} ${net.url} -> ${net.status}`,
        isCausallyRelevant,
        relevanceReason,
      });
    }

    return {
      nodes,
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
    const action = context.failedAction.action.toLowerCase();
    const supportingEvidence: string[] = [];

    // Step 1: Build causal evidence graph
    const causalGraph = FailureClassifier.buildCausalEvidenceGraph(context);

    // Step 2: Check for Network Offline / DNS resolution failures
    const hasNetworkOffline = context.networkEvents.some(
      (req) => req.errorText?.includes('net::ERR_INTERNET_DISCONNECTED') || req.errorText?.includes('ENOTFOUND')
    );
    if (hasNetworkOffline || errorMsg.includes('err_internet_disconnected') || errorMsg.includes('enotfound')) {
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

    // Step 3: Causal Server Errors (Negative Control: MUST ABSTAIN)
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

    // Step 4: Causal Auth Expiration / 401 / 403 (Negative Control: MUST ABSTAIN)
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

    // Step 5: Assertion Failure (e.g. expect(received).toBe(expected)) (Negative Control: MUST ABSTAIN)
    if (
      action.includes('expect') ||
      errorMsg.includes('expect(') ||
      errorMsg.includes('received:') ||
      errorMsg.includes('to have text') ||
      errorMsg.includes('to be visible')
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

    // Step 6: Ambiguous Match / Strict Mode Violation
    if (
      errorMsg.includes('strict mode violation') ||
      errorMsg.includes('resolved to') ||
      errorMsg.includes('elements')
    ) {
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

    // Step 7: Timing Race / Detached Node
    if (
      errorMsg.includes('element is not attached to the dom') ||
      errorMsg.includes('navigation interrupted') ||
      errorMsg.includes('execution context was destroyed')
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

    // Step 8: Locator Drift (Timeout waiting for locator / locator not found)
    if (
      errorMsg.includes('timeout') &&
      (errorMsg.includes('waiting for locator') ||
        errorMsg.includes('waiting for getby') ||
        errorMsg.includes('waiting for selector') ||
        Boolean(context.failedAction.selector))
    ) {
      // Check if DOM evidence is missing when trying to diagnose locator drift
      // CRITICAL FIX (R-015): When DOM evidence is missing, MUST ABSTAIN with INCOMPLETE_EVIDENCE
      const hasSnapshots = Boolean(context.snapshots && Object.keys(context.snapshots).length > 0);
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
