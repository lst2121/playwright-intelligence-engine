import { buildRepositoryProfile } from '../dist/index.js';
import { ArchiveReader } from '../dist/index.js';
import { EvidenceCorrelator } from '../dist/index.js';
import { TraceParser } from '../dist/index.js';
import { planArchitecture } from '../dist/index.js';

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function measureDiagnose(samples = 10) {
  const tracePath = 'D:/Work/pie-real-repository-testbed/generated-test-data/traces/MUT-01-accessible-name-change--admin-panel-login-Login-Te-0b737-e-and-password-sanity-login-chromium--trace.zip';
  const durations = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
    const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? [traceEntryName]);
    const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
      ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames ?? [networkEntryName])
      : '';
    const traceLines = traceText.split('\n');
    const networkLines = networkText.split('\n');
    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    EvidenceCorrelator.correlate(context);
    durations.push(performance.now() - t0);
  }
  return {
    durations,
    p50: Number(percentile(durations, 50).toFixed(2)),
    p95: Number(percentile(durations, 95).toFixed(2)),
  };
}

async function measureProfile(samples = 10) {
  const repoPath = 'D:/Work/logistic-web/automation';
  const durations = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await buildRepositoryProfile(repoPath);
    durations.push(performance.now() - t0);
  }
  return {
    durations,
    p50: Number(percentile(durations, 50).toFixed(2)),
    p95: Number(percentile(durations, 95).toFixed(2)),
  };
}

async function measureArchitect(samples = 10) {
  const durations = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    planArchitecture({
      featureName: 'OrderReview',
      mode: 'greenfield',
      steps: [
        { action: 'fill', role: 'textbox', name: 'Email', value: 'qa@example.com' },
        { action: 'fill', role: 'textbox', name: 'Password', value: 'secret' },
        { action: 'click', role: 'button', name: 'Sign In' },
      ],
    });
    durations.push(performance.now() - t0);
  }
  return {
    durations,
    p50: Number(percentile(durations, 50).toFixed(2)),
    p95: Number(percentile(durations, 95).toFixed(2)),
  };
}

async function main() {
  console.log('=== Performance Latency Measurement (10 samples each) ===\n');

  const diag = await measureDiagnose(10);
  console.log(`• diagnose (single trace)      : P50 = ${diag.p50} ms | P95 = ${diag.p95} ms (Target: P50 <= 600 ms, P95 <= 1200 ms) -> ${diag.p50 <= 600 && diag.p95 <= 1200 ? 'PASS' : 'FAIL'}`);

  const prof = await measureProfile(10);
  console.log(`• profile (<= 50 test files)   : P50 = ${prof.p50} ms | P95 = ${prof.p95} ms (Target: P50 <= 700 ms, P95 <= 1500 ms) -> ${prof.p50 <= 700 && prof.p95 <= 1500 ? 'PASS' : 'FAIL'}`);

  const arch = await measureArchitect(10);
  console.log(`• architect (deterministic)    : P50 = ${arch.p50} ms | P95 = ${arch.p95} ms (Target: P50 <= 400 ms, P95 <= 900 ms) -> ${arch.p50 <= 400 && arch.p95 <= 900 ? 'PASS' : 'FAIL'}`);
}

main().catch(console.error);

