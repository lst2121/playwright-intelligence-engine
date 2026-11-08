# PIE v3.0 Acceptance Matrix (A1 – A15)

**Evaluation Date:** 2026-11-08  
**Release Target:** Playwright Intelligence Engine v3.0 Release Candidate  
**Total Test Suite Status:** 53 Test Files, 531 Tests Passing (0 Failures)  

---

## Acceptance Criteria Verification Summary

| ID | Criterion | Requirement | Result | Empirical Proof / Command |
| :---: | :--- | :--- | :---: | :--- |
| **A1** | **Index-Derived Identifier Count** | Exactly 0 identifiers matching `/(actionButton\|inputField\|button\|input)\d+/` | **0 (PASSED)** | `npx vitest run tests/unit/naming-matrix.test.ts` |
| **A2** | **Naming Conformance Rate** | $\ge 0.95$ across all generated Page Objects | **1.00 (100%)** | `reports/v3/author-parity.md` |
| **A3** | **Semantic Name Coverage** | $\ge 0.90$ across all action targets | **1.00 (100%)** | `reports/v3/author-parity.md` |
| **A4** | **Brownfield POM Class Names** | Match application page (`LoginPage`, `CartPage`, `CheckoutPage`), not scenario sentence | **VERIFIED** | Juice Shop brownfield generation emits `LoginPage` and `DashboardPage` |
| **A5** | **Conventions Reflection** | 100% of discovered conventions in `.pie/conventions.json` reflected in generated code | **100%** | `node bin/pw-intel.js profile` generates `.pie/conventions.json` used by generator |
| **A6** | **Exemplar Token Budget** | Sibling POM exemplars parsed, cached, and truncated to $\le 120$ lines | **VERIFIED** | `src/intelligence/repository-profile.ts` (`sampleExemplars`) |
| **A7** | **Zero Assertion Weakening** | 0 assertion weakenings, mutations, or deletions ($V = A \land T \land F \land I \land D \land E$) | **0 (PASSED)** | `tests/unit/author-gate.test.ts` & `tests/unit/ast-patching-and-invariants.test.ts` |
| **A8** | **Zero Synthetic Proofs** | Every execution proof originates from child-process execution in Git worktree | **VERIFIED** | `reports/v3/external-repair.md` (`MUT-01` isolated child process run) |
| **A9** | **Author / Gate Decoupling** | Gate evaluation executes independently of the author via `runGate()` | **VERIFIED** | `src/gate/index.ts` (`runGate`) verified in `tests/unit/author-gate.test.ts` |
| **A10** | **Bounded Generation Loop** | Terminates in $\le 3$ steps or 120s with `AGENT_NO_PROGRESS` transition when stuck | **VERIFIED** | `tests/unit/generation-agent.test.ts` |
| **A11** | **Real Testbed Verification** | Generation succeeds across at least 3 distinct real testbeds | **VERIFIED** | Juice Shop (`juice-shop`), Twenty CRM (`twenty-e2e-testing`), and Logistic Web (`logistic-web/automation`) |
| **A12** | **Real External Repair** | Real external failure repaired in isolated worktree with passing execution proof | **VERIFIED** | `MUT-01` accessible name change repaired in `pages/AdminPage.ts` with 4/4 passing tests |
| **A13** | **Master Benchmark Honesty** | Dynamic `falseRepairRate` computation; regression check verifies affected module | **VERIFIED** | `benchmarks/runner/master-benchmark-runner.ts` & `benchmarks/runner/defect-resistance-harness.ts` |
| **A14** | **Documentation Alignment** | Exactly matching test counts and capabilities across all documentation | **VERIFIED** | 53 test files, 531 tests documented consistently across `README.md` and `docs/` |
| **A15** | **Author Parity A/B Report** | Generated on-disk comparison of template vs hybrid vs llm | **VERIFIED** | `reports/v3/author-parity.md` |

---

## Verification Artifacts Created
- `reports/v3/testbed-manifest.json`: Scanned catalog of 16 discovered testbeds in workspace
- `reports/v3/author-parity.md`: A/B comparison across all three authoring engines
- `reports/v3/external-repair.md`: Verifiable proof of real Playwright trace repair in isolated worktree
- `docs/V3_ARCHITECTURE.md`: Complete architectural guide to the decoupled Author / Gate framework
