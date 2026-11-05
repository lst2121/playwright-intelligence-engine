# Intent Invariants Specification (v2.4 Remediated)

This document provides the formal mathematical and structural specification for **Intent Invariants v2**, the safety engine governing all code modifications in **Playwright Intelligence Engine**.

---

## 1. The Core Problem: Why Assertion Fingerprinting Alone Fails

In earlier heuristic auto-healing engines, candidate patches were evaluated solely by whether the test passed afterwards or by hashing `expect(...)` statements ($A$).

As proven in our architectural review, assertion fingerprinting alone is vulnerable to multiple attack vectors:
1. **Fixture Mutation Attack**: Altering input test data (e.g. changing an invalid payment payload into a valid one) so a broken test passes green.
2. **Control Flow & Operator Attack**: Inserting negations (e.g. `if (!user.isActive)`) or wrapping actions in unreachable blocks while assertions remain structurally present.
3. **Semantic Target Swapping Attack**: Repointing a failing locator for an affirmative business action (e.g. `submitButton = page.locator('#submit')`) to an opposing action (e.g. `submitButton = page.locator('#cancel')`).
4. **Collateral AST Injection**: Modifying imports, adding helper functions, or altering class constructors to bypass validation.

---

## 2. Formal Composite Invariant Formulation

To establish an uncircumventable safety guarantee, Playwright Intelligence Engine enforces the composite invariant $V$:

$$V = A \land T \land F \land I \land D \land E$$

All six predicates must evaluate to `true` with affirmative proof. **The validator is strictly fail-closed: no clause may default to true if evidence or execution proof is omitted.**

```mermaid
flowchart TD
    Candidate[Proposed Locator Repair] --> A{"A: Assertion Fingerprint\nExact String Literals & Matchers Unchanged?"}
    A -- No --> Reject["ABSTAIN:\nASSERTION_TAMPERED"]
    A -- Yes --> T{"T: Structural Test Body\nStatement sequence, operators & flow preserved?"}
    T -- No --> Reject2["ABSTAIN:\nCONTROL_FLOW_ALTERED"]
    T -- Yes --> F{"F: Critical Fixtures\nKey-Value pairings & literals unmodified?"}
    F -- No --> Reject3["ABSTAIN:\nFIXTURE_TAMPERED"]
    F -- Yes --> I{"I: Target Identity\nAction Semantics & Non-Contradictory Identity?"}
    I -- No --> Reject4["ABSTAIN:\nSEMANTIC_MISMATCH"]
    I -- Yes --> D{"D: Diff Allowlist\nComplete AST check: ONLY designated locator changed?"}
    D -- No --> Reject5["ABSTAIN:\nCOLLATERAL_AST_MODIFICATION"]
    D -- Yes --> E{"E: Worktree Execution\nTest discovered & passed (exitCode == 0, count > 0)?"}
    E -- No --> Reject6["ABSTAIN:\nEXECUTION_VERIFICATION_FAILED"]
    E -- Yes --> Authorize["REPAIR AUTHORIZED\nSigned Evidence Record Generated"]
```

---

## 3. Predicate Details & Remediation Safeguards

### 3.1. $A$: Semantic Assertion Fingerprint
- Identifies assertion API calls semantically (`expect()`, `expect.soft()`, `expect.poll()`, chained matchers).
- **Exact Literal Whitespace Preservation**:
  Normalization collapses formatting whitespace around punctuation but **strictly preserves exact whitespace and text inside string literals**. For example, `expect(msg).toHaveText('Payment  failed')` and `expect(msg).toHaveText('Payment failed')` produce distinct hashes.
- Matches argument counts, matcher names, and argument order.

### 3.2. $T$: Structural Test Body & Operator Invariant
- Captures sequential statement order and control flow (`IfStatement`, `ForStatement`, `WhileStatement`, `TryStatement`).
- **Operator & Condition Sensitivity**:
  Fingerprints binary operators, unary operators (e.g. `!user.isActive` vs `user.isActive`), condition expressions, and non-assertion call expressions.

### 3.3. $F$: Ordered Fixture & Input Dependency Invariant
- Fingerprints property assignments with explicit key-value associations (`Prop:username='admin'`, `Prop:role='alice'`).
- Does **not** sort away associations. Swapping `{ username: 'admin', role: 'alice' }` with `{ username: 'alice', role: 'admin' }` produces distinct hashes.

### 3.4. $I$: Independent Target Identity & Action Semantics
- Validates that the candidate element tag and role support the intended action (e.g. `click` requires button/link/tab/menuitem; `fill` requires input/textarea/textbox).
- **Hard Anti-Affinity Check**:
  Rejects candidates with opposing business semantics. If the original locator targets confirmation/submission actions (`submit`, `login`, `checkout`, `pay`, `save`, `order`), a candidate with cancellation semantics (`cancel`, `close`, `reset`, `abort`, `back`, `dismiss`) is strictly rejected.
- Requires affirmative token overlap or test ID match when original selector is provided.

### 3.5. $D$: Full-File AST Diff Allowlist (`DiffAllowlistValidator`)
- Compares the complete source-file AST before and after patching:
  - Top-level declarations (imports, functions, variables, interfaces, type aliases, enums) must be identical.
  - Class structure (property count, method count, getter/setter count, constructor count, heritage clauses) must match.
  - Exactly one designated member initializer is permitted to change.
  - **Locator Grammar Validation**: The replacement expression is parsed into an AST and validated against approved Playwright locator methods (`locator`, `getByRole`, `getByText`, `getByTestId`, `getByLabel`, `getByPlaceholder`, `filter`). Multiple statements, semicolons, function declarations, and arbitrary executable code are rejected.

### 3.6. $E$: Isolated Worktree Execution Verification
- Test must execute inside an isolated Git worktree (`ExecutionRunner.run`).
- Execution output is parsed to verify that the intended test was discovered and actually passed (`exitCode === 0 && passedCount > 0 && !timedOut`).
- `executionPassed` must be boolean `true`. Missing execution evidence in strict mode triggers immediate rejection.
