# Playwright Intelligence Engine (pw-intel) v2.6

[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.64+-green.svg)](https://playwright.dev/)
[![Tests](https://img.shields.io/badge/Tests-382%20Passed%20(0%20Failed)-brightgreen.svg)]()
[![Benchmark](https://img.shields.io/badge/Benchmark-Empirical%20Browser%20(9%20Scenarios%20Verified)-success.svg)]()
[![License](https://img.shields.io/badge/License-Apache--2.0-purple.svg)](LICENSE)

An enterprise-grade, deterministic intelligence, diagnosis, and self-healing engine for Microsoft Playwright suites. Operates with zero mandatory cloud backend, zero forced LLM dependencies, and zero unsolicited file mutations. Ingests post-mortem trace archives (`trace.zip`), performs multi-source live browser reproductions (`pw-intel reproduce`), classifies failures via action-anchored causal graphs, scores candidates via probabilistic models, enforces strict intent invariants ($V = A \land T \land F \land I \land D \land E$), and promotes verified repairs via cryptographic token authorization and atomic Compare-And-Swap (CAS) file operations.

---

## Key Differentiators

| Capability | Playwright Intelligence Engine v2.6 | Generic Auto-Healers | LLM Code Agents |
| :--- | :--- | :--- | :--- |
| **Execution Model** | **Local-First & Deterministic** (Node.js ESM) | In-browser DOM mutation proxies | Non-deterministic prompt completions |
| **Diagnostic Model** | **Action-Anchored Causal Graph** ($T_{\text{action}}$ window) | Shallow string matching (`TimeoutError`) | Unstructured prompt reasoning |
| **Reproduction** | **Live Multi-Source Collectors** (DOM, ariaSnapshot, net) | None | Re-runs full suite blindly |
| **Candidate Scoring** | Calibrated Sigmoid Probability $P(\text{valid})$ | Ad-hoc priority lists / CSS heuristics | Unconstrained token generation |
| **Negative Control Gate** | **Strict Safe Abstention** on $count \neq 1$, 5xx, 401/403, assertion bugs | Blindly repairs or clicks first DOM match | Hallucinates locators for broken apps |
| **Defect Resistance** | **100% Detection** (0.0% False Repairs, 0.0% Bug Masking) | Masks application bugs by altering assertions | Weakens assertions to force tests green |
| **Intent Verification** | **$V = A \land T \land F \land I \land D \land E$** (AST-level) | None | Arbitrary unstructured diffs |
| **Mutation Safety** | **Isolated Git Worktree + CAS Atomic Promotion** | In-place file modification | Overwrites active branch directly |
| **Authorization** | **Cryptographic Single-Use Approval Token** (SHA-256 bound) | Auto-commits without human review | Uncontrolled workspace mutation |

---

## Architectural Overview

```mermaid
flowchart TD
    subgraph MultiSource["1. Multi-Source Evidence Capture"]
        TraceZip["Trace Archive\n(trace.zip)"] --> TraceColl["TraceCollector\n(v8-v10 Adapters)"]
        LiveBrowser["Live Browser\n(Playwright Page)"] --> LiveColl["LiveBrowserCollector\n(DOM, ariaSnapshot, Network, Console)"]
        StaticCode["Source AST"] --> StaticColl["StaticAstCollector\n(ts-morph POM & Spec Analysis)"]
        GitTree["Git Workspace"] --> GitColl["GitDiffCollector\n(Drift & Commit Attribution)"]
    end

    subgraph Diagnostics["2. Action-Anchored Causal Analysis"]
        TraceColl & LiveColl & StaticColl & GitColl --> Redactor["EvidenceRedactor\n(Central Scrubbing of PII, Tokens, PANs)"]
        Redactor --> Correlator["EvidenceCorrelator\n(T_action - 5000ms .. T_action + 1000ms Window)"]
        Correlator --> Classifier["FailureClassifier\n(LOCATOR_DRIFT, BACKEND_500, AUTH, ASSERTION)"]
    end

    subgraph Intelligence["3. Empirical Candidate Verification"]
        Classifier -->|LOCATOR_DRIFT| Extractor["CandidateExtractor\n(Role, TestId, Label, Placeholder, Text)"]
        Extractor --> LiveVerifier["LiveLocatorVerifier\n(Empirical verify: count === 1, visible, enabled)"]
        LiveVerifier --> Scorer["SelectorScorer & AbstentionPolicy\n(Strict Uniqueness: count == 1)"]
    end

    subgraph Isolation["4. Sandboxed AST Repair & Invariant Proof"]
        Scorer -->|Valid Plan| Worktree["WorktreeManager\n(Isolated Git Worktree + Canonical Realpath)"]
        Worktree --> ASTPatcher["AstPatcher (ts-morph)\n(Property, Constructor, Method Patterns)"]
        ASTPatcher --> DiffAllowlist["DiffAllowlistValidator\n(Zero Collateral Mutations, Recursive AST Grammar)"]
        DiffAllowlist --> IntentV2["IntentValidator (V = A ∧ T ∧ F ∧ I ∧ D ∧ E)\nPre-flight Proposal V_pre"]
        IntentV2 --> ExecutionVerification["Worktree Test Execution Proof\n(VerifiedExecutionProof exitCode === 0)"]
    end

    subgraph Governance["5. Cryptographic CAS Promotion Gate"]
        ExecutionVerification --> Approval["ApprovalService\n(Cryptographic SHA-256 Single-Use Token)"]
        Approval --> HumanGate{"Human Authorization Gate\n(CLI Prompt / MCP Token)"}
        HumanGate -->|Approved| Promoter["WorkspacePromoter\n(Cooperative Lock + CAS Hash Check + Atomic Rename)"]
        HumanGate -->|Rejected| Discard["Discard Sandbox Worktree"]
    end
```

---

## Quickstart & Installation

### Prerequisites
- Node.js >= 20.0.0
- Git >= 2.30.0
- Playwright >= 1.40.0

```bash
# Clone the repository
git clone https://github.com/enterprise/playwright-intelligence-engine.git
cd playwright-intelligence-engine

# Install dependencies
npm install

# Run typecheck and compile
npm run typecheck
npm run build

# Run complete test suite (382 tests across 24 test files)
npm test

# Run empirical real browser benchmark suite
npm run benchmark
```

---

## Command Line Interface (CLI)

The engine provides a standalone binary `pw-intel`:

```bash
# 1. Diagnose a failing Playwright trace archive
npx pw-intel diagnose ./playwright-traces/trace.zip

# 2. Reproduce a failing spec with live multi-source diagnostic collectors
npx pw-intel reproduce ./e2e/login.spec.ts

# 3. Execute the empirical browser benchmark suite in headless Chromium
npx pw-intel benchmark

# Benchmark options:
npx pw-intel benchmark --family "Dynamic IDs"      # Filter Tier 2 mutations by family
npx pw-intel benchmark --scenario "500"            # Filter Tier 3 negative controls
npx pw-intel benchmark --browser firefox           # Target alternative browser engine

# 4. Start the Model Context Protocol (MCP) JSON-RPC server on stdio
npx pw-intel mcp

# 5. Generate verified Page Object and Spec scaffolding
npx pw-intel generate UserDashboard
```

---

## Empirical Benchmark Suite (Gate C)

The benchmark runner (`benchmarks/runner/master-benchmark-runner.ts`) executes **9 real end-to-end browser scenarios** in headless Chromium against an in-memory `ControlledAppServer`. Outcomes, latencies, regressions, and defect masking rates are measured dynamically with **zero synthetic assignments and zero hardcoded rates**:

- **Tier 1 (2 Real Baselines):** Authentication journey and e-commerce checkout journey executed in headless Chromium (100% pass rate).
- **Tier 2 (4 Real DOM Drift Mutations):** Real DOM mutations (dynamic hashed IDs, accessible name drift, container restructuring, CSS utility class volatility). The engine executes original spec $\to$ catches browser failure $\to$ captures failure-point DOM & ariaSnapshot $\to$ extracts typed `LocatorPlan` $\to$ empirically verifies candidate live in Chromium (`count === 1`, `visible`, `enabled`) $\to$ patches Page Object $\to$ re-runs test in Chromium $\to$ confirms green pass $\to$ runs regression tests on clean baselines (100% repair precision, 100% recall, 0.0% regressions).
- **Tier 3 (3 Real Negative Controls):** In-domain HTTP 500 server crash, seeded business defect (wrong total calculated), and strict-mode duplicate controls (100% safe abstention rate, 0.0% false repairs, 0.0% bug masking).
- **Wilson 95% Confidence Interval:** `[70.08%, 100.00%]` computed from empirical trial outcomes.

Reports are saved to `artifacts/benchmark-report.json` and `artifacts/benchmark-report.md`.

---

## Model Context Protocol (MCP) Integration

The MCP server runs on `stdio` with fail-closed security:

1. `diagnose_trace`: Diagnoses a Playwright trace archive, returning causal classification, confidence, and recommended repairs.
2. `reproduce_and_diagnose`: Executes a test spec inside an isolated worktree with live collectors attached.
3. `repair_page_object`: Two-stage workflow:
   - Calling without `approvalToken` stages the proposal in `ApprovalService` and returns `proposalId`, proposed diff, and cryptographic proposal metadata.
   - Calling with `approvalToken` validates token binding (target file, AST hash, diff hash, TTL) and promotes the patch atomically to the workspace using `WorkspacePromoter`.

---

## Security Model

1. **Worktree-First Isolation:** All investigations, mutations, and exploratory re-runs execute in isolated Git worktrees (`.worktrees/`).
2. **Fail-Closed Intent Invariant v2:** Authorizing any repair requires satisfying:
   $$V = A \land T \land F \land I \land D \land E$$
   where $A$ = assertions preserved, $T$ = test body preserved, $F$ = fixtures preserved, $I$ = target identity preserved, $D$ = diff allowlist passed, $E$ = execution proof verified.
3. **Compare-And-Swap (CAS) Atomic Promotion:** `WorkspacePromoter` verifies canonical realpath containment, acquires cooperative file locks, verifies source hash against approved hash, writes to a temporary file, atomically replaces via `fs.renameSync`, and validates post-write SHA-256 hash.
4. **Subprocess Sanitization:** `ExecutionRunner` strips cloud keys and developer tokens, bounds output buffers to 16 MB, maps signals to `128 + signal`, and terminates process trees on timeout.
5. **Central Redaction:** `EvidenceRedactor` scrubs Bearer tokens, JWTs, credit card numbers, SSNs, and Basic Auth across all collectors prior to analysis.
