# CLI Reference Guide (`pw-intel`)

Complete reference documentation for the `pw-intel` command-line utility and testing toolchain.

---

## 1. Global Usage & Options

```bash
npx pw-intel [command] [options]
```

### Global Options
- `-h, --help`: Displays help information and command syntax.
- `-v, --version`: Displays the current engine version (`0.1.0`).

---

## 2. Command Reference

### 2.1. `pw-intel diagnose`
Ingests a Playwright `trace.zip` archive and outputs root-cause failure classification with action-anchored causal correlation.

```bash
npx pw-intel diagnose <path-to-trace.zip>
```

#### What It Does:
1. Inspects the archive with decompression-bomb guards (100 MB max aggregate size, 10:1 compression ratio limit).
2. Identifies matching stream IDs for `.trace` and `.network` JSONL streams.
3. Automatically detects trace format versions (v7, v8, v9, v10) through `TraceAdapterRegistry`.
4. Builds a `DiagnosticContext` with action, network, console, and DOM snapshot provenance.
5. Evaluates the **Causal Evidence Graph** anchored to the failed action timestamp ($T_{\text{action}}$), ignoring background telemetry noise.
6. Outputs a formatted terminal report with classification, confidence level, and actionable remediation.

---

### 2.2. `pw-intel reproduce`
Executes an isolated diagnostic rerun of a failing test spec without requiring an existing `trace.zip` file.

```bash
npx pw-intel reproduce <path-to-spec.ts>
```

#### What It Does:
1. Creates an isolated detached Git worktree (`.pw-intelligence/worktrees/reproduce-*`) with NTFS junctions.
2. Ingests static AST structure (`StaticAstCollector`), recent git attribute diffs (`GitDiffCollector`), and environment metadata (`EnvironmentCollector`).
3. Executes Playwright test via `ExecutionRunner` with sanitized environment and 16 MB bounded output buffers.
4. Gathers Playwright error messages, stacks, frame locations (`ErrorCollector`), and live DOM/network artifacts.
5. Ingests and redacts sensitive tokens, credit cards, SSNs, and passwords (`EvidenceRedactor`).
6. Computes the **Multi-Source Evidence Scorecard** across all channels.
7. Outputs an immediate terminal diagnostic report and cleans up the worktree.

---

### 2.3. `pw-intel mcp`
Launches the Model Context Protocol (MCP) JSON-RPC server on `stdio`, enabling AI IDEs and agents (Claude, Gemini, Antigravity) to safely interact with the engine.

```bash
npx pw-intel mcp
```

#### Available MCP Tools:
- `diagnose_trace`: Analyzes a `trace.zip` archive and returns root-cause diagnosis.
- `plan_repair`: Generates an in-memory surgical locator proposal and evaluates Intent Invariant v2 without modifying disk.
- `repair_page_object`: Applies a verified repair patch. **Enforces human-in-the-loop cryptographic approval**: without an `approvalToken`, returns a proposal and issues a one-time token; with a verified `approvalToken`, validates token integrity and applies the patch atomically.
- `list_worktrees`: Lists active detached worktrees in `.pw-intelligence/worktrees/`.
- `cleanup_worktree`: Safely destroys an isolated worktree and deletes its temporary repair branch.

---

### 2.4. `pw-intel generate`
Generates modern, resilient Page Object Model (POM) and test spec scaffolding for a target application feature.

```bash
npx pw-intel generate <featureName>
```

#### Example:
```bash
npx pw-intel generate Checkout
```
Produces:
- `CheckoutPage.ts`: strongly typed Playwright Page Object utilizing `getByRole` and `getByTestId`.
- `checkout.spec.ts`: verified test suite boilerplate importing the Page Object.

---

### 2.5. `npm run benchmark`
Runs the comprehensive 104-scenario empirical benchmark against the in-memory `ControlledAppServer`.

```bash
npm run benchmark
```

#### What It Evaluates:
- **Tier 1 (24 Clean Baselines):** Live HTTP workflows against `ControlledAppServer` port 4173.
- **Tier 2 (50 Structural Mutations):** 5 mutation families (Dynamic IDs, Name Drift, Container Restructure, Utility Classes, Duplicate Controls). Evaluates candidate extraction, calibrated scoring, AST patching, and Intent Invariant v2 pre-flight proof.
- **Tier 3 (30 Negative Controls):** Backend 500s, 401/403 expirations, incomplete traces, timing races, and 6 seeded business defects. Verifies 100% safe abstention and 0% false repairs.
- Outputs detailed reports to `artifacts/benchmark-report.json` and `artifacts/benchmark-report.md`.
