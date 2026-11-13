# PIE Baseline Engineering Audit

**Audit Date:** 2026-11-13  
**Auditor:** Principal Software & Playwright Intelligence Architect  
**Branch:** `feature/evidence-driven-generation`  
**Git Commit:** `90880fe`  
**Node.js Engine:** `v24.19.0` (x64) on Windows  

---

## 1. System Health & Quality Gate Status

The PIE codebase has been verified against all strict baseline engineering gates prior to Phase 1 implementation.

| Gate / Suite | Command | Total | Passed | Failed | Status |
|:---|:---|:---:|:---:|:---:|:---:|
| **TypeScript Compilation** | `npm run typecheck` (3 configs) | 3 tsconfigs | 3 | 0 | **PASS** |
| **Unit & Integration Suite** | `npm test` (`vitest run --maxWorkers=4`) | 585 tests (61 files) | 585 | 0 | **PASS (100%)** |
| **Diagnostic Evaluation** | `node scripts/evaluate/testbeds.mjs` | 14 MUT families | 14 | 0 | **PASS (100%)** |
| **Unified Verification Suite** | `npm run verify:all` | 10 checks | 10 | 0 | **PASS (100%)** |
| **Master Controlled Benchmark**| `master-benchmark-runner.ts` | 125 scenarios | 125 | 0 | **PASS (100%)** |

All baseline test evidence is permanently captured in:
- `reports/phase-0/BASELINE_TEST_RESULTS.json`
- `reports/phase-0/BASELINE_BENCHMARK_RESULTS.json`
- `reports/phase-0/BASELINE_GIT_STATUS.md`

---

## 2. Core Functional Assessment

### 2.1 Trace Diagnostics & Failure Classification
- **Strengths:** 
  - `TraceParser` and `ActionParser` parse Playwright zip traces accurately and extract actions, errors, screenshots, and DOM snapshots.
  - `FailureClassifier` successfully distinguishes locator drift (`MUT-01..05`) from negative control categories (`MUT-06..14`), including obstructed elements, disabled elements, hydration/timing errors, backend 500 errors, and session expirations.
- **Identified Gap:**
  - Need explicit separation between `runtimeSymptom` (the Playwright exception) and `causalRootCause` (the underlying technical defect).

### 2.2 Locator Synthesis & Scoring
- **Strengths:**
  - `CandidateExtractor` extracts role, label, placeholder, text, test ID, and CSS selectors.
  - `SelectorScorer` penalizes role mismatches and gates intent conflicts.
- **Identified Gap:**
  - Over-eager retreat to technical CSS `#id` instead of resilient accessible names (`getByRole`, `getByLabel`).
  - Need volatility detection for dynamic hash IDs and CSS-in-JS classes.

### 2.3 AstPatcher & Code Mutation
- **Strengths:**
  - `AstPatcher` (`src/repair/ast-patcher.ts`) safely edits Page Object class property initializers with roundtrip formatting and rollback.
- **Identified Gap (CRITICAL):**
  - **No statement-level AST patching:** Cannot modify `await page.waitForTimeout()` or insert `Promise.all([page.waitForResponse(), ...])` inside `test('...', async ({ page }) => { ... })`.

### 2.4 Intent Invariant Validation
- **Strengths:**
  - `IntentValidator` (`src/repair/intent-validator.ts`) enforces destructive action invariants, rejecting replacements of delete/remove actions with navigational or editing actions.
- **Identified Gap:**
  - Needs input data fingerprinting (verifying that quantities, prices, search queries are not modified to force a pass).
  - Needs multi-match evidence-based disambiguation rather than immediate blind abstention.

---

## 3. Findings from Experiments A, B, and C

1. **Experiment A (Semantic Resilience):**
   - 4 out of 5 semantic locators were successfully repaired; 1 negative control was safely abstained.
   - Identified the `#id` fallback trap: `getByLabel('User Login ID')` was repaired to `page.locator('#username')`. While functional, semantic priority must be enforced.
2. **Experiment B (Timing & Flakiness):**
   - Transforming brittle timeouts into event-driven promises (`Promise.all([waitForResponse, click])`) reduced flakiness from 100% to 0% across 5 consecutive trials.
   - Proved that statement-level AST transformation is an urgent, non-negotiable architectural requirement (`StatementPatcher`).
3. **Experiment C (Intent Preservation):**
   - 4 out of 4 intentional defects and logic breaks were safely abstained with 0 false repairs and 0 assertion weakening.
   - Proved that PIE's invariant validation architecture prevents tests from being corrupted into false passes.

---

## 4. Phase 0 Audit Conclusion & Authorization

The baseline audit confirms that PIE has a solid, 100% passing testbed foundation and clearly defined engineering gaps. Phase 0 is complete.

Engineering execution is hereby authorized to proceed to **Phase 1: Statement-Level AST Patching and Flakiness Repair (`StatementPatcher`)**.
