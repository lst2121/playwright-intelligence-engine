# PIE — Complete Reproduction & Verification Guide

**Document:** Reproduction & Verification Guide  
**Release:** v2.0.0 (Master Release)  
**Date:** 2026-11-13  

---

## 1. System Requirements & Environment Setup

- **Operating System:** Windows 10/11, macOS, or Linux (Ubuntu 22.04+)
- **Node.js:** `>= 20.0.0` (Tested on Node.js v24.19.0)
- **Package Manager:** `npm` (v10+)
- **Browsers:** Headless Chromium (Installed via Playwright)
- **Repository Directory:** `d:\Work\playwright-intelligence-engine`
- **Testbed Directory:** `D:\Work\pie-real-repository-testbed`

```bash
# Verify Node and NPM versions
node --version
npm --version

# Install dependencies
npm ci
```

---

## 2. Step-by-Step Command Verification Matrix

Every gate and benchmark in PIE can be executed independently using the following standard commands:

### Step 1: Multi-Config TypeScript Compilation
Verifies 0 type errors across root, test, and benchmark configurations:
```bash
npm run typecheck
```
*Expected Output:* Clean exit code 0 with 0 errors across `tsconfig.json`, `tsconfig.tests.json`, and `tsconfig.benchmarks.json`.

### Step 2: Build Packaging & Distribution
Verifies ESM bundling and declaration map generation:
```bash
npm run build
```
*Expected Output:* `dist/index.js` bundled cleanly (~798 KB) with `.d.ts` declaration maps generated in `dist/`.

### Step 3: Full Vitest Unit & Integration Suite
Executes 64 test files and 615 tests across all PIE modules:
```bash
npm test
```
*Expected Output:* `Test Files  64 passed (64)`, `Tests  615 passed (615)` in ~65s.

### Step 4: Statement Patcher Unit & Invariant Tests
Runs the statement-level AST transformation suite:
```bash
npx vitest run tests/unit/statement-patcher.test.ts
```
*Expected Output:* 11/11 tests passed. Verifies sleep replacement, `Promise.all` network sync, readiness checks, and assertion protection invariants.

### Step 5: Multi-Match Disambiguation & Positional Invariant Tests
Runs the 10 benchmark scenarios for evidence-based disambiguation:
```bash
npx vitest run tests/unit/locator-disambiguation.test.ts
```
*Expected Output:* 10/10 tests passed (`AMB-01` .. `AMB-10`). Verifies visibility filtering, container anchoring, landmark scoping, and refusal of positional guessing.

### Step 6: Deep Intent Invariants & Causal Diagnostics Tests
Runs the 6-dimension invariant verification and causal decoupling tests:
```bash
npx vitest run tests/unit/intent-and-causal-diagnostics.test.ts
```
*Expected Output:* 9/9 tests passed. Verifies data payload integrity (e.g. 5 $\to$ 1 rejection) and workflow step sequence integrity.

### Step 7: Unified Quality Gates (`verify:all`)
Executes all 10 deterministic gates:
```bash
npm run verify:all
```
*Expected Output:* 10/10 checks verified OK (typecheck, build, determinism, abstain-ambiguous, abstain-disabled, naming, grounding, cli-latency, ledger, profiler).

### Step 8: Diagnostic Testbed Mutation Families
Evaluates 14 mutation diagnostic families:
```bash
node scripts/evaluate/testbeds.mjs
```
*Expected Output:* 14/14 families correctly diagnosed with 1.0 accuracy; ledger appended in `.pie/diagnostic-ledger.jsonl`.

### Step 9: Statistical Flakiness Elimination Runner
Executes 30 repeated trials on real flakiness patterns:
```bash
npx tsx benchmarks/flakiness/pie-flake-runner.ts
```
*Expected Output:* Unpatched pass rate: 0.0% ([0.0%, 20.39%]); Patched pass rate: 100.0% ([79.61%, 100.0%]); 0 arbitrary sleeps remaining.

### Step 10: Master Benchmark Suite (125 Headless Chromium Scenarios)
Executes the full 125-scenario live empirical benchmark:
```bash
npm run benchmark
```
*Expected Output:*
- Tier 1 Clean Baseline: 5/5 (100.0%)
- Tier 2 Positive DOM Drift: 58/60 repaired (Precision: 100.0%, Recall: 96.67%)
- Tier 3 Negative Controls: 60/60 safe abstentions (100.0%)
- Overall Empirical Score: 96.0% (Wilson 95% CI: [94.35%, 99.56%])
- Defect Detection Rate: 100.0%, False Repair Rate: 0.0%, Regression Rate: 0.0%.
