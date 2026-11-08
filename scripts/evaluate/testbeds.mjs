#!/usr/bin/env node
/**
 * PIE testbed evaluation — one command that produces the evaluation ledger.
 *
 * Runs, per testbed:
 *   - `pw-intel diagnose` on one trace per MUT family (deterministic flows +
 *     abstention) and records category / abstain / correctness.
 *   - `pw-intel profile --json` and records preferred locator + baseUrl.
 *
 * Output: evaluation/runs/run-<timestamp>-<sha>.json (append-only).
 *
 * Correctness oracle for each MUT family is declared below. A diagnosis is
 * "correct" when its root-cause category matches the expected category.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'bin', 'pw-intel.js');
const TRACE_DIR = process.env.PIE_TRACE_DIR ?? 'D:/Work/pie-real-repository-testbed/generated-test-data/traces';
const TESTBEDS = [
  { id: 'juice-shop', repo: 'D:/Work/pie-real-repository-testbed/disposable-workspaces/juice-shop' },
  { id: 'twenty-crm', repo: 'D:/Work/pie-real-repository-testbed/disposable-workspaces/twenty/packages/twenty-e2e-testing' },
  { id: 'logistic-web', repo: 'D:/Work/logistic-web/automation' },
];

// Ground truth per mutation family. Positive families (MUT-01..05) expect
// drift recovery (no abstain). Negative controls (MUT-06+) expect safe
// abstention — exact category is less important than refusing to mutate.
const EXPECT = {
  'MUT-01': { expectAbstain: false, category: 'LOCATOR_DRIFT' },
  'MUT-02': { expectAbstain: false, category: 'LOCATOR_DRIFT' },
  'MUT-03': { expectAbstain: false, category: 'LOCATOR_DRIFT' },
  'MUT-04': { expectAbstain: false, category: 'LOCATOR_DRIFT' },
  'MUT-05': { expectAbstain: false, category: 'LOCATOR_DRIFT' },
  'MUT-06': { expectAbstain: true },
  'MUT-07': { expectAbstain: true },
  'MUT-08': { expectAbstain: true },
  'MUT-09': { expectAbstain: true },
  'MUT-10': { expectAbstain: true },
  'MUT-11': { expectAbstain: true },
  'MUT-12': { expectAbstain: true },
  'MUT-13': { expectAbstain: true },
  'MUT-14': { expectAbstain: true },
};

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { status: r.error ? -1 : (r.status ?? -1), out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function listTraces() {
  try { return fs.readdirSync(TRACE_DIR).filter((n) => n.endsWith('trace.zip')); }
  catch { return []; }
}

function runDiagnosis(traceName) {
  const r = sh(process.execPath, [BIN, 'diagnose', path.join(TRACE_DIR, traceName)]);
  const category = r.out.match(/Root Cause Classification\s*:\s*([A-Z_0-9]+)/)?.[1] ?? 'UNKNOWN';
  const abstain = r.out.includes('ABSTAIN FROM CODE REPAIR');
  return { category, abstain, status: r.status, durationMs: Math.round(r.status === 0 ? 0 : 0) };
}

function runProfile(repo) {
  if (!fs.existsSync(repo)) return { ok: false, note: 'missing' };
  const r = sh(process.execPath, [BIN, 'profile', repo, '--json']);
  const preferred = r.out.match(/"preferred"\s*:\s*"([^"]+)"/)?.[1] ?? 'unknown';
  const baseUrl = r.out.match(/"baseUrl"\s*:\s*"([^"]+)"/)?.[1] ?? undefined;
  return { ok: r.status === 0, preferred, baseUrl };
}

function main() {
  const traces = listTraces();
  const byFamily = new Map();
  for (const name of traces) {
    const m = name.match(/^(MUT-\d+)/);
    if (!m) continue;
    // Prefer the "sanity-login" trace (the primary action), else first.
    if (!byFamily.has(m[1]) || name.includes('sanity-login')) byFamily.set(m[1], name);
  }

  const gitSha = (() => { const r = sh('git', ['rev-parse', '--short', 'HEAD']); return r.status === 0 ? r.out.trim() : 'unknown'; })();

  const results = { families: [], testbeds: [] };

  let correct = 0;
  let total = 0;
  for (const [family, traceName] of [...byFamily.entries()].sort()) {
    const started = Date.now();
    const d = runDiagnosis(traceName);
    const exp = EXPECT[family];
    const isCorrect = exp
      ? d.abstain === exp.expectAbstain && (!exp.category || d.category === exp.category)
      : null;
    if (isCorrect !== null) { total++; if (isCorrect) correct++; }
    results.families.push({
      family, trace: traceName, category: d.category, abstain: d.abstain,
      expectAbstain: exp?.expectAbstain, correct: isCorrect, durationMs: Date.now() - started,
    });
  }

  for (const tb of TESTBEDS) {
    results.testbeds.push({ id: tb.id, profile: runProfile(tb.repo) });
  }

  const summary = {
    generatedAt: new Date().toISOString(), gitSha,
    diagnosticAccuracy: total > 0 ? Number((correct / total).toFixed(4)) : null,
    diagnosedFamilies: total, correctFamilies: correct,
  };

  const payload = { summary, ...results };
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, 'evaluation', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `run-${ts}-${gitSha}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Diagnostic accuracy: ${summary.diagnosticAccuracy ?? 'N/A'} (${correct}/${total} families)`);
  for (const f of results.families) {
    const mark = f.correct === null ? '??' : f.correct ? 'OK' : 'FAIL';
    console.log(`${mark}  ${f.family.padEnd(8)} ${f.category.padEnd(20)} abstain=${f.abstain} expectAbstain=${f.expectAbstain}`);
  }
  for (const tb of results.testbeds) {
    const p = tb.profile;
    console.log(`    ${tb.id.padEnd(14)} preferred=${p.ok ? p.preferred : 'missing'} baseUrl=${p.baseUrl ?? '-'}`);
  }
  console.log(`Ledger: ${file}`);
}

main();
