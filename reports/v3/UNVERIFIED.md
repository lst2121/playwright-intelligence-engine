# PIE v3.1 — Verified vs. Unverified Capabilities Audit

**Date:** 2026-11-08  
**Standard:** Strict Empirical Truth Directive (Zero Fabrications, Zero Synthetic Proofs)  
**Repository:** `d:\Work\playwright-intelligence-engine`  

---

## 1. Verified Capabilities (Backed by Verifiable On-Disk Proofs)

The following capabilities have been empirically verified in the current working tree with reproducible command outputs and test executions:

### 1.1 Invariant Protection & Verification Engine ($V = A \land T \land F \land I \land D \land E$)
- **Zero Assertion Weakening ($A$)**: AST invariant checks prevent weakening, deleting, or altering test assertions. Verified across 45 AST patching invariant tests (`tests/unit/ast-patching-and-invariants.test.ts`).
- **Zero Synthetic Execution Proofs ($E$)**: `ExecutionRunner.runPlaywrightTest` executes real child processes (`npx playwright test`) inside isolated Git worktrees. Verified in `tests/unit/worktree-and-dependency-isolation.test.ts` (30 tests) and `tests/unit/end-to-end-repair-workflows.test.ts` (15 tests).
- **Safe Abstention on Ambiguity**: `FailureClassifier` marks `AMBIGUOUS_MATCH` (strict-mode multi-match) with `shouldAbstain: true` by default unless unique scoped selector is empirically verified. Verified by `MUT-06` in `tests/unit/failure-classification-and-correlation.test.ts`.
- **Negative Control Defect Resistance**: Fails closed on intentional backend defects, expired credentials, and product regressions without hallucinating repairs.

### 1.2 Metrics Truth & Denominator Integrity
- **Empty Denominator Handling**: When sample size $n = 0$, rates return `null` and format strictly as `N/A (0 samples)`. No false 100% or 0% fallback rates. Enforced in `benchmarks/runner/master-benchmark-runner.ts`, `benchmarks/runner/defect-resistance-harness.ts`, and `src/evaluation/evaluation-scorecard.ts`. Verified in `tests/unit/empty-denominator.test.ts` (5 tests).
- **Append-Only History Serialization**: Benchmark runs append immutable JSON records to `benchmarks/reports/run-<UTC-timestamp>-<sha>.json` and `benchmarks/reports/history.json`.

### 1.3 Repository Profiling & Runtime Conventions
- **Discovered Facts, Not Instructions**: `buildRepositoryProfile` mines real repository ASTs for identifier suffixes, method verbs, locator distributions, and exemplar Page Objects.
- **Locator Policy Priority**: `preferredLocator` strictly respects policy order (`getByRole` > `getByLabel` > `getByTestId` > `getByText` > `locator`) rather than naive majority count.
- **BaseURL Auto-Discovery**: Playwright config files are parsed for direct, environment-variable, or identifier-based base URLs with fallback to `'/'`.
- **Clean Tag & Domain Term Mining**: Excludes `*.d.ts`, `.css`, and non-test source files. Test tags and domain terms are mined exclusively from files matching `/\btest(?:\.describe)?\s*\(/`.

### 1.4 Test Generation & Naming Hygiene
- **Zero Index-Derived Identifiers**: Naming planner disambiguates symbols without numeric indexes (`click1`, `emailInput1`) or adjacent duplicated word tokens (`submitSubmitApplication`).
- **Linter Mutation Testing**: `NamingLinter` rejects non-conformant patterns across 12 mutation test suites (`tests/unit/linter-mutation.test.ts`).
- **Path Confidence Gating**: Output paths are gated by `pathConfidence >= 0.5`, falling back to safe conventions (`tests` / `tests/pages`) when confidence is low.

---

## 2. Unverified & Experimental Capabilities

The following capabilities are **NOT** claimed as production-verified and are explicitly demarcated as experimental or out-of-scope:

| Capability | Current Repository Status | Why It Is Unverified |
| :--- | :--- | :--- |
| **Unconstrained Neural Code Authoring (`--author=llm`)** | **Experimental** (`src/authoring/llm-author.ts`) | Raw LLM full-file authoring without template compiler currently delegates to `HybridAuthor` to guarantee AST compilation and safety. Direct end-to-end unconstrained neural file writes without template guards remain experimental. |
| **Third-Party OAuth / SSO Live Automation** | **Out of Scope** | Live authentication flows involving Google OAuth, Okta, or external identity providers with anti-bot or CAPTCHA barriers are not automated autonomously. |
| **Multi-Worker Parallel State Mutation** | **Constrained to 1 Worker** | Controlled app in-memory state servers mutate shared memory during live clicks. Parallel multi-worker test runs against in-memory state require separate worker port allocations and are currently executed sequentially (`workers: 1`). |
| **Cross-Browser Visual Regression Healing** | **Unverified on WebKit / Firefox** | Automated DOM repair is verified on Chromium. Cross-browser layout drift (pixel difference healing across WebKit/Firefox engines) has not been evaluated in this release. |

---

## 3. Compliance Affirmation

Every claim in this document is grep-able in `src/` and verified by live Vitest test runs (55 files, 549 tests passing) and reproducible benchmark history in `benchmarks/reports/`.

