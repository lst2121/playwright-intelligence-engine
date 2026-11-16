# Playwright Intelligence Engine (`pw-intel`)

> Fast, verification-first failure diagnosis, autonomous self-healing, and intent-preserving test generation for Microsoft Playwright suites.

[![npm version](https://img.shields.io/npm/v/playwright-intelligence-engine.svg?style=flat-square)](https://www.npmjs.com/package/playwright-intelligence-engine)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node->=20.0.0-green.svg?style=flat-square)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright->=1.30-orange.svg?style=flat-square)](https://playwright.dev/)

---

## 1. Quick Start: Autonomous Self-Healing

When Playwright tests fail in your repository, heal them autonomously with a single command:

```bash
# 1. Dry run: diagnose traces and verify fixes in an isolated worktree (0 active changes)
npx pw-intel repair

# 2. Repair & Apply: verify passing in sandbox and apply fixes atomically to your workspace
npx pw-intel repair --apply
```

### Verification Pipeline

```text
Trace (.zip) ──> [Gate 0: Negative Controls] ──> [Tier 1: AST Fast-Path] ──> [Tier 2: Semantic LLM] ──> [Worktree Sandbox] ──> Active Workspace
```

1. **Gate 0: Fail-Closed Negative Controls**
   * Detects backend crashes (HTTP 5xx), failing client APIs (HTTP 4xx), network disconnections, and DNS lookup errors.
   * If a test failed because the environment or service is down, PIE immediately abstains from modifying UI locators. **Zero false heals.**
2. **Tier 1: Deterministic AST Fast-Path ($0.00 Token Cost)**
   * Operates 100% offline and locally at zero token cost.
   * Analyzes trace action snapshots against Page Object and test AST trees to substitute drifted locators in milliseconds.
3. **Tier 2: Semantic LLM Authoring (Adaptive Fallback)**
   * Engaged only when DOM structure shifts significantly (e.g. Select2 comboboxes, nested modals, dynamic custom components).
4. **Headless Git Worktree Sandbox Proof**
   * Every single fix is compiled and re-executed against headless Playwright in an isolated Git worktree using per-test title isolation (`-g "^testTitle$"`) before touching your working tree.
5. **Strict Assertion Invariance**
   * Assertions (`expect(...)`) are strictly immutable. PIE will never alter, weaken, or remove test assertions.

---

## 2. Installation & LLM Configuration

Run directly without installing via `npx`:
```bash
npx pw-intel --help
```

Or install in your project:
```bash
npm install --save-dev playwright-intelligence-engine
```

*(Note: `pw-intel` is the primary executable. `pie` is also preserved as a convenient short alias).*

### Initialize PIE in your Playwright repository:

```bash
npx pw-intel init
```

### Providing your LLM API Key (Optional)

> **Note:** Trace diagnosis, Gate 0 negative control filtering, and Tier 1 AST test repairs run **100% offline and locally** without an LLM key.
> An API key is only needed if you want Tier 2 complex semantic repairs or AI-assisted test generation (`pw-intel qa`).

You can configure an LLM key in any of three ways:

#### Option A: During `init`
```bash
npx pw-intel init --api-key sk-your-openai-or-deepseek-key --model gpt-4o
```
*This automatically creates `.env` and adds it to your `.gitignore`.*

#### Option B: Environment Variable
```bash
export OPENAI_API_KEY="sk-..."
# or
export PIE_LLM_API_KEY="sk-..."
```

#### Option C: In `.env`
Create `.env` in your project root:
```ini
PIE_LLM_API_KEY=sk-...
PIE_LLM_MODEL=gpt-4o
PIE_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
```

Verify your setup at any time:
```bash
npx pw-intel doctor
```

---

## 3. Core Capabilities

### 🔍 A. Diagnose a Failing Test
Ingest a Playwright trace archive (`trace.zip`) to pinpoint root causes without running repairs:

```bash
npx pw-intel diagnose ./test-results/trace.zip
```

**Output example:**
```json
{
  "category": "LOCATOR_DRIFT",
  "confidence": 0.94,
  "action": "click",
  "failingSelector": "#checkout-btn-v1",
  "suggestedSelector": "button:has-text(\"Proceed to Checkout\")",
  "targetFile": "e2e/pages/CartPage.ts",
  "evidence": "Element ID changed dynamically; stable accessible role match found."
}
```

If the failure was caused by a backend crash (HTTP 500) or network disconnection, PIE flags it immediately as a Negative Control Trigger and abstains.

---

### 🚀 B. Evidence-Driven Test Generation (`pw-intel qa`)
Generate full end-to-end test suites and Page Objects conforming to your repository's exact conventions:

```bash
npx pw-intel qa "Checkout Flow" --url http://localhost:3000 --author hybrid --out-dir tests/e2e
```

**Generation Modes:**
- **Brownfield Exploration:** Discovers existing Page Objects, fixtures, custom matchers, and auth states in your repository. Generates clean tests that reuse existing architecture without creating redundant login steps or duplicate Page Objects.
- **Greenfield Scaffolding:** Sets up a complete Playwright testing architecture with Page Object Model patterns and clean fixture isolation from raw requirements.
- **Automated Verification & Falsification:** Compiles generated TypeScript files and runs Playwright discovery to guarantee 0 syntax or type errors.

---

### 🧪 C. Live Diagnostic Reproduce
Rerun a flaky or intermittent test in a dedicated worktree with live DOM snapshots, network capture, and console stream telemetry:

```bash
npx pw-intel reproduce tests/checkout.spec.ts
```

---

### 📊 D. CI/CD Quality Gate & SARIF Reporting
Convert Playwright test results into GitHub Actions annotations, failure clusters, and SARIF security/flakiness reports:

```bash
npx pw-intel ci-report ./test-results/results.json --sarif-out ./pie-results.sarif
```

---

### 🔒 E. Enterprise Governance & Cryptographic CI Sign-Off

For regulated or compliance-heavy CI/CD pipelines where autonomous changes to source code require explicit multi-step sign-off:

```bash
# 1. Generate an isolated repair proposal and execute sandbox proof:
npx pw-intel repair ./test-results/trace.zip --execute

# 2. Inspect cryptographic proposal hash and sign off:
npx pw-intel approve <proposalId>

# 3. Promote the approved fix atomically to production:
npx pw-intel promote --token <approvalToken>
```

---

## 4. Cursor / Claude Code IDE Integration (MCP Server)

PIE includes a built-in Model Context Protocol (MCP) server so AI coding assistants can diagnose traces and fix tests directly inside your IDE.

### For Cursor / Windsurf
Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "playwright-intelligence": {
      "command": "npx",
      "args": ["-y", "playwright-intelligence-engine", "mcp"]
    }
  }
}
```

### For Claude Desktop / Claude Code
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "pw-intel": {
      "command": "npx",
      "args": ["-y", "playwright-intelligence-engine", "mcp"]
    }
  }
}
```

**Available MCP Tools:**
- `diagnose_trace`: Diagnoses Playwright traces and provides root causes.
- `repair_page_object`: Stages isolated repairs with cryptographic approval tokens.
- `generate_playwright_test`: Generates tests matching your repository's conventions.
- `ingest_playwright_report`: Analyzes test run failures and flakiness.

---

## 5. CLI Command Cheat Sheet

| Command | Usage | Description |
| :--- | :--- | :--- |
| `repair` | `npx pw-intel repair [--apply] [--all]` | Two-tier autonomous repair with worktree verification |
| `diagnose` | `npx pw-intel diagnose <trace.zip>` | Ingests trace and outputs causal root cause |
| `doctor` | `npx pw-intel doctor` | Verifies Node, Git, Playwright & LLM readiness |
| `init` | `npx pw-intel init [--api-key <k>]` | Initializes `.pie/config.json` & optional LLM credentials |
| `profile` | `npx pw-intel profile [dir]` | Scans repository conventions, Page Objects, and preferred locators |
| `architect` | `npx pw-intel architect <feature> [--write]` | Plans greenfield/brownfield Playwright architecture and typed fixtures |
| `qa` | `npx pw-intel qa <feature> --author hybrid` | Evidence-driven 4-phase test generation (greenfield/brownfield) |
| `reproduce` | `npx pw-intel reproduce <spec.ts>` | Reruns spec with live DOM and network capture |
| `ci-report` | `npx pw-intel ci-report <results.json>` | Generates CI annotations and SARIF report |
| `repair (targeted)` | `npx pw-intel repair <trace.zip> --execute` | Generates targeted proposal verified in isolated worktree |
| `approve` | `npx pw-intel approve <proposalId>` | Authorizes cryptographic repair proposal |
| `promote` | `npx pw-intel promote --token <token>` | Atomically applies authorized repair proposal to active workspace |
| `mcp` | `npx pw-intel mcp` | Starts the Model Context Protocol stdio server |

---

## 6. Detailed Documentation

- [CLI Reference Guide](docs/CLI_REFERENCE.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Benchmark Methodology & Results](docs/BENCHMARK.md)
- [Intent Invariants & Verification Guarantees](docs/INTENT_INVARIANTS.md)
- [MCP Server Setup](docs/MCP_INTEGRATION.md)

---

## Community & Contributing

Contributions, feedback, and bug reports are warmly welcome! If Playwright Intelligence Engine saves you debugging time or helps stabilize your test suite, please consider giving it a ⭐ on [GitHub](https://github.com/lst2121/playwright-intelligence-engine).

---

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
