# PIE 2.0 — Statement-Level Autonomous Repair Verification Report

**Date:** 2026-11-13  
**Verified By:** Principal Software Architect & Playwright Automation Architect  
**Workspace:** `d:\Work\playwright-intelligence-engine`  
**Test Spec:** `tests/unit/statement-repair-worktree.test.ts`  

---

## 1. Executive Summary

This report documents the end-to-end execution and validation of statement-level repairs within the Playwright Intelligence Engine (PIE) 2.0. It confirms that the integration blocker previously rejecting statement patches has been fully eliminated through the **Statement Repair Invariant Contract ($V_{\text{stmt}}$)** and **`StatementDiffAllowlistValidator`**.

Legitimate statement repairs now pass the entire autonomous repair pipeline:
$$\text{Diagnosis} \to \text{Plan} \to \text{Worktree Patch} \to \text{Diff Allowlist} \to \text{Execution Proof} \to \text{Invariant Contract} \to \text{READY\_FOR\_APPROVAL}$$

---

## 2. Complete Execution Trace of a Statement Repair

### Stage 1: Diagnostic Context & Flaw Identification
The original test specification contains an arbitrary fixed sleep causing flaky execution:
```ts
import { test, expect } from '@playwright/test';

test('item search', async ({ page }) => {
  await page.goto('/catalog');
  await page.waitForTimeout(1000); // <-- Flaw: Arbitrary sleep
  await page.locator('#search').fill('laptop');
  await page.locator('#submit').click();
  await expect(page.locator('.results')).toBeVisible();
});
```
Failure classifier identifies `ARBITRARY_SLEEP_FLAKINESS` and recommends event-driven readiness synchronization.

### Stage 2: Proposal Synthesis (`RepairPlanner.planStatementRepair`)
```ts
const proposal = RepairPlanner.planStatementRepair({
  originalActionId: 'call@sleep',
  originalSelector: 'await page.waitForTimeout(1000);',
  testFilePath: specPath,
  plan: {
    kind: 'replace-timeout-with-wait',
    replacementWaitStatement: "await expect(page.locator('#search-indicator')).toBeVisible({ timeout: 5000 });",
  },
});
```
- Pattern: `statement-patch`
- Target: Test specification AST
- In-memory diff generated via `StatementPatcher`

### Stage 3: Isolated Git Worktree Patching
Patch is applied strictly within an isolated Git worktree:
- Pristine repository remains completely untouched.
- `worktreeSpecPath` is atomically written.
- State: `PATCHED_IN_ISOLATION`.

### Stage 4: Statement Diff Allowlist Verification
`StatementDiffAllowlistValidator.validate()` checks:
- Prohibited tokens (`process.exit`, `eval`, `require`, `child_process`): **0 found** (PASS)
- Imports: `{ expect }` from `@playwright/test` authorized (PASS)
- Top-level declarations: 0 added (PASS)
- Test suite structure: Test name `'item search'` preserved (PASS)
- Result: `diffAllowlistPassed = true`.

### Stage 5: Playwright Execution in Worktree
Execution runs inside the isolated worktree:
`npx playwright test search.spec.ts`
- Exit Code: `0`
- Passed tests: `1 passed`
- Timed out: `false`
- Execution proof generated with cryptographic diff hash.

### Stage 6: Invariant Contract Evaluation ($V_{\text{stmt}}$)
1. **Assertion Preservation ($A_{\text{pres}}$):**
   - Original business assertion: `await expect(page.locator('.results')).toBeVisible();`
   - Patched spec assertions: `[#search-indicator toBeVisible, .results toBeVisible]`
   - Original assertion is strictly preserved verbatim: **PASS**
2. **Input Data Invariant ($I_{\text{data}}$):**
   - Payload `'laptop'` preserved: **PASS**
3. **Workflow Step Invariant ($W_{\text{step}}$):**
   - Action sequence `['fill', 'click']` preserved: **PASS**
4. **Statement Diff Allowlist ($D_{\text{stmt}}$):**
   - Authorized transformation: **PASS**
5. **Execution Verification ($E$):**
   - Test passed in worktree: **PASS**

### Stage 7: Promotion to Ready for Approval
Proposal transitions cleanly to:
`state: 'READY_FOR_APPROVAL'`  
`isReadyForApproval: true`  
`repairedSuccessfully: true`

---

## 3. Negative Scenarios & Falsification Resistance

The pipeline was subjected to adversarial mutations to verify fail-closed behavior:

| Mutation Attempt | Invariant Guard | System Response | Outcome |
|---|---|---|:---:|
| Delete business assertion | $A_{\text{pres}}$ | Throws `AssertionTamperedError` | **REJECTED** |
| Alter expected text | $A_{\text{pres}}$ | Assertion fingerprint mismatch | **REJECTED** |
| Change input payload `'laptop'` to `'phone'` | $I_{\text{data}}$ | `Input data invariant violated: Action payload mutated` | **REJECTED** |
| Mutate variable argument `fill(username)` $\to$ `fill(password)` | $I_{\text{data}}$ | `Action payload mutated from 'username' to 'password'` | **REJECTED** |
| Reorder steps (click before fill) | $W_{\text{step}}$ | `Action sequence altered at step 1` | **REJECTED** |
| Delete intermediate step | $W_{\text{step}}$ | `Test step count changed from 2 to 1` | **REJECTED** |
| Inject `process.exit(1)` | $D_{\text{stmt}}$ | `Prohibited security token 'process.exit' introduced` | **REJECTED** |
| Inject third-party import `import axios from 'axios'` | $D_{\text{stmt}}$ | `Unauthorized new import of module 'axios'` | **REJECTED** |
| Duplicate statement collision on same line | `StatementPatcher` | `AST_AMBIGUOUS_STATEMENT_TARGET` | **ABSTAINED** |
| Playwright test fails in worktree ($exitCode = 1$) | $E$ | State transitions to `REJECTED` | **REJECTED** |

---

## 4. Conclusion

Statement-level repairs in PIE 2.0 are now mathematically bounded, fail-closed, and empirically verifiable.
