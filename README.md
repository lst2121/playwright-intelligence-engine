# Playwright Intelligence Engine (`pw-intel`)

> Fast, verification-first failure diagnosis, autonomous self-healing, and test generation for Microsoft Playwright suites.

[![npm version](https://img.shields.io/npm/v/playwright-intelligence-engine.svg?style=flat-square)](https://www.npmjs.com/package/playwright-intelligence-engine)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node->=20.0.0-green.svg?style=flat-square)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright->=1.30-orange.svg?style=flat-square)](https://playwright.dev/)

---

## 1. Installation

Run without installing via `npx`:
```bash
npx pw-intel --help
```

Or install in your project:
```bash
npm install --save-dev playwright-intelligence-engine
```

Or install globally:
```bash
npm install -g playwright-intelligence-engine
```

*(Both `pw-intel` and `playwright-intelligence-engine` commands are available).*

---

## 2. Project Setup & LLM Configuration

Initialize PIE in your Playwright repository:

```bash
npx pw-intel init
```

### Providing your LLM API Key (Optional)

> **Note:** Failure diagnosis, trace analysis, and AST test repairs run **100% offline and locally** without an LLM key.
> An API key is only needed if you want AI-assisted test generation (`pw-intel generate-agent`).

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

## 3. How to Use

### 🔍 A. Diagnose a Failing Test
Ingest a Playwright trace archive (`trace.zip`) to find the exact root cause:

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

If the failure was caused by a backend crash (HTTP 500) or expired authentication (HTTP 401), PIE flags it immediately and abstains from modifying locators.

---

### 🔧 B. Autonomous Test Repair (Safe Worktrees)
Repair a broken test or Page Object without risking your active Git branch:

```bash
# 1. Plan and test the repair in an isolated Git worktree:
npx pw-intel autonomous-repair ./test-results/trace.zip --execute

# 2. Check the cryptographic proposal:
npx pw-intel approve <proposalId>

# 3. Promote the verified fix atomically to your workspace:
npx pw-intel promote --token <approvalToken>
```

**The Safety Guarantee:**
- PIE **never** deletes or weakens your assertions (`expect(...)`).
- PIE **never** alters test inputs or reorders user actions.
- All repairs are executed and proven passing in a background worktree before promotion.

---

### 🚀 C. Generate Tests from Requirements
Generate complete Playwright test suites and Page Objects that conform to your repository's conventions:

```bash
npx pw-intel generate-agent ./requirements.json --mode brownfield --write --verify
```

**Arguments:**
- `--mode brownfield`: Reuses existing fixtures, auth states, and Page Objects without generating duplicate login steps.
- `--mode greenfield`: Scaffolds a new end-to-end testing architecture from scratch.
- `--write`: Saves the generated files to disk.
- `--verify`: Runs TypeScript typecheck and Playwright discovery to ensure generated code compiles.

---

### 🧪 D. Reproduce a Spec with Live Instrumentation
Rerun a flaky test with live DOM snapshots, network capture, and console logs:

```bash
npx pw-intel reproduce tests/checkout.spec.ts
```

---

### 📊 E. CI/CD Quality Gate & SARIF Reporting
Convert Playwright test results into GitHub Actions annotations and SARIF security/flakiness reports:

```bash
npx pw-intel ci-report ./test-results/results.json --sarif-out ./pie-results.sarif
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
| `init` | `pw-intel init [--api-key <k>]` | Initializes `.pie/config.json` & optional LLM credentials |
| `doctor` | `pw-intel doctor` | Verifies Node, Git, Playwright & LLM readiness |
| `diagnose` | `pw-intel diagnose <trace.zip>` | Ingests trace and outputs causal root cause |
| `autonomous-repair` | `pw-intel autonomous-repair <trace.zip> --execute` | Verifies repair in an isolated Git worktree |
| `approve` | `pw-intel approve <proposalId>` | Authorizes a verified repair proposal |
| `promote` | `pw-intel promote --token <token>` | Applies authorized fix atomically to active code |
| `generate-agent` | `pw-intel generate-agent <reqs.json> --write` | Generates tests matching project conventions |
| `reproduce` | `pw-intel reproduce <spec.ts>` | Reruns spec with live DOM and network capture |
| `ci-report` | `pw-intel ci-report <results.json>` | Generates CI annotations and SARIF report |
| `mcp` | `pw-intel mcp` | Starts the Model Context Protocol stdio server |

---

## 6. Detailed Documentation

- [CLI Reference Guide](docs/CLI_REFERENCE.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Benchmark Methodology & Results](docs/BENCHMARK.md)
- [Intent Invariants & Verification Guarantees](docs/INTENT_INVARIANTS.md)
- [MCP Server Setup](docs/MCP_INTEGRATION.md)

---

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
