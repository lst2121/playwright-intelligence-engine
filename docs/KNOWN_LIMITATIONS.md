# Known Limitations & Enterprise Operational Boundaries (v3.0)

This document specifies the supported vs. unsupported architectural capabilities, operational boundaries, and deliberate security/safety constraints of the **Playwright Intelligence Engine (PIE)**.

---

## 1. Capability Classification Matrix

| Capability / Pattern | Status | Engine Behavior & Technical Rationale |
| :--- | :--- | :--- |
| **Static Class Property Initializers** | **Supported** | Full surgical AST rewrite via `ts-morph`. Preserves types, modifiers, and comments. |
| **Class Getter Declarations** | **Supported** | Rewrites return expression in getter body (`get submitBtn() { return ... }`). |
| **Constructor Locator Assignments** | **Supported** | Identifies `this.prop = ...` within class constructors and updates RHS expression. |
| **Parameterless Factory Methods** | **Supported** | Rewrites return expression in zero-argument methods. |
| **Dynamic Parameterized Methods** | **Unsupported (Abstains)** | Explicitly throws `AST_PARAMETERIZED_LOCATOR`. Dynamic interpolation (`userRow(id)`) cannot be safely rewritten statically without hardcoding runtime parameters. |
| **Multi-Source Evidence Normalization** | **Supported** | Ingests and normalizes live browser listeners, static AST, network events, git diffs, environment metadata, and error stacks. |
| **Live Diagnostic Reproduction (`reproduce`)**| **Supported** | Runs failing specs in isolated detached worktrees with live diagnostic hooks attached. |
| **Trace Schemas v7 through v10** | **Supported** | Ingests and parses Playwright trace format versions 7, 8, 9, and 10 via adapter registry. |
| **Trace Schemas < v7 (v5, v6) or > v10** | **Unsupported (Abstains)** | Routes to unsupported adapter and triggers `UNSUPPORTED_TRACE_FORMAT`. Prevents corrupted repairs on unverified trace schemas. |
| **Traces Without DOM Snapshots** | **Unsupported (Abstains)** | Triggers `INCOMPLETE_EVIDENCE` abstention. Zero locator repairs permitted without DOM ground truth. |
| **npm Package Manager** | **Supported** | Uses `IMMUTABLE_SHARED` strategy with Windows NTFS directory junctions or POSIX symlinks. |
| **pnpm Package Manager** | **Partially Supported** | Resolves `SHARED_MUTABLE` strategy. Emits warning regarding virtual store lock contention during concurrent CI runs. |
| **Yarn Plug'n'Play (PnP)** | **Unsupported (Abstains)** | Rejects worktree creation with `UNSUPPORTED`. PnP virtual filesystems (`.pnp.cjs`) lack physical `node_modules` folders for junction linking. |
| **Shadow DOM (Open)** | **Supported** | Accessible via Playwright open shadow piercing locators (`page.locator('custom-el >> button')`). |
| **Shadow DOM (Closed)** | **Unsupported (Abstains)** | Closed shadow roots cannot be inspected by CDP DOM snapshots or accessibility trees; engine abstains. |
| **Canvas / WebGL Rendering** | **Unsupported (Abstains)** | Internal canvas elements lack DOM representations. Engine abstains from locator healing. |
| **Direct Working Branch Disk Writes** | **Strictly Prohibited** | All repairs execute in isolated Git worktrees. Modifying working branches requires explicit cryptographic approval tokens. |
| **Assertion Modifications** | **Strictly Prohibited** | Strict assertion preservation: zero assertion weakenings or deletions ($V = A \land T \land F \land I \land D \land E$). Any change to an `expect()` assertion causes immediate gate rejection. |

---

## 2. Decoupled Author / Gate Operational Boundaries

PIE v3.0 splits code authoring from verification gates. The author proposes; the gate proves.

```
┌─────────────────────────────────────────────────────────────────┐
│ AUTHOR LAYER (TemplateAuthor, HybridAuthor, LLMAuthor)          │
│ • Emits CandidateChange (symbol table & code modifications)     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ GATE LAYER (runGate)                                            │
│ • SafetyGate: Invariants V = A ∧ T ∧ F ∧ I ∧ D ∧ E             │
│ • QualityGate: NamingLinter (0 index-derived), diff minimality   │
│ • OracleGate: Intent verification, never marks absent as true   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Bounded Generation Agent Loop
The generation agent executes in a strictly bounded iterative loop:
- **Max Correction Steps**: 3 steps maximum.
- **Max Time Budget**: 120 seconds maximum.
- **Progress Tracking**: If the gate produces identical violations across consecutive iterations without diagnostic improvement, the agent transitions to `AGENT_NO_PROGRESS` and abstains immediately. It never loops indefinitely or consumes unbounded token budgets.

### 2.2 Strict Naming & Quality Gate Enforcement
- **Index-Derived Identifier Ban**: Any identifier matching `/^(actionButton|inputField|button|input)\d+$/` is strictly rejected with a fatal `QualityGate` violation.
- **Intent Oracles**: Evaluates whether candidate changes contradict user or business intent. If evidence is ambiguous, the Oracle evaluates to `unavailable` or `contradicted`, never `verified`.

---

## 3. Dynamic Locator Boundaries

Enterprise automation suites occasionally construct locators dynamically at runtime:
```typescript
// UNSUPPORTED PATTERN:
class DynamicPage {
  getCellByCoordinates(row: number, col: number) {
    return this.page.locator(`table tbody tr:nth-child(${row}) td:nth-child(${col})`);
  }
}
```

### Why Automated Repair Must Abstain:
1. **Dynamic Parameter Overfitting**: A post-mortem trace reveals the element resolved for *one specific invocation* (e.g. `row=3, col=5`). Replacing the method body with that specific snapshot would hardcode coordinates, causing subsequent calls with `row=1` or `row=2` to fail.
2. **Scoping Safety**: Parameterized locators represent programmatic algorithms, not static locators.
3. **Engine Action**: The engine generates a detailed diagnostic report identifying the failing row/col and recommends the developer adjust the dynamic template manually.

---

## 4. Multi-Origin IFrame Isolation Boundaries

When an application embeds third-party iframes (e.g., payment gateways or OAuth consent dialogs) hosted on separate origins without cross-origin access:
1. Playwright traces may record actions inside the iframe (`frameId`), but DOM snapshots within closed/sandboxed iframes may be incomplete or redacted by browser security policies.
2. The engine tracks `frameId` on network events and actions. If the iframe DOM is unavailable, `FailureClassifier` triggers `INCOMPLETE_EVIDENCE` rather than proposing broken locators.

---

## 5. Multi-Browser Environment Prerequisites

When running regression checks or multi-project benchmark suites (e.g. against Chromium, Firefox, and WebKit):
1. **Locally Installed Browser Binaries**: Each project configured in `playwright.config.ts` requires the matching browser binary installed via `npx playwright install`.
2. **Fail-Closed Isolation**: If a requested browser binary is missing on the host OS, child process execution fails closed (`isReadyForApproval: false`), preventing false-positive repairs. Users can isolate the target browser by passing `--project <name>` (e.g. `--project chromium`).

---

## 6. Production Safety & Human Governance

1. **Zero Unattended Self-Modification**: PIE acts as a rigorous pair-programming engine and deterministic verification harness. It never pushes changes to production git branches without human review.
2. **Cryptographic Approval Tokens**: All non-worktree modifications require human review and single-use HMAC approval tokens issued by `ApprovalService`.
3. **Fail-Closed Default**: Every clause of the Intent Invariant ($A \land T \land F \land I \land D \land E$) must pass affirmatively. Any missing input or failed execution results in an immediate safety abstention.
