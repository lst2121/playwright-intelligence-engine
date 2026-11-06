import { FailureCategory } from '../core/types/diagnostic-context.js';

/**
 * Converts historical, external, and compatibility labels into the
 * canonical categories used by current diagnostics and reporting.
 * Unknown labels are preserved in normalized uppercase form so external
 * evaluation data remains auditable instead of being silently discarded.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  AUTH_SESSION_EXPIRED: 'AUTH_EXPIRED',
  AUTHENTICATION_FAILURE: 'AUTH_EXPIRED',
  AUTHENTICATION_EXPIRED: 'AUTH_EXPIRED',
  AUTHENTICATION_ERROR: 'AUTH_EXPIRED',
  ASSERTION_FAILED: 'ASSERTION_FAILURE',
  ASSERTION_MISMATCH: 'ASSERTION_FAILURE',
  ASSERTION_DISCREPANCY: 'ASSERTION_FAILURE',
  BACKEND_ERROR: 'BACKEND_500',
  BACKEND_SERVICE_OUTAGE: 'BACKEND_500',
  BACKEND_OUTAGE: 'BACKEND_500',
  AMBIGUOUS_LOCATOR: 'AMBIGUOUS_MATCH',
  AMBIGUOUS_CONTROL: 'AMBIGUOUS_MATCH',
  DISABLED_CONTROL: 'DISABLED_ELEMENT',
  DYNAMIC_CONTENT_SLOW: 'HYDRATION_OR_TIMING',
  HYDRATION_DELAY: 'HYDRATION_OR_TIMING',
  NETWORK_ERROR: 'NETWORK_OFFLINE',
  UNRELATED_NETWORK_ERROR: 'NETWORK_OFFLINE',
  TIMEOUT: 'TIMING_RACE',
  UNKNOWN: 'UNKNOWN_ERROR',
};

export function normalizeFailureCategory(category: string | undefined): string {
  const normalized = (category ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'UNKNOWN_ERROR';
  return CATEGORY_ALIASES[normalized] ?? normalized;
}

export function normalizeTypedFailureCategory(category: FailureCategory): FailureCategory {
  return normalizeFailureCategory(category) as FailureCategory;
}

