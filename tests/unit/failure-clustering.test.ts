import { describe, expect, it } from 'vitest';
import { clusterFailures, fingerprintFailure, FailureObservation } from '../../src/intelligence/failure-clustering.js';

describe('failure fingerprints and clustering', () => {
  it('normalizes volatile paths, ids, and numbers into a stable fingerprint', () => {
    const first: FailureObservation = {
      id: 'a',
      category: 'LOCATOR_DRIFT',
      action: 'click',
      errorMessage: 'Timeout at C:\\agent\\run-123\\tests\\login.spec.ts:44 waiting 5000ms',
      networkStatuses: [200],
    };
    const second: FailureObservation = {
      id: 'b',
      category: 'LOCATOR_DRIFT',
      action: 'click',
      errorMessage: 'Timeout at D:\\worker\\run-999\\tests\\login.spec.ts:88 waiting 10000ms',
      networkStatuses: [200],
    };
    expect(fingerprintFailure(first).key).toBe(fingerprintFailure(second).key);
  });

  it('groups shared root causes while retaining affected repositories and tests', () => {
    const observations: FailureObservation[] = [
      { id: 'one', repository: 'shop', testTitle: 'login works', category: 'BACKEND_500', action: 'click', errorMessage: 'HTTP 500 from /api/login', networkStatuses: [500], timestamp: 10 },
      { id: 'two', repository: 'shop', testTitle: 'checkout works', category: 'BACKEND_500', action: 'click', errorMessage: 'HTTP 500 from /api/login', networkStatuses: [500], timestamp: 20 },
      { id: 'three', repository: 'billing', testTitle: 'payment works', category: 'ASSERTION_FAILURE', action: 'expect', errorMessage: 'Expected total 99 received 100', networkStatuses: [], timestamp: 30 },
    ];
    const clusters = clusterFailures(observations);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.severity).toBe('critical');
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[0]?.affectedRepositories).toEqual(['shop']);
    expect(clusters[0]?.affectedTests).toEqual(['checkout works', 'login works']);
    expect(clusters[0]?.evidenceConsistency).toBe(1);
  });
});
