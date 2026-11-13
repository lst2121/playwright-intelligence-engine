# PIE 2.0 — Adversarial Invariant Test Suite Results

**Date:** 2026-11-13  
**Auditor:** Adversarial QA Specialist & Security Verification Engineer  
**Test Suite:** `tests/unit/adversarial-invariants-inv.test.ts`  
**Execution Status:** **20/20 PASSED (100%)**  

---

## 1. Adversarial Test Matrix (INV-01 to INV-20)

| ID | Adversarial Scenario / Attack Vector | Required Result | Actual Result / Error Code | Status |
|:---:|---|:---:|---|:---:|
| **INV-01** | Delete existing business assertion | Reject | Throws `AssertionTamperedError` | **PASS** |
| **INV-02** | Modify assertion matcher (`toBeVisible` $\to$ `toBeHidden`) | Reject | `origRecords.every(postSet.has)` evaluates `false` | **PASS** |
| **INV-03** | Mutate expected value (`'$99.00'` $\to$ `'$0.00'`) | Reject | Fingerprints mismatch (`assertionFingerprint` differs) | **PASS** |
| **INV-04** | Mutate variable-based action input (`username` $\to$ `password`) | Reject | `Action payload mutated from 'username' to 'password'` | **PASS** |
| **INV-05** | Remove all input fill operations | Reject | `Input action count changed from 1 to 0` | **PASS** |
| **INV-06** | Inject additional unauthorized business action | Reject | `Test step count changed from 1 to 2` | **PASS** |
| **INV-07** | Reorder workflow actions (swap fill and click) | Reject | `Action sequence altered at step 1 (expected 'fill', found 'click')` | **PASS** |
| **INV-08** | Change logical operator (`&&` $\to$ `\|\|`) in business logic | Reject | `testBodyFingerprint` differs | **PASS** |
| **INV-09** | Aliased Playwright import (`expect as verify`) | Detect & Protect | Extracted canonical assertion record: `{ value: 'Done' }` | **PASS** |
| **INV-10** | Soft assertion (`expect.soft`) | Detect & Protect | Extracted canonical assertion record: `{ expr: 'expect.soft' }` | **PASS** |
| **INV-11** | Polling assertion (`expect.poll`) | Detect & Protect | Extracted canonical assertion record: `{ expr: 'expect.poll' }` | **PASS** |
| **INV-12** | Duplicate matching statements on same line without target line | Abstain | Throws `AST_AMBIGUOUS_STATEMENT_TARGET` | **PASS** |
| **INV-13** | Modify an unrelated statement / inject top-level function | Reject | `Top-level function declarations modified or added` | **PASS** |
| **INV-14** | Modify comments only | Permit | `compositeHash` identical; AST invariant preserved | **PASS** |
| **INV-15** | Formatting-only whitespace change | Permit | `fixtureFingerprint` identical; AST invariant preserved | **PASS** |
| **INV-16** | Evidence-grounded locator replacement with approved grammar | Permit | `validateLocatorGrammar` returns `{ isValid: true }` | **PASS** |
| **INV-17** | Replace Add to Cart button with Delete Account button | Reject | `Target is positive action, candidate has contradictory semantics` | **PASS** |
| **INV-18** | Unsupported network response predicate syntax | Abstain | Throws `AST_SYNTAX_ERROR` / Abstention | **PASS** |
| **INV-19** | Readiness condition target not grounded in AST | Abstain | Throws `AST_STATEMENT_NOT_FOUND` / Abstention | **PASS** |
| **INV-20** | Legitimate synchronization repair end-to-end | Verify | Fully verified; transitions to `READY_FOR_APPROVAL` | **PASS** |

---

## 2. Test Execution Log Summary

```text
 RUN  v5.1.0 D:/Work/playwright-intelligence-engine

 ✓ tests/unit/adversarial-invariants-inv.test.ts (20 tests) 1431ms
   ✓ Phase 10 — Complete Adversarial Invariant Suite (INV-01 to INV-20) (20)
     ✓ INV-01: should reject patch that deletes an existing business assertion
     ✓ INV-02: should reject patch that modifies an assertion matcher
     ✓ INV-03: should reject patch that changes expected assertion value
     ✓ INV-04: should reject patch that mutates variable-based action input
     ✓ INV-05: should reject patch that removes all input fill operations
     ✓ INV-06: should reject patch that injects an unauthorized business action
     ✓ INV-07: should reject patch that reorders workflow actions
     ✓ INV-08: should detect operator change from && to || in test body structure
     ✓ INV-09: should detect and protect aliased Playwright assertions
     ✓ INV-10: should detect and protect expect.soft assertions
     ✓ INV-11: should detect and protect expect.poll assertions
     ✓ INV-12: should strictly abstain when multiple matching statements exist on same line without disambiguation
     ✓ INV-13: should reject diff that modifies an unrelated statement or function
     ✓ INV-14: should permit modifying comments while keeping AST structure identical
     ✓ INV-15: should permit formatting-only whitespace changes without tripping invariants
     ✓ INV-16: should permit evidence-grounded locator replacement matching approved grammar
     ✓ INV-17: should reject substituting Add to Cart action with Delete Account candidate
     ✓ INV-18: should reject/abstain on statement patch that causes syntax errors in response predicates
     ✓ INV-19: should abstain when statement target cannot be located in source
     ✓ INV-20: should complete full verification pipeline for legitimate synchronization repair

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Duration  2.13s
```
