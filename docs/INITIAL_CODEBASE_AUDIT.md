# Initial Codebase Audit & Expert Review Analysis

This document records the initial codebase audit conducted on the baseline Playwright Intelligence Engine repository, analyzing each architectural critique raised in the **Expert Architectural Audit & Code Review** and establishing the engineering remediation path.

---

## 1. Executive Findings & Baseline Architecture

The baseline implementation (v2.3) introduced a sound architectural foundation:
- TypeScript-first deterministic controller.
- Post-mortem trace ingestion with zero runtime overhead.
- AST manipulation via `ts-morph`.
- Isolated Git worktrees for safe candidate verification.

However, the expert audit identified seven critical architectural and reliability deficiencies that prevented enterprise production readiness.

---

## 2. Critique-by-Critique Analysis & Remediation Path

### Critique 1: Assertion Fingerprinting Alone Does Not Prove Intent
- **Expert Finding**: Hashing `expect(...)` statements prevents direct assertion tampering, but fails to prevent an agent from mutating fixture values, deleting preparatory test statements, or repointing a locator to an unintended semantic target.
- **Root Cause**: The invariant checked only assertion AST nodes without validating test structure, input payloads, or semantic role intent.
- **Remediation**: Implemented the formal **Intent Invariant v2**:
  $$V = A \land T \land F \land I \land D \land E$$
  Validates canonical assertion hash ($A$), structural statement order ($T$), critical input literals ($F$), target identity & action semantics ($I$), diff allowlist boundaries ($D$), and worktree execution ($E$).

---

### Critique 2: Network Temporal Correlation Does Not Equal Causality
- **Expert Finding**: Background analytics beacons (Google Analytics, Sentry, Datadog) that fail with HTTP 500 or timeout cause the engine to misclassify benign locator drift as `BACKEND_500`, preventing repair.
- **Root Cause**: `EvidenceCorrelator` correlated network errors with the test failure timestamp without validating domain origin, path semantics, or data dependency.
- **Remediation**: Built a **Causal Evidence Graph** with explicit telemetry exclusion filters for known analytics domains and endpoints (`/metrics`, `/beacon`, `/favicon.ico`). HTTP 500 errors must originate from in-domain application routes to be deemed causal.

---

### Critique 3: Candidate Scoring Must Distinguish Raw Scores from Calibrated Probabilities
- **Expert Finding**: The scoring formula $S(L)$ was an uncalibrated heuristic sum. Calling it a "probability" was mathematically incorrect and confounded threshold setting.
- **Root Cause**: Linear combination of weights without logistic transformation or calibration.
- **Remediation**: Separated heuristic raw score $S(L) \in [0, 1]$ from calibrated probability $P(\text{valid})$ computed via logistic sigmoid:
  $$P(\text{valid}) = \frac{1}{1 + e^{-k(S(L) - S_0)}}$$
  Enforced a minimum calibrated probability threshold ($\ge 0.75$) and ambiguity delta ($\ge 0.08$).

---

### Critique 4: Strict Element Uniqueness Boundary Bug ($matchCount === 1$)
- **Expert Finding**: When a candidate matched 2 elements in the DOM, $U = 1 / 2 = 0.5$. The code checked `if (U < 0.5)`, allowing elements with 2 matches to pass scoring, which triggers Playwright strict-mode violations.
- **Root Cause**: Flawed boundary condition.
- **Remediation**: Enforced a hard uniqueness gate:
  `if (candidate.matchCount !== 1 && !candidate.parentScopeVerified) abstain('NON_UNIQUE_CANDIDATE')`.

---

### Critique 5: Directory Junctions Do Not Guarantee Dependency Isolation (pnpm/yarn)
- **Expert Finding**: Windows directory junctions work for npm, but pnpm uses a shared virtual store (`.pnpm`) where concurrent modifications cause cache corruption. Yarn PnP has no `node_modules` folder.
- **Root Cause**: Monolithic assumption that all projects use standard npm.
- **Remediation**: Implemented `DependencyStrategyResolver`:
  - `NpmStrategy`: `IMMUTABLE_SHARED` via directory junctions with process tracking.
  - `PnpmStrategy`: `SHARED_MUTABLE` with virtual store cache warning.
  - `YarnPnpStrategy`: Safely abstains with `UNSUPPORTED`.
  - Windows junction unlinking prior to directory deletion to prevent root dependency wiping.

---

### Critique 6: Playwright Trace Formats Require Versioned Adapters
- **Expert Finding**: Playwright's `.trace` JSONL schema changes between minor and major versions (v5–v10). Parsing assumptions break across releases.
- **Root Cause**: Static parsing without version adapters or schema fallback.
- **Remediation**: Implemented `TraceAdapterRegistry` with `V8TraceAdapter`, `V9TraceAdapter`, `V10TraceAdapter`, and `UnknownTraceAdapter`. Traces also produce snapshot provenance (`frameId`, `callId`, `phase`) and completeness grades.

---

### Critique 7: Public Websites Cannot Serve as Reliable Business-Defect Oracles
- **Expert Finding**: Evaluating defect resistance solely on public demo websites (OrangeHRM, SauceDemo) is unscientific because you cannot inject ground-truth database defects into third-party servers.
- **Root Cause**: Lack of a controlled, instrumented test application.
- **Remediation**: Built `ControlledAppServer` (`benchmarks/controlled-app/app-server.ts`) with 6 toggleable seeded defects, reproducible DB state, and reset endpoint.

