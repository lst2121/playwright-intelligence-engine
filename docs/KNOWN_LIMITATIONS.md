# Known Limitations & Enterprise Operational Boundaries (v2.5)

This document specifies the supported vs. unsupported architectural capabilities, operational boundaries, and deliberate security/safety constraints of the **Playwright Intelligence Engine**.

---

## 1. Capability Classification Matrix

| Capability / Pattern | Status | Engine Behavior & Technical Rationale |
| :--- | :--- | :--- |
| **Static Class Property Initializers** | **Implemented & Tested** | Full surgical AST rewrite via `ts-morph`. Preserves types, modifiers, and comments. |
| **Class Getter Declarations** | **Implemented & Tested** | Rewrites return expression in getter body (`get submitBtn() { return ... }`). |
| **Constructor Locator Assignments** | **Implemented & Tested** | Identifies `this.prop = ...` within class constructors and updates RHS expression. |
| **Parameterless Factory Methods** | **Implemented & Tested** | Rewrites return expression in zero-argument methods. |
| **Dynamic Parameterized Methods** | **Unsupported (Abstains)** | Explicitly throws `AST_PARAMETERIZED_LOCATOR`. Dynamic interpolation (`userRow(id)`) cannot be safely rewritten statically without hardcoding runtime parameters. |
| **Multi-Source Evidence Normalization** | **Implemented & Tested** | Ingests and normalizes live browser listeners, static AST, network events, git diffs, environment metadata, and error stacks. |
| **Live Diagnostic Reproduction (`reproduce`)**| **Implemented & Tested** | Runs failing specs in isolated detached worktrees with live diagnostic hooks attached. |
| **Trace Schemas v7 through v10** | **Implemented & Tested** | Ingests and parses Playwright trace format versions 7, 8, 9, and 10 via adapter registry. |
| **Trace Schemas < v7 (v5, v6) or > v10** | **Unsupported (Abstains)** | Routes to unsupported adapter and triggers `UNSUPPORTED_TRACE_FORMAT`. Prevents corrupted repairs on unverified trace schemas. |
| **Traces Without DOM Snapshots** | **Unsupported (Abstains)** | Triggers `INCOMPLETE_EVIDENCE` abstention. Zero locator repairs permitted without DOM ground truth. |
| **npm Package Manager** | **Implemented & Tested** | Uses `IMMUTABLE_SHARED` strategy with Windows NTFS directory junctions or POSIX symlinks. |
| **pnpm Package Manager** | **Partially Supported** | Resolves `SHARED_MUTABLE` strategy. Emits warning regarding virtual store lock contention during concurrent CI runs. |
| **Yarn Plug'n'Play (PnP)** | **Unsupported** | Rejects worktree creation with `UNSUPPORTED`. PnP virtual filesystems (`.pnp.cjs`) lack physical `node_modules` folders for junction linking. |
| **Shadow DOM (Open)** | **Supported** | Accessible via Playwright open shadow piercing locators (`page.locator('custom-el >> button')`). |
| **Shadow DOM (Closed)** | **Unsupported** | Closed shadow roots cannot be inspected by CDP DOM snapshots or accessibility trees; engine abstains. |
| **Canvas / WebGL Rendering** | **Unsupported** | Internal canvas elements lack DOM representations. Engine abstains from locator healing. |
| **Direct Working Branch Disk Writes** | **Strictly Prohibited** | All repairs execute in isolated Git worktrees. Modifying working branches requires explicit cryptographic approval tokens. |
| **Assertion Modifications** | **Strictly Prohibited** | The engine strictly prohibits modifying test assertions (`expect(...)`). If an assertion fails due to a business defect, the engine reports `ASSERTION_FAILURE` and abstains. |

---

## 2. Dynamic Locator Boundaries

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

## 3. Monorepo and Virtual Filesystem Boundaries

### 3.1. Yarn PnP (`.pnp.cjs`)
Yarn 2+ in Zero-Install or PnP mode intercepts Node's `require` and `import` via an in-memory resolution table without generating a physical `node_modules` directory.
- Because Git worktrees reside in `.pw-intelligence/worktrees/*`, they cannot share a physical junction.
- **Recommendation**: Run Playwright in npm or pnpm mode, or execute repairs in isolated containers.

### 3.2. pnpm Virtual Store Cache Contention
`pnpm` uses hardlinks from a global content-addressable store into `.pnpm/`. When multiple concurrent test runners execute inside isolated worktrees, parallel writes to the pnpm virtual store can cause lock contention on Windows.
- **Recommendation**: For heavy parallel CI pipelines, configure worktrees with isolated store paths.

---

## 4. Multi-Origin IFrame Isolation Boundaries

When an application embeds third-party iframes (e.g., payment gateways or OAuth consent dialogs) hosted on separate origins without cross-origin access:
1. Playwright traces may record actions inside the iframe (`frameId`), but DOM snapshots within closed/sandboxed iframes may be incomplete or redacted by browser security policies.
2. The engine tracks `frameId` on network events and actions. If the iframe DOM is unavailable, `FailureClassifier` triggers `INCOMPLETE_EVIDENCE` rather than proposing broken locators.

---

## 5. Production Safety & Human Governance

1. **Zero Unattended Self-Modification**: The engine is designed as pair-programming and developer-assisted reliability infrastructure. It does not automatically push code to production branches.
2. **Cryptographic One-Time Approval Tokens**: All non-worktree modifications require human review and single-use approval tokens issued by `ApprovalService`.
3. **Fail-Closed Default**: Every intent invariant clause ($A \land T \land F \land I \land D \land E$) must pass affirmatively. Any missing input or failed execution results in an immediate safety abstention.
