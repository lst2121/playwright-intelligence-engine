import { describe, expect, it } from 'vitest';
import { normalizeFailureCategory } from '../../src/diagnostics/failure-category.js';
import { fingerprintFailure } from '../../src/intelligence/failure-clustering.js';

describe('canonical failure category normalization', () => {
  it('maps compatibility aliases to canonical categories', () => {
    expect(normalizeFailureCategory('AUTH_SESSION_EXPIRED')).toBe('AUTH_EXPIRED');
    expect(normalizeFailureCategory('assertion-mismatch')).toBe('ASSERTION_FAILURE');
    expect(normalizeFailureCategory('dynamic content slow')).toBe('HYDRATION_OR_TIMING');
  });

  it('preserves unknown external labels in normalized form', () => {
    expect(normalizeFailureCategory('vendor-specific failure')).toBe('VENDOR_SPECIFIC_FAILURE');
    expect(normalizeFailureCategory(undefined)).toBe('UNKNOWN_ERROR');
  });

  it('clusters equivalent aliases under one canonical fingerprint category', () => {
    const fingerprint = fingerprintFailure({
      id: 'alias-1',
      category: 'ASSERTION_FAILED',
      action: 'expect',
      errorMessage: 'expected value',
    });
    expect(fingerprint.category).toBe('ASSERTION_FAILURE');
  });
});
