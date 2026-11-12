# PIE Baseline Audit (Phase 0)

**Date:** 2026-11-12  
**Engine Repository:** `D:\Work\playwright-intelligence-engine`  
**Base Branch / HEAD:** `pie-v3.3-frames-drift` @ `b8e7ef27559edfa6e68bbe660d4ba91072262768`  
**Working Feature Branch:** `feature/evidence-driven-generation`  
**Runtime Environment:** Windows 11, Node `v24.19.0`, npm `10.8.0`  
**Testbed Root:** `D:\Work\pie-real-repository-testbed`

---

## 1. Initial Working Tree State (Preserved Unrelated Edits)

Prior to creating `feature/evidence-driven-generation`, `git status -s` showed:
- `M src/generator/assertion-quality-gate.ts` (1 trailing newline)
- `M tests/unit/assertion-quality-gate.test.ts` (1 trailing newline)
- `?? evaluation/runs/run-2026-11-12T15-05-41-141Z-b8e7ef2.json` (diagnostic run ledger)

These files were preserved intact.

---

## 2. Baseline Verification Results (Before Fixes)

| Command | Exit Code | Verbatim Result | Notes |
|---|---:|---|---|
| `npm run typecheck` | `0` | `0 errors across 3 configs` | Clean |
| `npm run build` | `0` | `ESM dist\index.js 624.61 KB`, declarations emitted | Clean |
| `npm test` | `1` | `Test Files 1 failed \| 56 passed (57)`, `Tests 3 failed \| 558 passed (561)` | 3 tests in `tests/unit/generation-agent.test.ts` timed out at `5000ms` because `PIE_LLM_API_KEY` was set in shell env and triggered live DeepSeek HTTP calls |
| `node scripts/evaluate/testbeds.mjs` | `0` | `Diagnostic accuracy: 1 (14/14 families)` | `MUT-01`–`MUT-05` repairable, `MUT-06`–`MUT-14` abstain |
| `npm run verify:all` | `0` | `TOTAL 10 \| PASS 10 \| FAIL 0 \| UNVERIFIED 0` (`VERDICT: OK`) | `cli.diagnose P50 752 ms / max 800 ms` |
| `npm run benchmark` | `0` | `TOTAL EMPIRICAL BENCHMARK SCENARIOS EVALUATED: 125` | 100% precision, 96.7% recall, 100% safe abstention, 0% masking |

### Verbatim Master Benchmark Baseline Summary (`npm run benchmark` @ `b8e7ef2`)

```text
 TOTAL EMPIRICAL BENCHMARK SCENARIOS EVALUATED: 125
 • Tier 1 Baseline Scenarios       : 5 (Pass Rate: 100.0% | 95% CI: [56.55%, 100%])
 • Tier 2 Structural Mutations     : 60 (58 Repaired in Browser)
   - Repair Precision              : 100.0% (95% CI: [93.79%, 100%])
   - Repair Recall                 : 96.7% (95% CI: [88.64%, 99.08%])
   - Repair Coverage               : 100.0% (Mutation population handled)
 • Tier 3 Negative Controls        : 60 (Safe Abstention Rate: 100.0% | 95% CI: [93.98%, 100%])
 • Seeded Defect Detection Rate    : 100.0% (Masking Rate: 0.0%)
 • False Repair Rate               : 0.0% (Zero incorrect repairs accepted)
 • Regression Rate                 : 0.0% (Evaluated on 58 baseline re-runs)
 • Latency P50 / P95               : 222.22 ms / 8136.56 ms
 • Overall Benchmark Wilson 95% CI : [94.35%, 99.56%]
```

---

## 3. Phase 0 Isolation Fix & Post-Fix Baseline

- **Fix Applied:** Guarded environment key lookup (`!process.env.VITEST || process.env.PIE_LIVE_LLM_TESTS === '1'`) in `src/authoring/hybrid-author.ts` and `src/intelligence/generation-agent.ts`, added env isolation (`beforeEach`/`afterEach`) and deterministic `fetchImpl` mock coverage in `tests/unit/generation-agent.test.ts`.
- **Re-run `npm test` (with `PIE_LLM_API_KEY` present in shell env):**
  - `Test Files  57 passed (57)`
  - `Tests       563 passed (563)`
  - `Duration    14.25s`

---

## 4. Verified Disposable Testbed Workspaces

Located at `D:\Work\pie-real-repository-testbed\disposable-workspaces\`:
- `caltermine-todo-app` (React 18 + Vite, built, zero native tests)
- `todomvc`
- `juice-shop`
- `playwright-examples`
- `playwright-e2e-tests`
- `commerce` (Next.js storefront)
- `precedent`, `hi.events`, `refine-crm`, `refine-app-crm`, `twenty`, `logistic-web`
- Mutation harnesses: `MUT-01-accessible-name-change`, `MUT-02-id-change`, `MUT-05-dom-container-restructuring`
