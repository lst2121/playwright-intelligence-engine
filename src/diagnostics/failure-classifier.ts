import { DiagnosticContext, FailureCategory } from '../core/types/diagnostic-context.js';

export interface ClassificationResult {
  category: FailureCategory;
  confidence: number;
  reason: string;
  shouldAbstain: boolean;
  abstentionReason?: string;
  supportingEvidence: string[];
}

export class FailureClassifier {
  /**
   * Evaluates the DiagnosticContext to categorize the failure and enforce negative control abstentions.
   */
  public static classify(context: DiagnosticContext): ClassificationResult {
    const errorMsg = (context.failedAction.errorMessage ?? '').toLowerCase();
    const network = context.networkEvents;
    const action = context.failedAction.action.toLowerCase();
    const supportingEvidence: string[] = [];

    // Check 1: Backend 500 / 502 / 503 / 504 Server Errors (Negative Control: MUST ABSTAIN)
    const serverErrors = network.filter((req) => req.status >= 500 && req.status <= 599);
    if (serverErrors.length > 0) {
      const offending = serverErrors[serverErrors.length - 1]!;
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
      };
    }

    // Check 2: Auth Expiration / 401 Unauthorized / 403 Forbidden (Negative Control: MUST ABSTAIN)
    const authErrors = network.filter((req) => req.status === 401 || req.status === 403);
    if (authErrors.length > 0) {
      const offending = authErrors[authErrors.length - 1]!;
      supportingEvidence.push(
        `HTTP ${offending.status} on authenticated endpoint: ${offending.url}`
      );
      return {
        category: 'AUTH_EXPIRED',
        confidence: 0.98,
        reason: `Authentication expired or unauthorized access detected (HTTP ${offending.status})`,
        shouldAbstain: true,
        abstentionReason: `Negative Control Triggered: Authentication session expired or unauthorized (HTTP ${offending.status}). Locator healing must abstain.`,
        supportingEvidence,
      };
    }

    // Check 3: Assertion Failure (e.g. expect(received).toBe(expected))
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
      };
    }

    // Check 4: Ambiguous Match / Strict Mode Violation
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
        shouldAbstain: false, // Can be repaired by refining selector uniqueness
        supportingEvidence,
      };
    }

    // Check 5: Timing Race / Detached Node
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
      };
    }

    // Check 6: Locator Drift (Timeout waiting for locator / locator not found)
    if (
      errorMsg.includes('timeout') &&
      (errorMsg.includes('waiting for locator') ||
        errorMsg.includes('waiting for getby') ||
        errorMsg.includes('waiting for selector') ||
        Boolean(context.failedAction.selector))
    ) {
      supportingEvidence.push(
        `Locator timeout for selector '${context.failedAction.selector ?? 'unknown'}'`
      );
      return {
        category: 'LOCATOR_DRIFT',
        confidence: 0.93,
        reason: `Target locator '${context.failedAction.selector}' timed out waiting for matching DOM element`,
        shouldAbstain: false, // Legitimate candidate for candidate extraction & repair
        supportingEvidence,
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
    };
  }
}

