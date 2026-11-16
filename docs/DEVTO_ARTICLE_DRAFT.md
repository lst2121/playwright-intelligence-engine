---
title: "How to Self-Heal Broken Playwright Tests from Traces with PIE"
published: false
description: "A hands-on, step-by-step developer tutorial for diagnosing failing Playwright traces, repairing drifted locators, and using Cursor/Claude via the PIE MCP server."
tags: playwright, ai, testing, typescript
---

# How to Self-Heal Broken Playwright Tests from Traces with PIE

Every engineer who maintains a Playwright test suite knows this failure:

```text
locator.click: Test timeout exceeded
waiting for locator('#login-button-old')
```

> **TL;DR:** **PIE (Playwright Intelligence Engine)**, invoked via the CLI as `pw-intel`, reads a failed Playwright `trace.zip`, decides whether the **app** or the **test** is broken, and only if it is the test does it rewrite the locator — proving the fix in a throwaway Git worktree sandbox before touching your code. Tier 1 is offline AST (**$0 tokens**); Gate 0 refuses to repair when the backend returns HTTP 500s.

UI changes break tests all the time. But fixing them manually is tedious: you open the Playwright trace viewer, inspect DOM snapshots, find the renamed selector, update your Page Object or spec file, and rerun the test.

Worse, sometimes the selector didn't break because of UI drift—it broke because a backend API threw an HTTP 500, a mock didn't load, or the session expired. Blindly updating the locator in those situations masks a real application regression.

In this tutorial, you will learn how to use **PIE (Playwright Intelligence Engine)**, invoked via the **`pw-intel`** CLI, to:
1. Capture rich failure traces in Playwright.
2. Run a causal diagnosis to distinguish UI drift from application bugs.
3. Automatically heal drifted locators with isolated Git worktree verification.
4. Verify that PIE safely abstains when the application itself is failing.
5. Connect PIE directly to **Cursor** and **Claude Code** via its built-in **Model Context Protocol (MCP)** server.

---

## What is PIE?

**PIE (Playwright Intelligence Engine)** is an open-source CLI and AI companion for Microsoft Playwright. It reads failed Playwright trace archives (`trace.zip`) and runs a two-tier verification pipeline:

```text
Trace (.zip)
     │
     ▼
[Gate 0: Negative Controls] ─── Server 500 / API Failure? ───► ABSTAIN (No code modified)
     │ No (UI Drift)
     ▼
[Tier 1: AST Fast-Path] ──────── Stable DOM snapshot match? ──► Deterministic Repair ($0 Cost)
     │ Dynamic / Complex DOM
     ▼
[Tier 2: Semantic LLM] ───────── Semantic role match ────────► Adaptive Fallback (Assertions Structurally Immutable)
     │
     ▼
[Headless Git Worktree Sandbox] ─ Isolated Execution ────────► Run exact test in sandbox
     │
  ┌──┴──┐
 Pass  Fail
  │     │
  ▼     ▼
Promote Reject patch & leave working tree clean
```

### Key Capabilities of PIE:
- **Tier 1 ($0 Token Cost):** Instant, local TypeScript AST fixes (`ts-morph`) for renamed IDs, classes, and attributes.
- **Tier 2 (AI Semantic Fallback):** Engages an LLM only when DOM structure shifts significantly (e.g. converting native inputs to custom React comboboxes or modals), without ever touching assertions.
- **Fail-Closed Safety (Gate 0):** Abstains from editing UI locators if the trace shows an HTTP 500 backend error or network timeout.
- **Proof-Before-Promotion:** Re-runs the affected test in a disposable Git worktree sandbox before touching your active workspace.
- **Native MCP Server:** Exposes full diagnostic, repair, and test generation capabilities to AI coding assistants like Cursor and Claude.

---

## Prerequisites & Requirements

- **Node.js**: v20.0.0 or higher
- **Git**: Installed and initialized in your repository (used for isolated worktree sandboxing)
- **Playwright**: `@playwright/test` installed

Install PIE in your Playwright project:

```bash
npm install --save-dev playwright-intelligence-engine
```

*(Legend: `PIE` = Product Name · `pw-intel` = Canonical CLI Command · `pie` = Alias).*

Run PIE's built-in diagnostic healthcheck:

```bash
npx pw-intel doctor
```

Expected output:
```text
Running Playwright Intelligence Engine Diagnostic Healthcheck (pw-intel doctor)...

  ✓ Node.js Runtime     : v24.19.0 (Supported >= 20.0.0)
  ✓ Git Version Control : git version 2.44.0.windows.1
  ✓ Playwright Test     : ^1.64.1 (Found in package.json)
  ✓ Workspace Access    : Read/Write verified for '<cwd>'
  ✓ Host Platform       : win32 (x64)
  ✓ LLM Provider        : None configured (100% offline deterministic mode active)

Healthcheck Verdict: HEALTHY (Ready for diagnostic and repair workflows)
```

Initialize your repository:

```bash
npx pw-intel init
```

---

## Step 1: Configure Trace Retention on Failure

PIE requires Playwright’s trace archive to inspect DOM snapshots, network calls, and action timelines.

In your `playwright.config.ts`, ensure `baseURL` and `trace` are configured:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    baseURL: 'https://www.saucedemo.com',
    trace: 'retain-on-failure',
  },
});
```

---

## Step 2: Reproduce a Controlled Locator Drift

Let’s simulate a common real-world scenario against a live public demo app (`saucedemo.com`): a login button selector changed in the frontend code.

Create `tests/ui/auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Should login successfully with valid credentials', async ({ page }) => {
  await page.goto('/');
  await page.locator('#user-name').fill('standard_user');
  await page.locator('#password').fill('secret_sauce');
  
  // Drift injected: old selector '#login-button-stale' does not exist in the DOM
  await page.locator('#login-button-stale').click();

  await expect(page).toHaveURL(/.*inventory/);
});
```

Run the test to capture the failure trace:

```bash
npx playwright test tests/ui/auth.spec.ts --trace=on
```

Playwright fails with a timeout and writes the trace archive to `test-results/`:

```text
locator.click: Timeout 5000ms exceeded.
waiting for locator('#login-button-stale')
```

---

## Step 3: Diagnose the Trace with PIE

Before making any repairs, inspect what PIE sees inside the trace without modifying code:

```bash
npx pw-intel diagnose test-results/auth-Should-login-successfully-chromium/trace.zip
```

*(Illustrative diagnosis output):*
```text
╔══════════════════════════════════════════════════════════════════════╗
║             PLAYWRIGHT INTELLIGENCE ENGINE: DIAGNOSTIC REPORT        ║
╚══════════════════════════════════════════════════════════════════════╝

Root Cause Classification : LOCATOR_DRIFT
Confidence Level          : 94.0%
Failure Fingerprint       : failure-8a71b2d019f
Action Outcome            : 🟢 REPAIRABLE
────────────────────────────────────────────────────────────────────────
Failed Action Details:
  • Call ID     : call@18
  • Method      : page.click
  • Selector    : #login-button-stale
  • Error       : locator.click: Timeout 5000ms exceeded waiting for locator('#login-button-stale')
────────────────────────────────────────────────────────────────────────
Evidence Provenance:
  • DOM Snapshot Available : ✅ YES
  • Network Logs Ingested  : ✅ YES (12 events)
  • Source Code Mapped     : ✅ tests/ui/auth.spec.ts:9
────────────────────────────────────────────────────────────────────────
Analysis:
  Target element '#login-button-stale' was not found in the DOM.
  Snapshot analysis identified stable accessible replacement:
  page.getByRole('button', { name: 'Login' })
────────────────────────────────────────────────────────────────────────
```

---

## Step 4: Dry-Run Inspection vs. Sandbox Verification

PIE offers granular control over repair execution:

### A. Dry-Run Proposal (Inspection Only)
```bash
npx pw-intel repair
```
*Emits the proposed diff and diagnostic analysis without modifying your workspace.*

### B. Isolated Worktree Execution (No Local Changes)
```bash
npx pw-intel repair --execute
```
*Creates a temporary Git worktree sandbox, applies the proposed patch, and runs Playwright in isolation to verify the fix works before promoting.*

---

## Step 5: Apply Verified Repairs to Your Workspace

When you are ready to apply verified repairs atomically:

```bash
npx pw-intel repair --apply --verbose
```

Terminal output:
```json
{
  "status": "REPAIRED_AND_VERIFIED",
  "tier": "tier1_deterministic",
  "targetFilePath": "tests/ui/auth.spec.ts",
  "healedLocator": "page.getByRole('button', { name: 'Login' })",
  "reason": "Obsolete selector replaced with stable accessible role locator verified in DOM snapshot.",
  "verification": {
    "sandbox": "git-worktree",
    "testsExecuted": 1,
    "testsPassed": 1,
    "exitCode": 0
  },
  "promotedFiles": [
    "tests/ui/auth.spec.ts"
  ]
}
```

PIE prints its spend telemetry:
```text
Repair Telemetry:
  • Fast-Path AST   : 1 trace (0 tokens, $0.000000 USD)
  • Semantic LLM    : 0 traces (0 tokens, $0.000000 USD)
  • Worktree Sandboxes: 1 created, 1 verified, 1 pruned
```

Check `git diff`:

```diff
- await page.locator('#login-button-stale').click();
+ await page.getByRole('button', { name: 'Login' }).click();
```

Now rerun the test locally:

```bash
npx playwright test tests/ui/auth.spec.ts
```
```text
1 passed (2.8s)
```

---

## Step 6: Negative-Control Test (HTTP 500 Server Crash)

Now test PIE's safety guardrail: what happens if the test fails because the backend server crashed?

Simulate a backend 500 crash on your application's actual auth or data endpoint:

```ts
test('Should handle backend failure', async ({ page }) => {
  // Injected server failure (replace URL with your application's real auth/data route):
  await page.route('**/api/v1/auth', route =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal Server Error' }),
    }),
  );

  await page.goto('/login');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/.*dashboard/);
});
```

Run the test to capture the failure trace, then invoke repair:

```bash
npx pw-intel repair --apply --verbose
```

Gate 0 triggers immediately:

```text
status: ABSTAINED
tier: negative_control
reason: Backend service error (HTTP 500) observed during tested action.
promotedFiles: []
```

- **Tokens consumed**: 0
- **Cost**: $0.00
- **Modified files**: None

PIE refrains from making changes because the failure is an application bug, not a broken test. You can even generate a bug report directly:

```bash
npx pw-intel report-defect test-results/failed-trace/trace.zip
```

---

## Step 7: Cursor & Claude Code IDE Integration via MCP

Instead of running CLI commands manually, you can plug PIE directly into your AI coding assistant using the **Model Context Protocol (MCP)**.

### Setting up in Cursor / Windsurf
Add to your project's `.cursor/mcp.json`:

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

### Setting up in Claude Desktop / Claude Code
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

### Available MCP Tools for Your Assistant:
- **`pw_intel_diagnose`**: Diagnoses `trace.zip` archives with DOM, network, and error evidence directly in your chat prompt.
- **`pw_intel_autonomous_repair`**: Formulates a repair, spins up a headless sandbox, verifies the patch, and promotes it cleanly.
- **`pw_intel_batch_repair`**: Discovers all failing traces across the repo in parallel, verifies them in isolated worktrees, and promotes verified fixes in one pass.
- **`pw_intel_profile`**: Discovers your project's Page Objects, fixtures, and locator patterns so generated code looks native.
- **`run_qa_pipeline`**: Generates full E2E suites from natural language requirements (`pw-intel qa`).

Now you can simply ask Cursor:
> *"Cursor, diagnose the failing trace in `test-results/` and use PIE to repair the Page Object if it passes worktree verification."*

---

## CLI Command Quick Reference

| Command | Usage | Description |
| :--- | :--- | :--- |
| `doctor` | `npx pw-intel doctor` | Inspects Node, Git, Playwright & environment readiness |
| `init` | `npx pw-intel init` | Initializes `.pie/config.json` |
| `diagnose` | `npx pw-intel diagnose <trace.zip>` | Ingests a trace and outputs root cause diagnosis |
| `repair` | `npx pw-intel repair` | Inspection dry-run: emits repair proposal without executing |
| `repair --execute` | `npx pw-intel repair --execute` | Verifies repair proposal in an isolated Git worktree |
| `repair --apply` | `npx pw-intel repair --apply` | Applies only sandbox-verified repairs to your workspace |
| `report-defect` | `npx pw-intel report-defect <trace.zip>` | Emits an issue-ready bug report with HAR & network telemetry |
| `qa` | `npx pw-intel qa <featureName>` | Evidence-driven test generation matching repository conventions |
| `mcp` | `npx pw-intel mcp` | Starts the Model Context Protocol stdio server for Cursor/Claude |

---

## Summary

**PIE** turns test maintenance from manual guesswork into a rigorous, evidence-driven process:
- **Offline Fast-Path**: 100% deterministic AST repairs at $0 token cost.
- **Fail-Closed Gate 0**: Abstains when the application or environment crashes.
- **Sandbox Proof**: Never touches your working tree unless the repair passes in an isolated Git worktree.
- **Assertion Safety**: Asserts remain structurally immutable.
- **First-Class MCP**: Direct native integration into Cursor, Windsurf, and Claude.

Give it a try in your repository and let us know what you think!

- **npm**: [https://www.npmjs.com/package/playwright-intelligence-engine](https://www.npmjs.com/package/playwright-intelligence-engine)
- **GitHub**: [https://github.com/lst2121/playwright-intelligence-engine](https://github.com/lst2121/playwright-intelligence-engine)
