import { FailureCluster } from '../intelligence/failure-clustering.js';
import { TestStabilitySummary } from '../intelligence/suite-intelligence.js';

export interface QualityGateInput {
  clusters?: FailureCluster[] | undefined;
  stability?: TestStabilitySummary[] | undefined;
  blockedCount?: number | undefined;
  requiredOracleUnavailable?: number | undefined;
  verifiedRepairs?: number | undefined;
  failedRepairs?: number | undefined;
}

/**
 * Optional team policy. When omitted, evaluateQualityGate preserves the
 * original evidence-driven behavior used by local diagnosis and CI reports.
 */
export interface QualityGatePolicy {
  name?: string | undefined;
  maxFlakyTests?: number | undefined;
  maxHighSeverityClusters?: number | undefined;
  maxBlockedResults?: number | undefined;
  failOnAbstain?: boolean | undefined;
}

export interface QualityGateReport {
  status: 'PASS' | 'FAIL' | 'ABSTAIN' | 'BLOCKED';
  reasons: string[];
  criticalClusters: number;
  highSeverityClusters: number;
  flakyTests: number;
  blockedCount: number;
  requiredOracleUnavailable: number;
  verifiedRepairs: number;
  failedRepairs: number;
  policyViolations: string[];
}

export function evaluateQualityGate(input: QualityGateInput, policy: QualityGatePolicy = {}): QualityGateReport {
  const clusters = input.clusters ?? [];
  const stability = input.stability ?? [];
  const blockedCount = input.blockedCount ?? 0;
  const requiredOracleUnavailable = input.requiredOracleUnavailable ?? 0;
  const verifiedRepairs = input.verifiedRepairs ?? 0;
  const failedRepairs = input.failedRepairs ?? 0;
  const criticalClusters = clusters.filter((cluster) => cluster.severity === 'critical').length;
  const highSeverityClusters = clusters.filter((cluster) => cluster.severity === 'high').length;
  const flakyTests = stability.filter((summary) => summary.flaky).length;
  const reasons: string[] = [];

  if (criticalClusters > 0) reasons.push(`${criticalClusters} critical failure cluster(s) detected`);
  if (failedRepairs > 0) reasons.push(`${failedRepairs} repair verification(s) failed`);
  if (blockedCount > 0) reasons.push(`${blockedCount} test or repository result(s) are blocked`);
  if (requiredOracleUnavailable > 0) reasons.push(`${requiredOracleUnavailable} required business oracle result(s) are unavailable`);
  if (highSeverityClusters > 0) reasons.push(`${highSeverityClusters} high-severity failure cluster(s) detected`);
  if (flakyTests > 0) reasons.push(`${flakyTests} flaky test(s) detected`);

  const policyViolations: string[] = [];
  if (policy.maxFlakyTests !== undefined && flakyTests > policy.maxFlakyTests) {
    policyViolations.push(`Policy '${policy.name ?? 'default'}' allows at most ${policy.maxFlakyTests} flaky test(s), found ${flakyTests}`);
  }
  if (policy.maxHighSeverityClusters !== undefined && highSeverityClusters > policy.maxHighSeverityClusters) {
    policyViolations.push(`Policy '${policy.name ?? 'default'}' allows at most ${policy.maxHighSeverityClusters} high-severity cluster(s), found ${highSeverityClusters}`);
  }
  if (policy.maxBlockedResults !== undefined && blockedCount > policy.maxBlockedResults) {
    policyViolations.push(`Policy '${policy.name ?? 'default'}' allows at most ${policy.maxBlockedResults} blocked result(s), found ${blockedCount}`);
  }
  reasons.push(...policyViolations);

  const evidenceStatus: QualityGateReport['status'] = criticalClusters > 0 || failedRepairs > 0
    ? 'FAIL'
    : blockedCount > 0
      ? 'BLOCKED'
      : requiredOracleUnavailable > 0 || highSeverityClusters > 0 || flakyTests > 0
        ? 'ABSTAIN'
        : 'PASS';
  const status: QualityGateReport['status'] = policyViolations.length > 0 || (policy.failOnAbstain === true && evidenceStatus === 'ABSTAIN')
    ? 'FAIL'
    : evidenceStatus;
  if (policy.failOnAbstain === true && evidenceStatus === 'ABSTAIN' && policyViolations.length === 0) {
    reasons.push(`Policy '${policy.name ?? 'default'}' rejects ABSTAIN outcomes`);
  }

  return {
    status,
    reasons,
    criticalClusters,
    highSeverityClusters,
    flakyTests,
    blockedCount,
    requiredOracleUnavailable,
    verifiedRepairs,
    failedRepairs,
    policyViolations,
  };
}
