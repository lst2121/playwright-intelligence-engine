# PIE 2.0 — Phase 0 Baseline Audit Report

**Date:** 2026-11-13  
**Auditor:** Principal Software Architect & Release Engineering Team  
**Workspace:** `d:\Work\playwright-intelligence-engine`  
**Baseline Git Commit:** `5f1c6c7` (Branch: `feature/evidence-driven-generation`)  
**Package Version:** `2.0.0`  

---

## 1. Executive Summary

This baseline audit document records the technical state of the Playwright Intelligence Engine (PIE) prior to the statement-level repair verification closure. It confirms the exact defects, architectural bottlenecks, passing and failing components, and integration gaps identified in the external code review.

---

## 2. Identified Defect Catalog & Root Cause Analysis

### Defect 1: Critical Integration Blocker in Statement-Level Repair Verification
- **Severity:** P0 (Critical Blocker)
- **Component:** `src/repair/repair-planner.ts`, `src/repair/intent-validator.ts`, `src/repair/diff-allowlist.ts`
- **Symptom:** Although `RepairPlanner.planStatementRepair()` created valid `statement-patch` proposals, any attempt to run them through `executeAndVerifyInWorktree()` failed with invariant or security violations.
- **Root Cause:**
  1. `executeAndVerifyInWorktree()` routed proposals into `IntentValidator.validateV2()`, which evaluated `validateProposal()` against the modified test specification.
  2. `validateProposal()` required exact fingerprint identity ($A_{\text{post}} \equiv A_{\text{orig}}$, $T_{\text{post}} \equiv T_{\text{orig}}$, $F_{\text{post}} \equiv F_{\text{orig}}$). Because statement repairs deliberately transform inline waits, event synchronization, or locators, $T$ and $A$ fingerprints changed, triggering `IntentInvariantViolationError('TestBodyStructure')` or `AssertionTamperedError`.
  3. `DiffAllowlistValidator.validate()` was designed for Page Object Model classes. It searched for `class InlineSpec` (from `proposal.className = 'InlineSpec'`), failed to find it in the test spec AST, and threw `UnauthorizedAstModificationError`.
  4. In `repair-planner.ts` line 302, `assertionIntegrityValid` strictly compared `proposal.originalCompositeFingerprint.assertionFingerprint === postExecCompositeFingerprint.assertionFingerprint`. Legitimate synchronization assertions (e.g. `expect(locator).toBeVisible({ timeout: 5000 })`) added by the repair were rejected as assertion tampering.
- **Test Gap:** `tests/unit/phase2-repair.test.ts` only asserted proposal generation in memory; it never passed the proposal to `executeAndVerifyInWorktree()`.

### Defect 2: Assertion Identification Fragility & Chained Assertion Double-Counting
- **Severity:** P1 (High)
- **Component:** `src/repair/assertion-hasher.ts`
- **Symptom:** Tests with aliased imports (`import { expect as verify } from '@playwright/test'`) had assertions ignored. Chained matchers (`expect(res.status()).toBe(200)`) were recorded as two separate assertion nodes during AST traversal.
- **Root Cause:**
  1. `isAssertionCall()` matched expressions against hardcoded `^expect` regex, missing aliased imports.
  2. AST traversal visited both the inner `CallExpression` (`expect(...)`) and outer `CallExpression` (`.toBe(...)`), creating duplicate partial records.

### Defect 3: Variable-Based Input Data Bypass
- **Severity:** P1 (High)
- **Component:** `src/repair/intent-validator.ts`
- **Symptom:** Variable arguments in `.fill(username)` were not fingerprinted by `validateInputDataIntegrity`.
- **Root Cause:** The regex `/\.(fill|type|selectOption)\(\s*(['"`][^'"`]+['"`]|\d+)\s*\)/g` only matched quoted string literals or digit literals. Identifiers like `username` or `user.password` were completely missed.

### Defect 4: StatementPatcher Collision on Shared Lines
- **Severity:** P2 (Medium)
- **Component:** `src/repair/statement-patcher.ts`
- **Symptom:** If multiple matching statements existed on the same line (e.g. `page.click('#a'); page.click('#b')`), providing `targetLine` resulted in arbitrarily selecting the first statement without disambiguation.

### Defect 5: Repository Evidence Ledger vs Report Reconcilation
- **Severity:** P2 (Documentation & Reporting)
- **Component:** `reports/phase-9/FULL_TESTBED_EVALUATION.md`, `reports/final/FINAL_ACCEPTANCE_REPORT.md`
- **Symptom:** Evaluation reports did not clearly distinguish between statically profiled repositories (16 surveyed in `D:\Work\pie-real-repository-testbed`) and live automated testbeds (`juice-shop`, `twenty`, `logistic-web`) actively configured in scripts.

---

## 3. Baseline Verification Commands & Results

| Check / Command | Expected | Baseline Outcome | Status |
|---|---|---|:---:|
| `npm run typecheck` | 0 errors | 0 errors across 3 tsconfigs | PASS |
| `npm run build` | Clean `dist/index.js` | 828.41 KB `dist/index.js` generated | PASS |
| `npm test` | 100% passing tests | 64/64 test files passed, 623/623 tests passed | PASS |
| `npm run verify:all` | 10/10 gates OK | 10/10 checks OK | PASS |
| `git status` | Clean working tree | Clean at commit `5f1c6c7` | PASS |

---

## 4. Required Remediation Plan

1. Implement dedicated `StatementDiffAllowlistValidator` in `src/repair/diff-allowlist.ts`.
2. Implement Statement Repair Invariant Contract ($V_{\text{stmt}}$) in `src/repair/intent-validator.ts`.
3. Update `RepairPlanner.executeAndVerifyInWorktree` to support statement patches.
4. Harden `AssertionHasher` with aliased import discovery and outermost call canonicalization.
5. Upgrade `validateInputDataIntegrity` to AST traversal covering variable arguments.
6. Disambiguate same-line collisions in `StatementPatcher`.
7. Author end-to-end integration and 20-scenario adversarial invariant test suites.
8. Reconcile repository evidence matrix.
