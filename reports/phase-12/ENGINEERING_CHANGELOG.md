# PIE Phase 12 — Engineering Changelog (v1.0 $\to$ v2.0 Master Release)

**Phase:** Phase 12  
**Document:** Complete Engineering Changelog  
**Milestone:** v2.0 Master Release  
**Date:** 2026-11-13  
**Status:** FULLY COMMITTED & PRODUCTION-READY  

---

## 1. Major Additions & Core Subsystems

### Subsystem 1: Statement-Level AST Engine (`StatementPatcher`)
- **File:** `src/repair/statement-patcher.ts`
- **Capabilities:**
  - Full AST manipulation inside test blocks (`test('...', async ({ page }) => { ... })`) using `ts-morph`.
  - Sleep Elimination: `replace-timeout-with-wait` converts `await page.waitForTimeout(N)` to event-driven `expect(locator).toBeVisible({ timeout: ... })`.
  - Network Synchronization: `wrap-action-with-response` mounts `page.waitForResponse` concurrently with user actions inside `Promise.all`.
  - Pre-flight Readiness: `insert-readiness-check` injects `toBeEnabled()` checks prior to action execution.
  - Inline Locator Healing: Direct statement transformation of `page.locator(...)` and `page.getByRole(...)`.
  - Automatic `expect` import injection from `@playwright/test`.
  - Strict assertion tampering guard: `AST_ASSERTION_TAMPERING_PROHIBITED`.

### Subsystem 2: Evidence-Based Disambiguation Engine (`LocatorDisambiguationEngine`)
- **File:** `src/intelligence/locator-disambiguation-engine.ts`
- **Capabilities:**
  - 5-stage Disambiguation Pipeline:
    1. Visibility Filtering (`filter({ visible: true })`)
    2. Container Anchoring (`locator('tr').filter({ hasText: ... })`)
    3. Landmark Scoping (`locator('header' / 'dialog')`)
    4. Explicit Positional Intent (`.first()` / `.nth()` preserved strictly with proof)
    5. Safe Abstention (Refusal to guess)
  - Mathematical enforcement of the **Positional Invariant**: *"Never invent positional intent."*

### Subsystem 3: Deep Intent Invariants & Anti-Regression Verification (`IntentValidator`)
- **File:** `src/repair/intent-validator.ts`
- **Capabilities:**
  - Full implementation of the 6-dimension invariant formula: $V = A \wedge T \wedge F \wedge I \wedge D \wedge E$.
  - `validateInputDataIntegrity`: Prevents tampering with input data payloads (e.g. mutating quantity 5 $\to$ 1).
  - `validateWorkflowStepIntegrity`: Prevents skipping or deleting intermediate workflow steps.

### Subsystem 4: Causal Root-Cause Diagnostic Decoupling (`FailureClassifier`)
- **File:** `src/diagnostics/failure-classifier.ts`
- **Capabilities:**
  - Explicit decoupling of `RuntimeSymptom` (`TIMEOUT`, `ACTION_INTERCEPTED`, `ELEMENT_NOT_FOUND`, `ASSERTION_FAILED`) from `CausalRootCause` (`BACKEND_500`, `DYNAMIC_CONTENT_SLOW`, `OBSTRUCTED_ELEMENT`, `LOCATOR_DRIFT`, `AUTH_SESSION_EXPIRED`, `BUSINESS_LOGIC_DEFECT`).
  - Strict fail-closed policy: defects, backend crashes, and unresolvable ambiguities halt repair immediately.

### Subsystem 5: Statistical Verification & Confidence Intervals
- **File:** `src/sandbox/execution-runner.ts`, `benchmarks/flakiness/pie-flake-runner.ts`
- **Capabilities:**
  - Implementation of asymmetric binomial Two-Sided Wilson Score 95% Confidence Intervals.
  - Multi-trial execution runner ($N \ge 5$ / $N \ge 30$) with empirical flakiness elimination.

---

## 2. Bug Fixes & Refinements

- **PowerShell Multiline Execution Hanging:** Resolved PowerShell script hanging by structuring scripts with semicolons or writing dedicated `.ts` runners.
- **Syntactic Diagnostics in Ephemeral Files:** Replaced semantic diagnostics (`getPreEmitDiagnostics`) with syntactic parser diagnostics (`getSyntacticDiagnostics`) on in-memory AST source files, avoiding false-positive missing ambient type errors.
- **Assertion Leading-Whitespace Invariant:** Updated assertion detection regex to strip leading whitespace (`stmt.getText().trim()`), ensuring indented `await expect(...)` statements are rigorously protected.
- **Outer Test Call Filter:** Added explicit exclusion of outer `test('...', ...)` call expressions from inner statement transformations.
- **Container Tree Traversal Object Identity:** Fixed candidate traversal in `findPathToElement` to use strict object reference equality (`root === target`).
- **TypeScript `exactOptionalPropertyTypes: true`:** Added explicit `| undefined` unions to optional interface properties in `DisambiguationContext`.
- **Navigation Sequence Regex:** Added `goto` to `extractActionSequence` regex to ensure full navigation step parity.
- **Optional Property Safety:** Added optional chaining to `context.evidenceCompleteness?.domAvailable`.
