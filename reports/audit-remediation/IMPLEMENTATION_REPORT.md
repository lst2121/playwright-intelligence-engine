# PIE 2.0 — Implementation Report: Statement Repair & Invariant Hardening

**Date:** 2026-11-13  
**Authors:** Principal Software Architect, Senior TypeScript Engineer, AST Specialist  
**Workspace:** `d:\Work\playwright-intelligence-engine`  
**Commit:** `e68f1f3`  

---

## 1. Architectural Overview

To resolve the blocker where statement-level repairs were rejected by Page Object verification rules, PIE 2.0 introduces a dedicated **Statement Repair Invariant Contract ($V_{\text{stmt}}$)** and a **Statement Diff Allowlist Validator (`StatementDiffAllowlistValidator`)**.

This cleanly bifurcates PIE's repair verification into two mathematically sound pipelines:
1. **Page Object Repairs (POM Target):**
   $$V_{\text{pom}} = A_{\text{exact}} \wedge T_{\text{exact}} \wedge F_{\text{exact}} \wedge I \wedge D_{\text{pom}} \wedge E$$
   The test specification file is completely untouched; all fingerprints ($A, T, F$) remain 100% byte-for-byte identical. The Page Object file is verified against `DiffAllowlistValidator`.
2. **Statement-Level Repairs (Spec Target):**
   $$V_{\text{stmt}} = A_{\text{preserved}} \wedge I_{\text{data}} \wedge W_{\text{step}} \wedge D_{\text{stmt}} \wedge E$$
   The test specification file itself is patched. Existing business assertions must be preserved ($A_{\text{preserved}}$), test input payloads cannot be mutated ($I_{\text{data}}$), intermediate action steps cannot be deleted or reordered ($W_{\text{step}}$), diffs must conform to approved statement transformations ($D_{\text{stmt}}$), and execution must pass in an isolated Git worktree ($E$).

---

## 2. Component Implementation Details

### 2.1 Statement Diff Allowlist Validator (`src/repair/diff-allowlist.ts`)

```ts
export class StatementDiffAllowlistValidator {
  private static readonly DISALLOWED_SECURITY_TOKENS = [
    'process.env', 'process.exit', 'child_process', 'require(', 'eval(',
    'exec(', 'spawn(', 'fs.', 'Function(',
  ];

  public static validate(target: StatementDiffAllowlistTarget): StatementDiffAllowlistResult {
    // 1. Prohibit dangerous tokens
    // 2. Verify Imports: Only allow adding expect from @playwright/test
    // 3. Prohibit adding or removing top-level declarations (functions, classes, interfaces, types)
    // 4. Verify test suite blocks: Count and descriptions of test() / test.describe() must match
  }
}
```

- **Security Guarantees:** Prohibits code execution vectors (`eval`, `process`, `child_process`, `fs`).
- **Import Safety:** Permits adding `{ expect }` from `@playwright/test` for readiness waits; strictly forbids importing third-party modules (e.g. `axios`).
- **Structure Safety:** Prohibits adding top-level declarations or modifying test names.

---

### 2.2 Statement Repair Invariant Contract (`src/repair/intent-validator.ts`)

`IntentValidator.validateV2` now detects `target.pattern === 'statement-patch'` and evaluates:

1. **Assertion Preservation ($A_{\text{preserved}}$):**
   ```ts
   const origAssertions = AssertionHasher.extractAssertionRecordsFromSource(origSource);
   const postAssertions = AssertionHasher.extractAssertionRecordsFromSource(patchedSource);
   const postSet = new Set(postAssertions.map((a) => JSON.stringify(a)));
   const assertionsPreserved = origAssertions.every((a) => postSet.has(JSON.stringify(a)));
   if (!assertionsPreserved) {
     throw new AssertionTamperedError(...);
   }
   ```
2. **Input Data Invariant ($I_{\text{data}}$):**
   Upgraded from a fragile regular expression to AST-based traversal of `fill`, `type`, and `selectOption` CallExpressions. Inspects StringLiterals, NumericLiterals, Identifiers (`username`), and PropertyAccessExpressions (`user.password`). Mutating `fill(username)` to `fill(password)` triggers:
   `Input data invariant violated: Action payload mutated from 'username' to 'password'`.
3. **Workflow Step Invariant ($W_{\text{step}}$):**
   Extracts approved action CallExpressions (`click`, `fill`, `type`, `selectOption`, `check`, `uncheck`, `press`, `goto`). Asserts that action count and action sequence remain invariant.
4. **Statement Diff Allowlist ($D_{\text{stmt}}$):**
   Calls `StatementDiffAllowlistValidator.validate({ originalSource, patchedSource })`.
5. **Execution Proof ($E$):**
   Verifies that `executionProof.passed === true`, `exitCode === 0`, and `assertionIntegrityValid !== false`.

---

### 2.3 Worktree Execution Path Integration (`src/repair/repair-planner.ts`)

In `RepairPlanner.executeAndVerifyInWorktree()`:
1. `targetFilePath` resolves to `worktreeSpecPath` for `statement-patch` and `worktreePomPath` for POM patches.
2. The patch is applied strictly inside the isolated Git worktree.
3. Target test executes via `ExecutionRunner.run('npx', { args: ['playwright', 'test', ...] })`.
4. Dynamic assertion integrity is computed:
   ```ts
   if (proposal.pattern === 'statement-patch') {
     const origAssertions = AssertionHasher.extractAssertionRecordsFromSource(proposal.originalSource);
     const postAssertions = AssertionHasher.extractAssertionRecordsFromSource(worktreeSpecSource);
     const postSet = new Set(postAssertions.map((a) => JSON.stringify(a)));
     assertionIntegrityValid = origAssertions.length > 0
       ? origAssertions.every((a) => postSet.has(JSON.stringify(a)))
       : true;
   } else {
     assertionIntegrityValid =
       proposal.originalCompositeFingerprint.assertionFingerprint === postExecCompositeFingerprint.assertionFingerprint;
   }
   ```
5. `IntentValidator.validateV2` is invoked with `pattern: proposal.pattern`, ensuring statement repairs transition to `READY_FOR_APPROVAL`.

---

### 2.4 Assertion Identification & Chaining Hardening (`src/repair/assertion-hasher.ts`)

1. **Aliased Import Discovery:**
   `discoverAssertionIdentifiers(sourceFile)` dynamically discovers all named imports from `@playwright/test` that import `expect` (e.g. `import { expect as verify } from '@playwright/test'`).
2. **Outermost Assertion Call Selection:**
   `isOutermostAssertionCall(callExpr, identifiers)` checks if `callExpr` is an inner receiver of a chained property access invoked by an outer assertion. This ensures `expect(response.status()).toBe(200)` is canonicalized as a single logical assertion, eliminating duplicate records.
3. **Soft & Poll Assertions:**
   Explicitly recognizes `expect.soft(...)` and `expect.poll(...)`.

---

### 2.5 StatementPatcher Collision Hardening (`src/repair/statement-patcher.ts`)

1. **Same-Line Collision Abstention:**
   `selectSingleTargetStatement(candidates, plan, label)` enforces that if multiple matching statements exist on the target line, it throws `AST_AMBIGUOUS_STATEMENT_TARGET` unless uniquely disambiguated by `targetActionSubstring`.
2. **AST-Level Replacement:**
   `executeReplaceInlineLocator` replaces the exact `CallExpression` or `StringLiteral` node in the AST rather than using string substring replacement.
3. **Assertion Tampering Protection:**
   `assertNotAssertion(stmt)` uses discovered assertion identifiers to prevent modifying or wrapping assertion calls.
