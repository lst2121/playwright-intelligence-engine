import type { CiEvidenceReport } from '../integrations/playwright-report-adapter.js';
import { evaluateQualityGate, QualityGatePolicy, QualityGateReport } from '../integrations/quality-gate.js';
import { FailureCluster } from '../intelligence/failure-clustering.js';
import { TestStabilitySummary } from '../intelligence/suite-intelligence.js';

export interface TeamEvidenceRun {
  runId: string;
  repository: string;
  branch?: string | undefined;
  commit?: string | undefined;
  timestamp?: number | undefined;
  evidence: CiEvidenceReport;
}

export interface RepositoryDashboardSummary {
  repository: string;
  runs: number;
  testRuns: number;
  failures: number;
  flakyTests: number;
  failureClusters: number;
  passRate: number;
  latestStatus: QualityGateReport['status'];
  latestRunId: string;
}

export interface DashboardFlakyTest {
  key: string;
  repository?: string | undefined;
  testId: string;
  title?: string | undefined;
  sourceFile?: string | undefined;
  flakeRate: number;
  runs: number;
  failures: number;
}

export interface TeamDashboardReport {
  generatedAt: string;
  policy: QualityGatePolicy;
  runCount: number;
  repositoryCount: number;
  repositories: RepositoryDashboardSummary[];
  totals: {
    testRuns: number;
    failures: number;
    flakyTests: number;
    failureClusters: number;
  };
  failureClusters: FailureCluster[];
  flakyTests: DashboardFlakyTest[];
  qualityGate: QualityGateReport;
  markdown: string;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function severityRank(severity: FailureCluster['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 }[severity];
}

function aggregateClusters(runs: TeamEvidenceRun[]): FailureCluster[] {
  const grouped = new Map<string, FailureCluster>();
  for (const run of runs) {
    for (const cluster of run.evidence.clusters) {
      const existing = grouped.get(cluster.clusterId);
      if (!existing) {
        grouped.set(cluster.clusterId, {
          ...cluster,
          affectedRepositories: [...new Set([run.repository, ...cluster.affectedRepositories])].sort(),
          affectedTests: [...cluster.affectedTests].sort(),
          observationIds: cluster.observationIds.map((id) => `${run.runId}:${id}`).sort(),
        });
        continue;
      }
      existing.count += cluster.count;
      existing.observationIds.push(...cluster.observationIds.map((id) => `${run.runId}:${id}`));
      existing.observationIds = [...new Set(existing.observationIds)].sort();
      existing.affectedRepositories = [...new Set([...existing.affectedRepositories, run.repository, ...cluster.affectedRepositories])].sort();
      existing.affectedTests = [...new Set([...existing.affectedTests, ...cluster.affectedTests])].sort();
      existing.severity = severityRank(cluster.severity) > severityRank(existing.severity) ? cluster.severity : existing.severity;
      existing.evidenceConsistency = round((existing.evidenceConsistency + cluster.evidenceConsistency) / 2);
      if (cluster.firstSeen !== undefined) existing.firstSeen = existing.firstSeen === undefined ? cluster.firstSeen : Math.min(existing.firstSeen, cluster.firstSeen);
      if (cluster.lastSeen !== undefined) existing.lastSeen = existing.lastSeen === undefined ? cluster.lastSeen : Math.max(existing.lastSeen, cluster.lastSeen);
    }
  }
  return [...grouped.values()].sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.count - left.count || left.clusterId.localeCompare(right.clusterId));
}

function aggregateStability(runs: TeamEvidenceRun[]): TestStabilitySummary[] {
  const groups = new Map<string, TestStabilitySummary[]>();
  for (const run of runs) {
    for (const summary of run.evidence.stability) {
      const key = `${run.repository}::${summary.testId}`;
      const group = groups.get(key);
      if (group) group.push({ ...summary, repository: run.repository });
      else groups.set(key, [{ ...summary, repository: run.repository }]);
    }
  }
  return [...groups.entries()].map(([key, summaries]) => {
    const first = summaries[0]!;
    const totalRuns = summaries.reduce((sum, item) => sum + item.runs, 0);
    const passes = summaries.reduce((sum, item) => sum + item.passes, 0);
    const failures = summaries.reduce((sum, item) => sum + item.failures, 0);
    const skips = summaries.reduce((sum, item) => sum + item.skips, 0);
    const blocked = summaries.reduce((sum, item) => sum + item.blocked, 0);
    return {
      ...first,
      testId: first.testId,
      repository: first.repository,
      runs: totalRuns,
      passes,
      failures,
      skips,
      blocked,
      passRate: totalRuns > 0 ? round(passes / totalRuns) : 0,
      flakeRate: totalRuns > 0 ? round(Math.min(passes, failures) / totalRuns) : 0,
      flaky: passes > 0 && failures > 0,
      failureClusters: [...new Set(summaries.flatMap((item) => item.failureClusters))].sort(),
      lastStatus: summaries[summaries.length - 1]!.lastStatus,
      ...(key ? {} : {}),
    };
  });
}

function renderMarkdown(report: Omit<TeamDashboardReport, 'markdown'>): string {
  const lines = [
    `# PIE Team Quality Dashboard — ${report.qualityGate.status}`,
    '',
    `Policy: **${report.policy.name ?? 'default'}**`,
    `Runs: **${report.runCount}** | Repositories: **${report.repositoryCount}** | Test executions: **${report.totals.testRuns}**`,
    `Failures: **${report.totals.failures}** | Flaky tests: **${report.totals.flakyTests}** | Failure clusters: **${report.totals.failureClusters}**`,
  ];
  if (report.qualityGate.reasons.length > 0) lines.push('', '## Gate reasons', ...report.qualityGate.reasons.map((reason) => `- ${reason}`));
  lines.push('', '## Repositories', '| Repository | Runs | Tests | Failures | Flaky | Gate |', '|---|---:|---:|---:|---:|---|');
  for (const repository of report.repositories) lines.push(`| ${repository.repository} | ${repository.runs} | ${repository.testRuns} | ${repository.failures} | ${repository.flakyTests} | ${repository.latestStatus} |`);
  if (report.failureClusters.length > 0) {
    lines.push('', '## Top failure clusters', '| Severity | Count | Category | Repositories |', '|---|---:|---|---|');
    for (const cluster of report.failureClusters.slice(0, 20)) lines.push(`| ${cluster.severity} | ${cluster.count} | ${cluster.fingerprint.category} | ${cluster.affectedRepositories.join(', ') || 'unknown'} |`);
  }
  return lines.join('\n');
}

export function buildTeamDashboard(runs: TeamEvidenceRun[], policy: QualityGatePolicy = {}): TeamDashboardReport {
  const clusters = aggregateClusters(runs);
  const stability = aggregateStability(runs);
  const blockedCount = runs.reduce((sum, run) => sum + run.evidence.qualityGate.blockedCount, 0);
  const requiredOracleUnavailable = runs.reduce((sum, run) => sum + run.evidence.qualityGate.requiredOracleUnavailable, 0);
  const verifiedRepairs = runs.reduce((sum, run) => sum + run.evidence.qualityGate.verifiedRepairs, 0);
  const failedRepairs = runs.reduce((sum, run) => sum + run.evidence.qualityGate.failedRepairs, 0);
  const qualityGate = evaluateQualityGate({ clusters, stability, blockedCount, requiredOracleUnavailable, verifiedRepairs, failedRepairs }, policy);
  const repositoryNames = [...new Set(runs.map((run) => run.repository))].sort();
  const repositories = repositoryNames.map((repository) => {
    const repositoryRuns = runs.filter((run) => run.repository === repository);
    const testRuns = repositoryRuns.reduce((sum, run) => sum + run.evidence.runs.length, 0);
    const failures = repositoryRuns.reduce((sum, run) => sum + run.evidence.failures.length, 0);
    const flakyTests = new Set(repositoryRuns.flatMap((run) => run.evidence.stability.filter((test) => test.flaky).map((test) => test.testId))).size;
    const latest = [...repositoryRuns].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0]!;
    return {
      repository,
      runs: repositoryRuns.length,
      testRuns,
      failures,
      flakyTests,
      failureClusters: new Set(repositoryRuns.flatMap((run) => run.evidence.clusters.map((cluster) => cluster.clusterId))).size,
      passRate: testRuns > 0 ? round(repositoryRuns.reduce((sum, run) => sum + run.evidence.runs.filter((test) => test.status === 'PASS').length, 0) / testRuns) : 0,
      latestStatus: latest.evidence.qualityGate.status,
      latestRunId: latest.runId,
    } satisfies RepositoryDashboardSummary;
  });
  const flakyTests = [...new Map(stability.filter((test) => test.flaky).map((test) => {
    const key = `${test.repository ?? 'unknown'}::${test.testId}`;
    return [key, { key, repository: test.repository, testId: test.testId, title: test.title, sourceFile: test.sourceFile, flakeRate: test.flakeRate, runs: test.runs, failures: test.failures } satisfies DashboardFlakyTest];
  })).values()].sort((left, right) => right.flakeRate - left.flakeRate || left.key.localeCompare(right.key));
  const reportBase = {
    generatedAt: new Date().toISOString(),
    policy,
    runCount: runs.length,
    repositoryCount: repositoryNames.length,
    repositories,
    totals: { testRuns: runs.reduce((sum, run) => sum + run.evidence.runs.length, 0), failures: runs.reduce((sum, run) => sum + run.evidence.failures.length, 0), flakyTests: flakyTests.length, failureClusters: clusters.length },
    failureClusters: clusters,
    flakyTests,
    qualityGate,
  };
  return { ...reportBase, markdown: renderMarkdown(reportBase) };
}
