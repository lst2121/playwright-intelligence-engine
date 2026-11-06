# CLI Reference Guide (`pw-intel`)

Complete reference documentation for the `pw-intel` command-line utility and testing toolchain.

---

## 1. Global Usage & Options

```bash
npx pw-intel [command] [options]
```

### Global Options
- `-h, --help`: Displays help information and command syntax.
- `-v, --version`: Displays the current package version (`0.1.0`). The current engineering milestone is `2.6.0-rc1`.

---

## 2. Command Reference

### 2.0. `pw-intel init`

Creates a project-local `.pie/config.json` without modifying application or test
source files. Existing configuration is preserved unless `--force` is supplied.

```bash
npx pw-intel init [directory] [--json] [--force]
```

The configuration records the detected package manager, likely test command,
trace directories, fail-closed diagnostic policy, and future memory locations.

### 2.0.1. `pw-intel profile`

Builds a repository convention profile for future project-aware diagnosis,
ranking, and generation.

```bash
npx pw-intel profile [directory] [--json] [--out <file>]
```

The profile observes repository structure, Page Objects, fixtures, locator
usage, test tags, storage state, API helpers, assertions, and candidate domain
terms. It does not modify source files.

### 2.0.2. `pw-intel cluster-failures`

Groups normalized failure observations by deterministic fingerprints while
retaining affected tests and repositories.

```bash
npx pw-intel cluster-failures <observations.json> [--out <report.json]
```

### 2.0.3. `pw-intel suite-health`

Calculates per-test pass rate, flaky status, failure-cluster history, average
duration, and p95 duration from a JSON run history.

```bash
npx pw-intel suite-health <runs.json> [--out <report.json>]
```

Business intent and oracle APIs are available through the package exports. The
current built-in contracts include assertion preservation and execution
success; domain-specific oracles must return `verified`, `contradicted`, or
`unavailable` and cannot treat missing evidence as verified.

### 2.0.3.1. `pw-intel team-dashboard`

Aggregates serialized CI evidence from multiple repositories into a local team
dashboard with repository pass rates, flaky tests, failure clusters, and a
quality-gate decision.

```bash
npx pw-intel team-dashboard team-evidence.json --out team-dashboard.json
```

### 2.0.3.2. `pw-intel impact`

Discovers direct relative imports from Playwright test files and selects the
tests affected by changed source files.

```bash
npx pw-intel impact changed-files.json --root . --out impact.json
```

The input can be a JSON array or `{ "changedFiles": [...] }`. Results include
direct, dependency, directory, and tag confidence, plus explicit limitations.

### 2.0.4. `pw-intel architect`

Plans a greenfield or repository-aware brownfield architecture. It emits file
contents and assumptions as JSON; `--write` is explicit and creates only
missing files.

```bash
npx pw-intel architect "Checkout Flow" --mode greenfield --requirements requirements.json --out architecture.json
npx pw-intel architect "Order Review" --mode brownfield --write
```

### 2.0.5. `pw-intel ci-report`

Ingests a Playwright JSON report, normalizes retries, clusters failures,
calculates suite stability, emits a Markdown summary and GitHub Actions
annotations, and records the gate decision in the audit log.

```bash
npx pw-intel ci-report playwright-report.json --repository checkout --out pie-ci-evidence.json --sarif-out pie-results.sarif
```

`--sarif-out` writes a SARIF 2.1.0 artifact containing failure-cluster results
and the PIE quality-gate result for GitHub Code Scanning or another SARIF
consumer.

### 2.1. `pw-intel diagnose`
Ingests a Playwright `trace.zip` archive and outputs root-cause failure classification with action-anchored causal correlation.

```bash
npx pw-intel diagnose <path-to-trace.zip>
npx pw-intel diagnose <path-to-trace.zip> --error-context test-results/.../error-context.md
```

#### What It Does:
1. Inspects the archive with decompression-bomb guards (100 MB max aggregate size, 10:1 compression ratio limit).
2. Identifies matching stream IDs for `.trace` and `.network` JSONL streams.
3. Automatically detects trace format versions (v7, v8, v9, v10) through `TraceAdapterRegistry`.
4. Builds a `DiagnosticContext` with action, network, console, and DOM snapshot provenance.
5. Evaluates the **Causal Evidence Graph** anchored to the failed action timestamp ($T_{\text{action}}$), ignoring background telemetry noise.
6. Emits a deterministic failure fingerprint so repeated failures can be clustered across runs.
7. Outputs a formatted terminal report with classification, confidence level, and actionable remediation.

When a trace has no usable failed action, `--error-context` supplements it
with Playwright's companion failure artifact. The artifact is redacted before
classification and is not treated as trusted source code.

---

### 2.1.1. `pw-intel repair`

Builds a locator-repair proposal from a trace. The default mode is proposal-only
and does not modify the active workspace. Supplying `--execute` runs the proposed
patch inside a dedicated Git worktree and stages approval evidence only when the
target test and intent gates pass.

```bash
npx pw-intel repair <path-to-trace.zip> --test tests/login.spec.ts --pom pages/LoginPage.ts --class LoginPage --member submit
npx pw-intel repair <path-to-trace.zip> --test tests/login.spec.ts --pom pages/LoginPage.ts --class LoginPage --member submit --execute
```

When the failed trace includes a source file and a unique selector match in a
Page Object, `--test`, `--pom`, `--class`, and `--member` can be omitted. PIE
discovers them conservatively; ambiguous mappings remain `INPUT_REQUIRED`.

The command can return `ABSTAINED`, `INPUT_REQUIRED`, `PROPOSAL_READY`,
`OPERATION_PROPOSAL_ONLY`, `VERIFIED_READY_FOR_APPROVAL`, or `REJECTED`. Even a verified result requires
the existing explicit `approve` and `promote` steps before active source changes.

An optional allowlisted operation can be supplied as JSON. Frame and Shadow DOM
operations are compiled into locator expressions; browser-dependent operations
remain proposal-only:

```bash
npx pw-intel repair trace.zip --test tests/card.spec.ts --pom pages/Card.ts --class CardPage --member submit \
  --operation '{"kind":"add_frame_scope","target":"this.page.getByRole('"'"'button'"'"', { name: '"'"'Pay'"'"' })","frameLocator":"iframe[title=\"Payment\"]"}'
```

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

#### Currently registered MCP tools:
- `diagnose_trace`: Analyzes a `trace.zip` archive and returns root-cause diagnosis.
- `repair_trace`: Converts a trace into a fail-closed proposal and optionally verifies it in an isolated worktree; it never promotes without approval.
- `propose_repair`: Runs one optional bounded model-proposal step over redacted evidence; it never executes or promotes output.
- `repair_page_object`: Stages or applies a Page Object repair with approval validation.
- `generate_playwright_test`: Generates Page Object and test scaffolding.
- `initialize_project`, `profile_repository`: Establish project config and repository conventions.
- `cluster_failures`, `suite_health`: Produce deterministic failure and stability intelligence.
- `compile_repair_operation`, `evaluate_quality_gate`: Validate safe operations and CI decisions.
- `plan_test_architecture`: Plan greenfield/brownfield generation; optional create-only write.
- `ingest_playwright_report`: Convert Playwright JSON into CI evidence and gate output.
- `build_team_dashboard`: Aggregate CI evidence across repositories into a team dashboard.
- `analyze_repository_impact`: Discover test dependencies and select impacted tests from changed files.

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
- 5 clean baselines, 60 controlled mutation scenarios, and 60 negative-control scenarios executed against the controlled browser application. The current artifact reports 96.7% Tier 2 repair precision/recall and 100% Tier 3 safe abstention.
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

For project-aware architecture generation, use `pw-intel architect`; the legacy
`generate` command remains a small demonstration scaffold.

### 2.6. `pw-intel inspect-testbed`

Inspects cloned external Playwright repositories without modifying them and
emits a reproducible repository manifest.

```bash
node bin/pw-intel.js inspect-testbed <testbed-directory> --json --out <manifest.json>
```

The inspector discovers nested Playwright projects, package managers, configs,
test files, Page Objects, fixtures, Docker files, and local-server hints. It does
not claim that a repository's tests passed; execution results require a separate
testbed run.

### 2.7. `pw-intel run-testbed`

Runs a bounded baseline command for one or all discovered repositories. The
runner only allows package-manager commands, applies a timeout and output limit,
and writes explicit `PASS`, `FAIL`, `TIMEOUT`, or `BLOCKED` results.

```bash
node bin/pw-intel.js run-testbed <testbed-directory> [options]
```

Options include `--repository <name>`, `--script <package-script>`,
`--timeout <milliseconds>`, and `--out <results.json>`. A timeout is evidence
that the bounded run did not complete; it is not treated as a passing result.
