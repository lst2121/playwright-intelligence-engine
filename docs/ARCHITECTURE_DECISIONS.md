# Architecture Decision Records (ADRs)

This document formalizes the key architectural decisions governing the design, implementation, safety mechanisms, and verification procedures of the **Playwright Intelligence Engine (pw-intel)**.

---

## Index of Decisions

- [ADR-001: Intent Invariant Formulation v2](#adr-001-intent-invariant-formulation-v2)
- [ADR-002: Strict Element Uniqueness Gate ($matchCount === 1$)](#adr-002-strict-element-uniqueness-gate-matchcount--1)
- [ADR-003: Causal Evidence Graph and Telemetry Filtering](#adr-003-causal-evidence-graph-and-telemetry-filtering)
- [ADR-004: Versioned Trace Adapters and Snapshot Provenance](#adr-004-versioned-trace-adapters-and-snapshot-provenance)
- [ADR-005: Dependency Isolation Strategy across Package Managers](#adr-005-dependency-isolation-strategy-across-package-managers)
- [ADR-006: Rejection of Parameterized and Dynamic AST Locators](#adr-006-rejection-of-parameterized-and-dynamic-ast-locators)
- [ADR-007: Human-in-the-Loop Active Branch Safety Guardrail](#adr-007-human-in-the-loop-active-branch-safety-guardrail)
- [ADR-008: Out-of-Band Post-Mortem Trace Analysis (Zero Runtime Latency)](#adr-008-out-of-band-post-mortem-trace-analysis-zero-runtime-latency)

---

## ADR-001: Intent Invariant Formulation v2

### Status
Accepted & Implemented

### Context
In early self-healing engines, proposed code fixes were evaluated merely by whether the test passed afterwards. Later revisions in v2.3 introduced assertion fingerprinting ($A$), hashing all `expect()` calls. However, as demonstrated in our architectural audit, assertion fingerprinting alone does not prove intent:
1. An agent could alter input fixture values (e.g. changing an order quantity from 10 to 1) so an assertion passes for the wrong reason.
2. An agent could remove preparatory test steps or conditional branches.
3. An agent could repoint a locator to a different semantic target (e.g. repointing a failing "Submit Order" button to a "Cancel" button).

### Decision
Formulate and enforce a 6-dimensional composite intent invariant:
$$V = A \land T \land F \land I \land D \land E$$

Where:
- **$A$ (Assertion Fingerprint)**: AST hash of all assertion expressions, canonicalized to ignore formatting, indentation, and comments.
- **$T$ (Structural Test Body Invariant)**: Verifies the sequential statement structure of the test body is preserved.
- **$F$ (Critical Fixture Invariant)**: Fingerprints test literals, arguments, and input constants.
- **$I$ (Target Identity & Action Semantics)**: Verifies the repaired locator points to an element whose accessible role, text, or test ID matches the intended semantic action.
- **$D$ (Diff Allowlist AST Validator)**: Prohibits any changes outside the targeted locator property. Rejects modified imports, extra methods, or altered constructors.
- **$E$ (Execution Invariant)**: Requires clean execution of the test in an isolated Git worktree.

### Consequences
- Prevents defect masking: The engine cannot force a broken test green by modifying test logic.
- Guarantees zero collateral code damage.

---

## ADR-002: Strict Element Uniqueness Gate ($matchCount === 1$)

### Status
Accepted & Implemented

### Context
Playwright enforces strict mode: any locator resolving to more than one element throws a runtime `strict mode violation: locator(...) resolved to 2 elements`.
In v2.3, the candidate uniqueness score was calculated as $U = 1 / matchCount$, and checked against `U < 0.5`. When an element matched exactly 2 elements, $U = 0.5$, which passed the check! This boundary condition allowed ambiguous candidates to proceed into repair planning, resulting in flaky repairs.

### Decision
Implement a strict hard gate:
```typescript
if (candidate.matchCount !== 1 && !candidate.parentScopeVerified) {
  return {
    shouldAbstain: true,
    reason: AbstentionReason.NON_UNIQUE_CANDIDATE,
    diagnostic: `Candidate locator resolved to ${candidate.matchCount} elements in DOM. Strict uniqueness requires exactly 1 match.`
  };
}
```

### Consequences
- Completely eliminates Playwright strict-mode violations caused by self-healed locators.
- Ambiguous locators are rejected upfront with high-signal diagnostic guidance.

---

## ADR-003: Causal Evidence Graph and Telemetry Filtering

### Status
Accepted & Implemented

### Context
Modern web applications trigger dozens of third-party background network requests (Google Analytics, Sentry, Datadog, marketing beacons). When these third-party endpoints return 500, 429, or network errors, naive correlators correlate the HTTP error with the test failure timestamp and incorrectly classify the failure as `BACKEND_500`. This halted automated repairs for legitimate, fixable locator drift.

### Decision
Implement a **Causal Evidence Graph** in `EvidenceCorrelator`:
1. Filter out known telemetry domains (`google-analytics.com`, `sentry.io`, `datadoghq.com`, etc.) and endpoints (`/metrics`, `/beacon`, `/favicon.ico`).
2. Only classify as `BACKEND_500` if the failed request originated from the target application origin or primary API route and occurred in causal sequence with the failing Playwright action.

### Consequences
- Eliminates false-positive backend error diagnoses caused by noisy telemetry.
- Accurately isolates true application API failures.

---

## ADR-004: Versioned Trace Adapters and Snapshot Provenance

### Status
Accepted & Implemented

### Context
Playwright trace formats evolve across releases (schema version v7/v8 in Playwright 1.30–1.39, v9 in 1.40–1.44, and v10 in 1.45+). Monolithic trace parsers break when internal event structures change or when snapshots are incomplete.

### Decision
1. Implement a `TraceAdapterRegistry` with distinct versioned adapters (`V8TraceAdapter`, `V9TraceAdapter`, `V10TraceAdapter`).
2. Handle unknown or future trace versions via `UnknownTraceAdapter`, which safely abstains with `UNSUPPORTED_TRACE_FORMAT`.
3. Snapshot resolution returns a `ResolvedSnapshot` structure with provenance tracking (`frameId`, `callId`, `phase`) and completeness classification (`COMPLETE`, `PARTIAL`, `UNAVAILABLE`).

### Consequences
- Backward and forward compatibility across Playwright versions.
- Safe abstention when trace artifacts are incomplete or corrupt.

---

## ADR-005: Dependency Isolation Strategy across Package Managers

### Status
Accepted & Implemented

### Context
Detached Git worktrees need access to `node_modules`. Running full `npm install` in each worktree takes 30–90 seconds. While NTFS directory junctions (`junction`) on Windows allow zero-install sharing, different package managers have differing storage mechanics:
- `pnpm` uses a shared virtual store (`.pnpm`) where concurrent modifications can cause race conditions.
- `yarn pnp` uses virtual filesystems (`.pnp.cjs`) without physical `node_modules` folders.
- Windows file locks (`EBUSY`/`EPERM`) can prevent worktree teardown, and naive `rmdir` can inadvertently wipe root dependencies.

### Decision
1. Implement `DependencyStrategyResolver`:
   - `npm`: Maps to `IMMUTABLE_SHARED`, uses directory junctions, and verifies process termination prior to unlinking.
   - `pnpm`: Maps to `SHARED_MUTABLE`, warns of cache mutation risks.
   - `yarn pnp`: Rejects with `UNSUPPORTED` and provides clear error guidance.
2. Junction Safety: The engine explicitly unlinks NTFS junctions *before* calling `git worktree remove --force`.
3. Exponential Backoff: Worktree deletion handles Windows `EBUSY` locks with exponential retry backoff.

### Consequences
- Sub-second worktree creation and teardown.
- Zero risk of root `node_modules` corruption or deletion.

---

## ADR-006: Rejection of Parameterized and Dynamic AST Locators

### Status
Accepted & Implemented

### Context
Page Object models occasionally use parameterized helper methods:
```typescript
userRow(id: string) {
  return this.page.locator(`tr[data-id="${id}"]`);
}
```
Attempting to rewrite dynamic parameterized methods using static locator repair generates invalid TypeScript or breaks variable bindings.

### Decision
Support five static Page Object patterns:
1. Property Initializer (`readonly submitBtn = this.page.locator(...)`)
2. Getter Declaration (`get submitBtn() { return this.page.locator(...); }`)
3. Constructor Assignment (`this.submitBtn = this.page.locator(...)`)
4. Parameterless Factory Method (`getSubmitBtn() { return this.page.locator(...); }`)
5. Locator Constant (`export const SUBMIT_BTN = ...`)

Any method containing parameters is immediately rejected with `AST_PARAMETERIZED_LOCATOR`.

### Consequences
- Syntactic and semantic validity of all generated code is guaranteed.
- Dynamic locators are safely flagged for human developer review.

---

## ADR-007: Human-in-the-Loop Active Branch Safety Guardrail

### Status
Accepted & Implemented

### Context
Regulated enterprise environments (FinTech, healthcare) strictly forbid automated tooling from modifying or committing to active git branches without developer review.

### Decision
1. All repairs and verification runs take place inside detached Git worktrees.
2. The engine produces a signed repair artifact containing:
   - Unified Git diff
   - Failure diagnostic classification
   - Causal evidence graph
   - Intent Invariant v2 verification logs
3. Applying the repair to the active branch requires explicit `--apply` flag execution or pull request generation.

### Consequences
- Full compliance with enterprise security and SOC2 compliance audits.
- Zero risk of accidental workspace corruption.

---

## ADR-008: Out-of-Band Post-Mortem Trace Analysis (Zero Runtime Latency)

### Status
Accepted & Implemented

### Context
Existing auto-healing tools (such as Healenium or custom Playwright wrappers) inject JavaScript proxies into the browser or wrap every Playwright call in retry loops. This adds 10–50ms of overhead per action, slows CI execution, and masks genuine race conditions.

### Decision
Operate strictly post-mortem on standard Playwright trace files (`trace.zip`). No custom runtime wrappers, browser extensions, or proxy servers are injected during test runs.

### Consequences
- 0 ms runtime test execution overhead.
- Tests run at full native Playwright speed in CI.
