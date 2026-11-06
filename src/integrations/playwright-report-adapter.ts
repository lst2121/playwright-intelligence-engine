import { clusterFailures, FailureObservation } from '../intelligence/failure-clustering.js';
import { analyzeTestStability, TestRunObservation } from '../intelligence/suite-intelligence.js';
import { evaluateQualityGate, QualityGateReport } from './quality-gate.js';

export interface PlaywrightReportAdapterOptions {
  repository?: string | undefined;
  runId?: string | undefined;
  timestamp?: number | undefined;
}

export interface ParsedPlaywrightReport {
  runs: TestRunObservation[];
  failures: FailureObservation[];
}

export interface CiEvidenceReport extends ParsedPlaywrightReport {
  clusters: ReturnType<typeof clusterFailures>;
  stability: ReturnType<typeof analyzeTestStability>;
  qualityGate: QualityGateReport;
  markdown: string;
  annotations: string[];
}

interface PlaywrightResult {
  status?: string | undefined;
  duration?: number | undefined;
  retry?: number | undefined;
  error?: { message?: string; stack?: string } | undefined;
  errors?: Array<{ message?: string; stack?: string }> | undefined;
}

interface PlaywrightTest {
  title?: string | undefined;
  titlePath?: string[] | undefined;
  file?: string | undefined;
  projectName?: string | undefined;
  results?: PlaywrightResult[] | undefined;
  status?: string | undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapStatus(status: string | undefined): TestRunObservation['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'passed': return 'PASS';
    case 'skipped': return 'SKIP';
    case 'timedout':
    case 'timeout': return 'TIMEOUT';
    case 'interrupted': return 'BLOCKED';
    case 'failed': return 'FAIL';
    default: return 'BLOCKED';
  }
}

function collectTests(node: unknown, inheritedFile: string | undefined, inheritedTitles: string[], output: PlaywrightTest[]): void {
  const object = asObject(node);
  const file = asString(object.file) ?? inheritedFile;
  const title = asString(object.title);
  const titles = title ? [...inheritedTitles, title] : inheritedTitles;
  const specs = Array.isArray(object.specs) ? object.specs : [];
  for (const spec of specs) {
    const specObject = asObject(spec);
    const specTitle = asString(specObject.title);
    const specTitles = specTitle ? [...titles, specTitle] : titles;
    const tests = Array.isArray(specObject.tests) ? specObject.tests : [];
    for (const test of tests) {
      const testObject = asObject(test);
      output.push({
        title: specTitles.join(' › '),
        titlePath: specTitles,
        file: asString(testObject.location) ?? file,
        projectName: asString(testObject.projectName),
        results: Array.isArray(testObject.results) ? testObject.results.map((result) => asObject(result) as PlaywrightResult) : [],
        status: asString(testObject.status),
      });
    }
  }
  const suites = Array.isArray(object.suites) ? object.suites : [];
  for (const suite of suites) collectTests(suite, file, titles, output);
}

function failureMessage(result: PlaywrightResult): { message?: string; stack?: string } {
  const first = result.error ?? result.errors?.[0];
  return {
    ...(first?.message !== undefined ? { message: first.message } : {}),
    ...(first?.stack !== undefined ? { stack: first.stack } : {}),
  };
}

export function parsePlaywrightJsonReport(report: unknown, options: PlaywrightReportAdapterOptions = {}): ParsedPlaywrightReport {
  const root = asObject(report);
  const tests: PlaywrightTest[] = [];
  if (Array.isArray(root.suites)) {
    for (const suite of root.suites) collectTests(suite, undefined, [], tests);
  } else if (Array.isArray(root.tests)) {
    collectTests(root, undefined, [], tests);
  }

  const runId = options.runId ?? `playwright-${options.timestamp ?? Date.now()}`;
  const timestamp = options.timestamp;
  const runs: TestRunObservation[] = [];
  const failures: FailureObservation[] = [];
  tests.forEach((test, testIndex) => {
    const results: PlaywrightResult[] = test.results && test.results.length > 0 ? test.results : [{ status: test.status }];
    results.forEach((result, resultIndex) => {
      const status = mapStatus(result.status);
      const testId = `${test.file ?? 'unknown'}::${test.title ?? `test-${testIndex + 1}`}`;
      const retryIndex = typeof result.retry === 'number' ? result.retry : resultIndex;
      runs.push({
        runId,
        testId,
        repository: options.repository,
        title: test.title,
        sourceFile: test.file,
        status,
        durationMs: typeof result.duration === 'number' ? result.duration : undefined,
        timestamp,
        retryIndex,
      });
      if (status === 'FAIL' || status === 'TIMEOUT') {
        const error = failureMessage(result);
        failures.push({
          id: `${runId}:${testIndex}:${resultIndex}`,
          repository: options.repository,
          testTitle: test.title,
          sourceFile: test.file,
          category: 'TEST_FAILURE',
          errorMessage: error.message,
          errorStack: error.stack,
          timestamp,
          durationMs: typeof result.duration === 'number' ? result.duration : undefined,
        });
      }
    });
  });
  return { runs, failures };
}

function renderMarkdown(report: Omit<CiEvidenceReport, 'markdown' | 'annotations'>): string {
  const lines = [
    `## PIE CI result: ${report.qualityGate.status}`,
    '',
    `- Tests observed: ${report.runs.length}`,
    `- Failure observations: ${report.failures.length}`,
    `- Failure clusters: ${report.clusters.length}`,
    `- Flaky tests: ${report.stability.filter((test) => test.flaky).length}`,
  ];
  if (report.qualityGate.reasons.length > 0) lines.push('', '### Gate reasons', ...report.qualityGate.reasons.map((reason) => `- ${reason}`));
  if (report.clusters.length > 0) {
    lines.push('', '### Failure clusters', '| Severity | Count | Category | Cluster |', '|---|---:|---|---|');
    for (const cluster of report.clusters.slice(0, 20)) lines.push(`| ${cluster.severity} | ${cluster.count} | ${cluster.fingerprint.category} | ${cluster.clusterId} |`);
  }
  return lines.join('\n');
}

export function buildCiEvidenceReport(report: unknown, options: PlaywrightReportAdapterOptions = {}): CiEvidenceReport {
  const parsed = parsePlaywrightJsonReport(report, options);
  const clusters = clusterFailures(parsed.failures);
  const stability = analyzeTestStability(parsed.runs.map((run) => ({
    ...run,
    failureClusterId: clusters.find((cluster) => run.title && cluster.affectedTests.includes(run.title))?.clusterId,
  })));
  const qualityGate = evaluateQualityGate({ clusters, stability });
  const base = { ...parsed, clusters, stability, qualityGate };
  const annotations = qualityGate.reasons.map((reason) => `::${qualityGate.status === 'FAIL' ? 'error' : qualityGate.status === 'ABSTAIN' ? 'warning' : 'notice'} title=PIE ${qualityGate.status}::${reason}`);
  return { ...base, markdown: renderMarkdown(base), annotations };
}
