---
title: "How to Self-Heal Broken Playwright Tests from Traces with pw-intel"
published: false
description: "A hands-on, step-by-step developer tutorial for diagnosing failing Playwright traces, repairing drifted locators, and using Cursor/Claude via MCP."
tags: playwright, testing, typescript, automation
---

# How to Self-Heal Broken Playwright Tests from Traces with pw-intel

Every engineer who maintains a Playwright test suite knows this failure:

```text
locator.click: Test timeout exceeded
waiting for locator('#checkout-button-old')
```

UI changes break tests all the time. But fixing them manually is tedious: you open the Playwright trace viewer, inspect DOM snapshots, find the renamed selector, update your Page Object or spec file, and rerun the test.

Worse, sometimes the selector didn't break because of UI drift—it broke because a backend API threw an HTTP 500, a mock didn't load, or the session expired. Blindly updating the locator in those situations masks a real application regression.

In this tutorial, you will learn how to use **`pw-intel` (Playwright Intelligence Engine)** to:
1. Capture rich failure traces in Playwright.
2. Run a causal diagnosis to distinguish UI drift from application bugs.
3. Automatically heal drifted locators with isolated Git worktree verification.
4. Verify that `pw-intel` safely abstains when the application itself is failing.
5. Connect `pw-intel` to **Cursor** and **Claude Code** via the built-in **Model Context Protocol (MCP)** server.

---

## What is `pw-intel`?

`pw-intel` is an open-source CLI companion for Microsoft Playwright. It reads failed Playwright trace archives (`trace.zip`) and runs a two-tier verification pipeline:

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
[Tier 2: Semantic LLM] ───────── Semantic role match ────────► Adaptive Fallback (Assertions Immutable)
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

### Key Capabilities:
- **Tier 1 ($0 Token Cost):** Instant, local TypeScript AST fixes (`ts-morph`) for renamed IDs, classes, and attributes.
- **Tier 2 (AI Semantic Fallback):** Engages an LLM when DOM structure shifts significantly (e.g. converting native inputs to custom React comboboxes or modals), without ever touching assertions.
- **Fail-Closed Safety (Gate 0):** Abstains from editing UI locators if the trace shows an HTTP 500 backend error or network timeout.
- **Proof-Before-Promotion:** Re-runs the affected test in a disposable Git worktree sandbox before touching your active workspace.
- **MCP Server:** Exposes full diagnostic, repair, and test generation capabilities to AI coding assistants.

---

## Prerequisites

- **Node.js**: v20.0.0 or higher
- **Git**: Installed and initialized in your repository (used for isolated worktree sandboxing)
- **Playwright**: `@playwright/test` installed

Install `playwright-intelligence-engine` as a development dependency:

```bash
npm install --save-dev playwright-intelligence-engine
```

Run the built-in diagnostic healthcheck:

```bash
npx pw-intel doctor
```

Expected output:
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

Initialize your repository:

```bash
npx pw-intel init
```

---

## Step 1: Configure Trace Retention on Failure

`pw-intel` requires Playwright’s trace archive to inspect DOM snapshots, network calls, and action timelines.

In your `playwright.config.ts`, ensure `trace` is enabled for failures:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

---

## Step 2: Simulate a Locator Drift

Let’s simulate a common real-world scenario: a login button selector changed in the frontend code.

Original test in `tests/ui/auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Should login successfully with valid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#username').fill('standard_user');
  await page.locator('#password').fill('secret_sauce');
  
  // Drift injected: old selector '#login-button-v1' no longer exists in the DOM
  await page.locator('#login-button-v1').click();

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
waiting for locator('#login-button-v1')
```

---

## Step 3: Diagnose the Trace with `pw-intel`

Before making any repairs, inspect what the engine sees inside the trace:

```bash
npx pw-intel diagnose test-results/auth-Should-login-successfully-chromium/trace.zip
```

Terminal output:
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
  • Selector    : #login-button-v1
  • Error       : locator.click: Timeout 5000ms exceeded waiting for locator('#login-button-v1')
────────────────────────────────────────────────────────────────────────
Evidence Provenance:
  • DOM Snapshot Available : ✅ YES
  • Network Logs Ingested  : ✅ YES (32 events)
  • Source Code Mapped     : ✅ tests/ui/auth.spec.ts:9
────────────────────────────────────────────────────────────────────────
Analysis:
  Target element '#login-button-v1' was not found in the DOM.
  Snapshot analysis identified stable accessible replacement:
  page.getByRole('button', { name: 'Login' })
────────────────────────────────────────────────────────────────────────
```

---

## Step 4: Run Dry-Run Repair

Execute the autonomous repair workflow in dry-run mode (default):

```bash
npx pw-intel repair
```

What `pw-intel` does during this step:
1. Locates all failure traces in `test-results/`.
2. Matches the failed action against the AST of `tests/ui/auth.spec.ts`.
3. Derives the accessible role replacement `page.getByRole('button', { name: 'Login' })`.
4. Creates a temporary Git worktree and runs Playwright against the candidate fix in isolation.
5. Prints the verified diff without modifying any file in your active workspace.

---

## Step 5: Apply Verified Repairs to Your Workspace

When you are ready to apply the fix:

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
  "reason": "Obsolete ID selector replaced with stable accessible role locator verified in DOM snapshot.",
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

Check `git diff`:

```diff
- await page.locator('#login-button-v1').click();
+ await page.getByRole('button', { name: 'Login' }).click();
```

Now rerun the test locally:

```bash
npx playwright test tests/ui/auth.spec.ts
```
```text
1 passed (3.2s)
```

The test is completely fixed and verified!

---

## Step 6: Negative-Control Test (HTTP 500 Server Crash)

Now test the safety guardrail: what happens if the test fails because the backend server crashed?

Add a mock route that returns an HTTP 500 when logging in:

```ts
test('Should handle backend failure', async ({ page }) => {
  // Injected server failure:
  await page.route('**/api/login', route => route.fulfill({ status: 500 }));

  await page.goto('/login');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/.*inventory/);
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
reason: Backend service error (HTTP 500) observed during auth action.
promotedFiles: []
```

- **Tokens consumed**: 0
- **Cost**: $0.00
- **Modified files**: None

`pw-intel` refrains from making changes because the failure is an application bug, not a broken test. You can even generate a bug report directly:

```bash
npx pw-intel report-defect test-results/failed-trace/trace.zip
```

---

## Step 7: Cursor & Claude Code IDE Integration via MCP

Instead of running CLI commands manually, you can plug `pw-intel` directly into your AI coding assistant using the **Model Context Protocol (MCP)**.

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
- **`pw_intel_batch_repair`**: Analyzes all failing traces across the repo in parallel and promotes passing fixes in one go.
- **`pw_intel_profile`**: Discovers your project's Page Objects, fixtures, and locator patterns so generated code looks native.
- **`run_qa_pipeline`**: Generates full E2E suites from natural language requirements (`pw-intel qa`).

Now you can simply ask Cursor:
> *"Cursor, run pw_intel_diagnose on my latest failure in `test-results/` and repair the Page Object if it passed worktree verification."*

---

## CLI Command Quick Reference

| Command | Usage | Description |
| :--- | :--- | :--- |
| `doctor` | `npx pw-intel doctor` | Inspects Node, Git, Playwright & environment readiness |
| `init` | `npx pw-intel init` | Initializes `.pie/config.json` |
| `diagnose` | `npx pw-intel diagnose <trace.zip>` | Ingests a trace and outputs root cause diagnosis |
| `repair` | `npx pw-intel repair` | Dry-run repair verified in an isolated worktree sandbox |
| `repair --apply` | `npx pw-intel repair --apply` | Applies only sandbox-verified repairs to your workspace |
| `report-defect` | `npx pw-intel report-defect <trace.zip>` | Emits an issue-ready bug report with HAR & network telemetry |
| `qa` | `npx pw-intel qa <featureName>` | Evidence-driven test generation matching repository conventions |
| `mcp` | `npx pw-intel mcp` | Starts the Model Context Protocol stdio server for Cursor/Claude |

---

## Summary

`pw-intel` turns test maintenance from manual guesswork into a rigorous, evidence-driven process:
- **Offline Fast-Path**: 100% deterministic AST repairs at $0 token cost.
- **Fail-Closed Gate 0**: Abstains when the application or environment crashes.
- **Sandbox Proof**: Never touches your working tree unless the repair passes in an isolated Git worktree.
- **Assertion Safety**: Asserts remain strictly immutable.
- **First-Class MCP**: Direct native integration into Cursor, Windsurf, and Claude.

Give it a try in your repository and let us know what you think!

- **npm**: [https://www.npmjs.com/package/playwright-intelligence-engine](https://www.npmjs.com/package/playwright-intelligence-engine)
- **GitHub**: [https://github.com/lst2121/playwright-intelligence-engine](https://github.com/lst2121/playwright-intelligence-engine)
