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

### 2.4. `pw-intel benchmark`
Executes the empirical real-browser benchmark suite against the in-memory `ControlledAppServer` using headless Chromium (or specified engine).

```bash
npx pw-intel benchmark [options]
```

#### Options:
- `--family <name>`: Filter Tier 2 mutation scenarios by family name (e.g. `--family "Dynamic IDs"`).
- `--scenario <id|name>`: Filter Tier 3 negative control scenarios by category or ID (e.g. `--scenario "500"`).
- `--browser <browser>`: Select browser engine (`chromium` [default], `firefox`, `webkit`).
- `--include-classifier-unit`: Include supplementary fast in-memory classifier test cases.

#### What It Evaluates:
- **Tier 1 (2 Real Baselines):** Full user login and checkout flows executed live in headless Chromium.
- **Tier 2 (4 Real DOM Drift Mutations):** Real DOM mutations (dynamic hashed IDs, accessible name drift, container restructuring, CSS class volatility) executed in Chromium $\to$ caught at browser failure $\to$ live DOM/ariaSnapshot captured $\to$ candidate verified live via `LiveLocatorVerifier` (`count === 1`, `visible`, `enabled`) $\to$ AST patched $\to$ test re-run in Chromium $\to$ green pass confirmed $\to$ zero regressions verified across clean baselines.
- **Tier 3 (3 Real Negative Controls):** Real HTTP 500 server crash, seeded business logic calculation defect ($199 vs $99), and strict-mode duplicate buttons. Verifies 100% safe abstentions, 0% false repairs, and 0% defect masking.
- Outputs detailed reports to `benchmarks/reports/master-benchmark-results.json`, `artifacts/benchmark-report.json`, and `artifacts/benchmark-report.md`.

---

### 2.5. `pw-intel generate`
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
