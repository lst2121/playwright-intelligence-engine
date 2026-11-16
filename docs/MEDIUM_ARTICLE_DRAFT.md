---
title: "Building a Safer Repair Loop for Playwright"
subtitle: "A practical guide to diagnosing broken UI tests, repairing locator drift, and preserving real regression signals with pw-intel."
author: "Lokender Singh"
status: "Production Ready Draft"
recommended_read_time: "9–11 minutes"
---

# Building a Safer Repair Loop for Playwright

*A practical guide to diagnosing broken UI tests, repairing locator drift, and preserving real regression signals with pw-intel.*

At 2:14 AM, a Playwright job fails in CI.

The message is all too familiar:

```text
locator.click: Test timeout exceeded
waiting for locator('#login-button-old')
```

The standard engineering reaction is equally familiar: you open the trace, inspect the screenshot, discover that a frontend developer renamed the button ID or wrapped it in a new container, edit the selector in your Page Object, push a commit, and wait 15 minutes for CI to run again.

Sometimes, updating that selector is indeed the correct fix.

**But often, it is a trap.**

A missing button is frequently the visible downstream symptom of something else entirely:
- An authentication session timed out unexpectedly.
- A backend microservice threw an HTTP 500 during data seeding.
- A database fixture failed to populate.
- The page failed to transition because of an unhandled runtime exception.

In those cases, if an automated tool or an engineer hastily rewrites the locator to whatever matches on the screen, **it does not repair the test—it destroys regression signal.** You turn an alert about a broken application into a silently passing test.

To solve this dilemma, we built **PIE (Playwright Intelligence Engine)**, invoked via the **`pw-intel`** CLI and exposed to IDEs through the **Model Context Protocol (MCP)**.

This article explains how PIE acts as an intelligent AI-assisted testing engine, why naive test healing is dangerous, how `pw-intel` enforces isolated proof, and how Cursor/Claude Code can leverage PIE natively via MCP.

---

## What Makes PIE Different: Two-Tier Intelligence

Most "self-healing" test tools make a fatal assumption: *if a selector failed, ask an LLM for a new one and overwrite the file.*

PIE operates under an architectural pipeline designed to minimize token waste, guarantee safety, and prove fixes before applying them:

```text
Failed Trace (trace.zip)
         │
         ▼
[Gate 0: Negative Controls] ─── Server 500 / Network Error? ───► ABSTAIN (Zero False Repairs)
         │ No
         ▼
[Tier 1: AST Fast-Path] ──────── Stable DOM snapshot match? ────► Deterministic Local Fix ($0 Token Cost)
         │ Complex DOM Shift
         ▼
[Tier 2: Semantic LLM] ───────── Semantic intent match ─────────► Propose Structural Fix (Assertions Immutable)
         │
         ▼
[Isolated Git Worktree Sandbox] ── Run Headless Playwright ────► Re-execute exact test in isolation
         │
    ┌────┴────┐
    │         │
  Passed    Failed
    │         │
    ▼         ▼
Promote     Reject candidate & leave
to branch   source code untouched
```

### 1. Gate 0: Fail-Closed Negative Controls
Before touching any code or calling any AI models, `pw-intel` parses the trace’s network log and console events. If the failed action was accompanied by an HTTP 500 server crash, a 401 unauthenticated redirect, or a DNS failure, the engine **immediately halts and abstains**. It reports the backend failure directly, consuming **0 tokens and $0.00**.

### 2. Tier 1 AST Fast-Path ($0 Token Cost)
For standard locator drift (e.g., an element’s ID changed, but its accessible role, test ID, or label remains intact in the DOM snapshot), PIE repairs the code **100% offline and locally** using TypeScript AST manipulation (`ts-morph`). It executes in milliseconds with zero LLM API calls.

### 3. Tier 2: Adaptive Semantic AI Authoring
When DOM layout shifts dramatically—such as transitioning from native select elements to custom React/Vue comboboxes, nested modals, or Shadow DOM components—PIE engages its Tier 2 Semantic Agent. The agent inspects the full DOM delta and historical repository patterns to generate clean, accessible locators.

**The Golden Rule:** In all tiers, **test assertions (`expect(...)`) are strictly immutable**. PIE will never alter, weaken, or remove an assertion to make a test pass.

### 4. Headless Git Worktree Sandbox Proof
Even if a proposed locator looks perfect on paper, `pw-intel` never touches your working directory directly. Instead, it spins up an isolated, temporary Git worktree, applies the candidate diff, and runs Playwright against the specific test title (`-g "^testTitle$"`). Only if the test passes completely in isolation is the change promoted to your active repository.

---

## Beyond Repair: Evidence-Driven Test Generation (`pw-intel qa`)

PIE is not just a locator patcher—it is a full AI quality engineering suite.

Writing end-to-end tests from scratch usually involves copy-pasting boilerplate, guessing locators, and manually assembling Page Objects. With `pw-intel qa`, you generate production-grade Playwright tests grounded in live browser exploration:

```bash
npx pw-intel qa "Checkout Flow" --url http://localhost:3000 --author hybrid --out-dir tests/e2e
```

### The 4-Phase Generation Pipeline:
1. **Explore:** An autonomous agent crawls the target URL, inspects interactive elements, and maps user flows.
2. **Brownfield Synthesis:** PIE inspects your existing codebase (`pw-intel profile`). It reuses your existing Page Objects, auth states, and custom fixtures rather than generating redundant duplicates.
3. **Draft & Compile:** Tests are written conforming to your repository's naming conventions with web-first assertions.
4. **Falsification & Verification:** PIE compiles the generated TypeScript and validates that tests pass against real browser states before saving them.

---

## Native IDE Integration via Model Context Protocol (MCP)

If you use **Cursor**, **Windsurf**, or **Claude Code**, you don't even need to leave your editor to diagnose and heal tests.

PIE includes a built-in MCP server that exposes its intelligence directly to AI coding assistants as first-class tools:

```bash
npx pw-intel mcp
```

### Setup in Cursor (`.cursor/mcp.json`)
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

### Setup in Claude Desktop (`claude_desktop_config.json`)
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

### What You Can Ask Your IDE:
- *"Diagnose this failed trace at `test-results/login/trace.zip`."* &rarr; Claude/Cursor calls `pw_intel_diagnose` and explains the root cause.
- *"Fix the broken selector in CartPage.ts and verify it in a sandbox."* &rarr; Cursor calls `pw_intel_autonomous_repair`, runs the isolated worktree proof, and applies the verified patch.
- *"Scan this repo and generate a new E2E test for the billing settings."* &rarr; Cursor calls `run_qa_pipeline`, respecting your repository's POM structure.

---

## Hands-On: How to Use `pw-intel` in Practice

Let’s walk through the actual developer workflow from installation to healing a real failure.

### Step 1: Healthcheck and Environment Setup

You can run `pw-intel` directly with `npx` or install it as a development dependency:

```bash
npm install --save-dev playwright-intelligence-engine
```

Verify that your local environment has the required prerequisites (Node >= 20, Git, and `@playwright/test`):

```bash
npx pw-intel doctor
```

Output:
```text
Running Playwright Intelligence Engine Diagnostic Healthcheck (pw-intel doctor)...

  ✓ Node.js Runtime     : v24.19.0 (Supported >= 20.0.0)
  ✓ Git Version Control : git version 2.44.0.windows.1
  ✓ Playwright Test     : ^1.64.1 (Found in package.json)
  ✓ Workspace Access    : Read/Write verified
  ✓ Host Platform       : win32 (x64)
  ✓ LLM Provider        : Configured (AI test generation enabled)

Healthcheck Verdict: HEALTHY (Ready for diagnostic and repair workflows)
```

Initialize project configuration (which creates `.pie/config.json`):

```bash
npx pw-intel init
```

---

### Step 2: Retain Traces on Failure

PIE relies on Playwright’s rich trace archive (`trace.zip`), which captures action history, DOM snapshots before and after each action, console logs, and network telemetry.

Ensure your `playwright.config.ts` includes `trace: 'retain-on-failure'`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

When a test fails, Playwright writes the trace archive into `test-results/`.

---

### Step 3: Diagnose a Failure Without Modifying Code

Before running any repair, you can inspect what went wrong using the `diagnose` command:

```bash
npx pw-intel diagnose ./test-results/login-test-chromium/trace.zip
```

Terminal output:
```text
╔══════════════════════════════════════════════════════════════════════╗
║             PLAYWRIGHT INTELLIGENCE ENGINE: DIAGNOSTIC REPORT        ║
╚══════════════════════════════════════════════════════════════════════╝

Root Cause Classification : LOCATOR_DRIFT
Confidence Level          : 94.0%
Failure Fingerprint       : failure-9c41a7d2e0811b33
Action Outcome            : 🟢 REPAIRABLE
────────────────────────────────────────────────────────────────────────
Failed Action Details:
  • Call ID     : call@14
  • Method      : page.click
  • Selector    : #doLogin_outdated_v2
  • Error       : locator.click: Timeout 5000ms exceeded waiting for locator('#doLogin_outdated_v2')
────────────────────────────────────────────────────────────────────────
Evidence Provenance:
  • DOM Snapshot Available : ✅ YES
  • Network Logs Ingested  : ✅ YES (28 events)
  • Source Code Mapped     : ✅ tests/pages/LoginPage.ts:24
────────────────────────────────────────────────────────────────────────
Analysis:
  Target element with ID '#doLogin_outdated_v2' was removed from the DOM.
  Snapshot analysis identified accessible candidate button matching role:
  page.getByRole('button', { name: 'Log in' })
────────────────────────────────────────────────────────────────────────
```

---

### Step 4: Autonomous Repair & Worktree Verification

To trigger the repair workflow across failed traces, run a **dry-run** first:

```bash
npx pw-intel repair
```

In dry-run mode, `pw-intel`:
1. Discovers the traces in `test-results/`.
2. Proposes candidate locator fixes.
3. Tests each fix in an isolated Git worktree sandbox.
4. Outputs the exact verified diff without touching your working tree.

When you are ready to apply the verified repairs to your source files:

```bash
npx pw-intel repair --apply --verbose
```

Terminal output:
```json
{
  "status": "REPAIRED_AND_VERIFIED",
  "tier": "tier1_deterministic",
  "targetFilePath": "tests/pages/LoginPage.ts",
  "healedLocator": "page.getByRole('button', { name: 'Log in' })",
  "reason": "Stale ID selector replaced with stable accessible role locator verified in DOM snapshot.",
  "verification": {
    "sandbox": "git-worktree",
    "testsExecuted": 1,
    "testsPassed": 1,
    "exitCode": 0
  },
  "promotedFiles": [
    "tests/pages/LoginPage.ts"
  ]
}
```

Now, checking `git diff tests/pages/LoginPage.ts` shows the exact surgical replacement:

```diff
- this.loginButton = this.page.locator('#doLogin_outdated_v2');
+ this.loginButton = this.page.getByRole('button', { name: 'Log in' });
```

---

### Step 5: What Happens on Real Regressions (The Negative Control Test)

What if the application itself is broken?

Suppose an endpoint returns a 500 internal server error during login:

```ts
// Simulating a backend crash:
await page.route('**/api/auth/login', route => route.fulfill({ status: 500 }));
```

When you run `npx pw-intel repair --apply`, Gate 0 triggers immediately:

```text
status: ABSTAINED
tier: negative_control
reason: Backend service error (HTTP 500) observed during auth action.
promotedFiles: []
```

- **Tokens used:** 0
- **Cost:** $0.00
- **Source files changed:** None

Instead of pretending the test was fixed, `pw-intel` can even generate a ready-to-file GitHub/Jira bug ticket with the full network HAR and curl command:

```bash
npx pw-intel report-defect ./test-results/failed-trace/trace.zip
```

---

## When a Repair Fails Verification

What happens if an LLM proposes a locator that looks syntactically valid, but doesn't actually work when the browser runs?

In our real-world testbed benchmarks, we evaluated an Epic-Stack login test where an LLM candidate proposed an alternative form submission locator. When `pw-intel` spun up the isolated worktree sandbox and ran Playwright:

```json
{
  "status": "VERIFICATION_FAILED",
  "tier": "tier2_llm",
  "targetFilePath": "tests/e2e/epic-login.test.ts",
  "reason": "Test execution failed in isolated worktree with repaired code.",
  "promotedFiles": []
}
```

Because the test failed in the isolated sandbox, **the patch was rejected immediately and your local files remained completely clean.**

This is the ultimate safety guarantee: **`pw-intel` never promotes an unproven fix to your codebase.**

---

## Core Command Summary

| Command | Purpose |
| :--- | :--- |
| `npx pw-intel doctor` | Verifies Node, Git, Playwright, and environment readiness. |
| `npx pw-intel init` | Initializes project configuration and optional LLM keys. |
| `npx pw-intel diagnose <trace>` | Ingests a trace and outputs causal diagnosis without modifying code. |
| `npx pw-intel repair` | Dry-run repair: diagnoses traces and verifies patches in a sandbox. |
| `npx pw-intel repair --apply` | Promotes only patches that pass isolated worktree execution. |
| `npx pw-intel report-defect <trace>` | Emits an issue-ready bug report for backend/network failures. |
| `npx pw-intel qa <feature>` | Evidence-driven brownfield/greenfield test generation. |
| `npx pw-intel mcp` | Starts the Model Context Protocol stdio server for Cursor and Claude. |

---

## Conclusion: Evidence Over Guesswork

Self-healing in UI test automation should not mean guessing new selectors or masking application defects. It should mean:
1. Identifying whether the problem is in the UI or the backend.
2. Formulating targeted locator repairs using accessible roles.
3. Proving that the fix works in a clean, isolated sandbox before committing.
4. Preserving test assertions without compromise.
5. Empowering developers inside their IDE via MCP.

By grounding repairs in Playwright trace evidence and isolated Git execution, `pw-intel` provides a trustworthy maintenance assistant that respects the integrity of your test suite.

---

### Resources & Open Source

- **npm Package**: [https://www.npmjs.com/package/playwright-intelligence-engine](https://www.npmjs.com/package/playwright-intelligence-engine)
- **GitHub Repository**: [https://github.com/lst2121/playwright-intelligence-engine](https://github.com/lst2121/playwright-intelligence-engine)
- **Issue Tracker & Discussions**: [https://github.com/lst2121/playwright-intelligence-engine/issues](https://github.com/lst2121/playwright-intelligence-engine/issues)
