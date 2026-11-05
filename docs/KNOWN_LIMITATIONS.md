# Known Limitations & Engineering Boundaries

This document defines the supported vs. unsupported architectural capabilities, operational boundaries, and known limitations of the **Playwright Intelligence Engine** (v2.4).

---

## 1. Capability Classification Matrix

| Capability / Pattern | Status | Engine Behavior & Technical Rationale |
| :--- | :--- | :--- |
| **Static Class Property Initializers** | **Implemented & Tested** | Full AST rewrite support via `ts-morph`. Preserves types and comments. |
| **Class Getter Declarations** | **Implemented & Tested** | Rewrites return expression in getter body. |
| **Constructor Locator Assignments** | **Implemented & Tested** | Identifies left-hand assignment and rewrites locator call. |
| **Parameterless Factory Methods** | **Implemented & Tested** | Rewrites return expression in zero-argument methods. |
| **Standalone Locator Constants** | **Implemented & Tested** | Rewrites exported locator constant expressions. |
| **Dynamic Parameterized Methods** | **Unsupported (Abstains)** | Explicitly throws `AST_PARAMETERIZED_LOCATOR`. Dynamic interpolation (`userRow(id)`) cannot be safely rewritten statically without semantic scoping corruption. |
| **Trace Schemas v7 through v10** | **Implemented & Tested** | Normalized by `V7TraceAdapter`, `V8TraceAdapter`, `V9TraceAdapter`, and `V10TraceAdapter`. |
| **Trace Schemas v5 and v6** | **Omitted / Unsupported** | Omitted pending real Playwright trace fixtures. Routes to `UnknownTraceAdapter` (`1.0.0-unsupported`) and safely abstains. |
| **Trace Schemas > v10 / Future** | **Unsupported (Abstains)** | Routes to `UnknownTraceAdapter` and triggers `UNSUPPORTED_TRACE_FORMAT`. Prevents corrupted repairs on unknown schemas. |
| **MCP Workspace Sandboxing** | **Implemented & Tested** | Strict filesystem boundary enforcement (`assertPathInWorkspace`). Traversal outside workspace root is blocked. |
| **npm Package Manager** | **Implemented & Tested** | Uses `IMMUTABLE_SHARED` strategy with Windows NTFS junctions or POSIX symlinks. |
| **pnpm Package Manager** | **Partially Supported** | Resolves `SHARED_MUTABLE` strategy. Emits warning regarding virtual store mutation risk in concurrent runs. |
| **Yarn Plug'n'Play (PnP)** | **Unsupported** | Rejects worktree creation with `UNSUPPORTED`. PnP virtual filesystems (`.pnp.cjs`) do not have physical `node_modules` folders for junction linking. |
| **Multi-Package Monorepos (Turborepo/Nx)** | **Experimental** | Supported when test project has hoisted dependencies in root `node_modules`. Complex symlink topologies require manual configuration. |
| **In-Band Runtime Interception** | **Deliberately Excluded** | The engine does not provide runtime proxy wrappers. Zero in-band latency is a core architectural tenet. |
| **Collateral AST Mutations** | **Deliberately Prohibited** | `DiffAllowlistValidator` strictly rejects modifications to imports, helper methods, or constructor logic. |

---

## 2. Dynamic Locator Boundaries

Enterprise automation suites occasionally construct locators dynamically at runtime:
```typescript
// UNSUPPORTED EXAMPLE:
class DynamicPage {
  getCellByCoordinates(row: number, col: number) {
    return this.page.locator(`table tbody tr:nth-child(${row}) td:nth-child(${col})`);
  }
}
```

### Why Automated Repair Abstains:
1. **Dynamic Parameter Dependencies**: A static post-mortem trace shows the element resolved for *one specific invocation* (e.g. `row=3, col=5`). Rewriting the method body using that specific snapshot would hardcode coordinates, breaking all other calls that pass `row=1` or `row=2`.
2. **Scoping Safety**: Parameterized locators represent programmatic algorithms, not static locators.
3. **Engine Action**: The engine generates a detailed diagnostic report identifying the failing row/col and recommends the developer adjust the dynamic template manually.

---

## 3. Monorepo and Virtual Filesystem Boundaries

### 3.1. Yarn PnP (`.pnp.cjs`)
Yarn 2+ in Zero-Install or PnP mode intercepts Node's `require` and `import` via an in-memory resolution table without generating a physical `node_modules` directory.
- Because Git worktrees reside in `.pw-intelligence/worktrees/*`, they cannot share a physical junction.
- **Recommendation**: Run Playwright in npm or pnpm mode, or run repairs in dry-run mode (`pw-intel repair --dry-run`).

### 3.2. pnpm Virtual Store Cache Contention
`pnpm` uses hardlinks from a global content-addressable store into `.pnpm/`. When multiple concurrent test runners execute inside isolated worktrees, parallel writes to the pnpm virtual store can cause lock contention on Windows.
- **Recommendation**: For heavy parallel CI pipelines, configure worktrees with isolated store paths.

---

## 4. Windows File Locking (`EBUSY` / `EPERM`)

On Windows, background processes (such as Windows Defender, search indexers, or spawned child processes that did not exit immediately) can hold locks on open files in `.pw-intelligence/worktrees/*`.
- The engine mitigates this via process tracking (`isProcessAlive`), pre-unlink of NTFS directory junctions, and exponential retry backoffs.
- If a worktree directory remains locked after 5 retries, the engine records it in `.pw-intelligence/worktrees/registry.json` as `ORPHANED` and defers final deletion to the next `pw-intel audit` cycle.

---

## 5. MCP Server Boundaries & Security Guardrails

The Model Context Protocol (MCP) server exposes diagnostic and repair capabilities over JSON-RPC 2.0 stdio:
1. **Workspace Root Confinement**: All file path parameters (`tracePath`, `pageObjectPath`, `specPath`) are strictly verified via `assertPathInWorkspace`. Path traversals attempting to read or patch files outside `workspaceRoot` are immediately blocked with JSON-RPC error `-32000`.
2. **Tool Parameter Schema Validation**: Missing or malformed parameters are rejected upfront before invoking engine subsystems.
3. **Restricted Repair Mutation**: The `repair_page_object` tool strictly validates replacement expressions against `validateLocatorGrammar` and the AST Diff Allowlist before applying changes. Arbitrary code, extra statements, semicolons, or helper functions are rejected.
4. **No Autonomous Direct-to-Main Modification**: In standard operation, repairs must undergo isolated worktree test execution. MCP tools do not permit unverified in-place file rewrites without valid locator grammar and diff allowlist verification.

