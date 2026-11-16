---
title: "Building PIE: How We Designed an Evidence-Driven AI Repair Engine for Playwright"
subtitle: "Beyond naive self-healing: Combining deterministic AST analysis, bounded LLM context, and isolated Git sandboxing to fix broken UI tests safely."
author: "Lokender Singh"
status: "Production Ready Editorial"
recommended_read_time: "10–12 minutes"
---

# Building PIE: How We Designed an Evidence-Driven AI Repair Engine for Playwright

*Beyond naive self-healing: Combining deterministic AST analysis, bounded LLM context, and isolated Git sandboxing to fix broken UI tests safely.*

At 2:14 AM, a Playwright test job fails in your continuous integration pipeline.

The error message is classic:

```text
locator.click: Test timeout exceeded
waiting for locator('#login-button-old')
```

Every engineer who maintains browser test suites knows the drill. You open the trace viewer, find where a frontend developer renamed the button ID, edit the selector in your Page Object, push a commit, and wait for CI to run again.

Sometimes, updating that selector is the right fix.

**But often, it is a dangerous trap.**

A missing button is frequently the visible downstream symptom of something else entirely:
- An authentication session timed out unexpectedly.
- A backend microservice threw an HTTP 500 during data seeding.
- A database fixture failed to populate.
- The page failed to transition because of an unhandled runtime error.

If an AI tool or an engineer hastily rewrites the locator to whatever else happens to be visible on the screen, **it does not repair the test—it destroys regression signal.** You turn an alert about a broken application into a silently passing green checkmark.

To solve this, we built **PIE — the Playwright Intelligence Engine** (invoked in your terminal as `pw-intel`).

We spent months engineering and verifying PIE across real-world testbeds to solve three critical engineering questions:
1. How do you distinguish between real application defects and simple test drift?
2. How do you feed an LLM *only* what it strictly needs to know—redacting secrets and isolating evidence—without drowning it in noisy DOM dumps?
3. How do you mathematically guarantee that an AI-generated repair never promotes broken code or weakens assertions?

Here is an inside look at how PIE works under the hood, how it uses AI responsibly, and how to get started in your own project.

---

## 1. Getting Started: Installing and Initializing PIE

PIE is packaged as `playwright-intelligence-engine` and works as a zero-friction companion to `@playwright/test`. It requires **Node.js >= 20** and **Git**.

### Installation

Install PIE in your Playwright project:

```bash
npm install --save-dev playwright-intelligence-engine
```

*(Note: The primary CLI executable is `pw-intel`. The short alias `pie` is also available).*

### Environment Healthcheck

Before running any repairs, verify your local readiness:

```bash
npx pw-intel doctor
```

Terminal output:
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

### Initializing Configuration

Run `init` to discover your workspace structure and configure your settings:

```bash
npx pw-intel init
```

This creates a project-local `.pie/config.json` that records your package manager, test directories, and locator preferences without touching any test code.

#### Optional: Configuring an LLM Key
Trace diagnosis, Gate 0 negative control filtering, and Tier 1 AST repairs run **100% offline and locally at $0 cost** without an LLM key. An API key is only needed if you want Tier 2 complex semantic repairs or AI-assisted test generation:

```bash
# Set via environment variable
export PIE_LLM_API_KEY="sk-..."
export PIE_LLM_MODEL="gemini-2.5-pro" # or gpt-4o, claude-3-5-sonnet

# Or add directly to your project .env:
# PIE_LLM_API_KEY=sk-...
# PIE_LLM_MODEL=gemini-2.5-pro
```

### Enable Tracing in Playwright
PIE operates on Playwright trace files (`trace.zip`). In your `playwright.config.ts`, ensure `retain-on-failure` is active:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

---

## 2. The Architecture: Two-Tier Intelligence

Most "AI self-healing" tools take a naive approach: grab the failing error message, dump the entire page HTML into an LLM prompt, and ask it to write a new selector.

This naive approach suffers from three fatal flaws:
1. **Context Pollution:** Raw DOM dumps consume tens of thousands of tokens and hallucinate matches on unrelated elements.
2. **Security & Privacy Leaks:** Raw traces contain auth tokens, cookies, passwords, and PII.
3. **Assertion Dilution:** LLMs love to "fix" tests by removing failing `expect(...)` assertions or loosening timeouts.

PIE was designed from the ground up to prevent these failures through a gated, two-tier architecture:

```text
Playwright Trace (.zip)
         │
         ▼
[Gate 0: Negative Controls] ─── Server 500 / Network Error? ───► ABSTAIN ($0 Tokens, 0 Code Changes)
         │ No (Pure UI Drift)
         ▼
[Tier 1: AST Fast-Path] ──────── Stable DOM snapshot match? ────► Deterministic Local Fix ($0 Cost, <50ms)
         │ Complex DOM Shift
         ▼
[Evidence Redactor & Slicer] ─── Filter & sanitize context ─────► Minimal Targeted Evidence Bundle
         │
         ▼
[Tier 2: Semantic AI Agent] ──── Structural Intent Reasoning ───► Proposed Patch (Assertions Strictly Immutable)
         │
         ▼
[Headless Git Worktree Sandbox] ── Isolated Playwright Run ─────► Re-execute exact test in disposable branch
         │
    ┌────┴────┐
    │         │
  Passed    Failed
    │         │
    ▼         ▼
Promote     Reject candidate & leave
to branch   source code untouched
```

---

## 3. How PIE Uses AI: The "Need-to-Know" Principle

Not everything in PIE is deterministic. When a frontend evolves from a standard `<select>` dropdown into a dynamic React combobox with nested ARIA dialogs, deterministic AST matching is not enough. You need semantic reasoning.

However, PIE enforces strict **context isolation**:

### A. The Evidence Slicer & Privacy Redactor
Before an LLM ever sees a prompt, PIE’s `EvidenceRedactor` strips:
- Authorization headers (`Bearer tokens`, `cookies`, `JWTs`)
- Credit card numbers, SSNs, and passwords
- Irrelevant DOM branches (only elements within the bounding box of the user interaction are preserved)

Instead of sending 2 MB of HTML, the model receives a compact **Evidence Bundle**:
- The exact failing statement and surrounding 5 lines of code.
- The immediate before/action/after snapshot diff.
- The accessible tree (ARIA roles, accessible names) of the interactive target.

### B. Assertion Invariance is Non-Negotiable
In PIE's AST patcher, **test assertions are cryptographically locked**:
```ts
// If a proposed patch alters this line:
await expect(page.getByRole('heading')).toHaveText('Order Confirmed');
```
The patch is immediately rejected by the AST parser before verification even starts. An AI tool must fix the path to the assertion—it must never alter the goalpost.

---

## 4. Seeing It in Action: Real Terminal Workflows

Let's look at how PIE behaves in real situations.

### Scenario A: Diagnosing a Stale Locator

When a button ID drifts, run `diagnose`:

```bash
npx pw-intel diagnose ./test-results/login-failure/trace.zip
```

Output:
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

### Scenario B: Dry-Run and Verified Repair

To see what PIE would heal without touching your codebase:

```bash
npx pw-intel repair
```

When you are ready to apply verified fixes:

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

Git diff in `LoginPage.ts`:
```diff
- this.loginButton = this.page.locator('#doLogin_outdated_v2');
+ this.loginButton = this.page.getByRole('button', { name: 'Log in' });
```

### Scenario C: Backend Crashes (The Negative Control Abstention)

If your test fails because an API returned an HTTP 500:

```bash
npx pw-intel repair --apply --verbose
```

Gate 0 detects the 500 error in the trace and halts immediately:
```text
status: ABSTAINED
tier: negative_control
reason: Backend service error (HTTP 500) observed during auth action.
promotedFiles: []
```
- **Tokens used:** 0
- **Cost:** $0.00
- **Source files modified:** 0

You can even emit a ready-to-file defect issue with reproduction curl and HAR data:

```bash
npx pw-intel report-defect ./test-results/failed-trace/trace.zip
```

---

## 5. Integrating with Cursor & Claude Code via MCP

Developers shouldn't have to leave their IDE to leverage PIE.

PIE includes a built-in **Model Context Protocol (MCP)** server. This allows AI assistants like **Cursor**, **Windsurf**, and **Claude Code** to directly call PIE's diagnostic and repair engines.

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

### Available MCP Tools:
- **`pw_intel_diagnose`**: Ingests `trace.zip` and explains root causes directly in chat.
- **`pw_intel_autonomous_repair`**: Repairs Page Objects and runs isolated Git sandbox proofs.
- **`pw_intel_profile`**: Teaches the AI your repository’s specific Page Object conventions.
- **`run_qa_pipeline`**: Generates full E2E test suites from natural language specifications (`pw-intel qa`).

Now, you can prompt Cursor:
> *"Cursor, diagnose the failing trace in `test-results/` and run `pw_intel_autonomous_repair` to fix CartPage.ts if the test passes in the sandbox."*

---

## 6. Summary: Safety and Trust Over Hype

Test automation tools earn adoption not through flashy demos, but through **dependability**. If a developer has to spend 20 minutes double-checking whether an automated fix broke another test or masked a real bug, they will turn the tool off.

PIE’s design philosophy is simple:
1. **Diagnose First:** Never heal a test when the application is actually broken.
2. **Deterministic Fast-Path:** Use local AST matching for $0 token cost whenever possible.
3. **Selective AI Context:** Supply LLMs only with minimal, redacted, relevant evidence.
4. **Isolated Proof:** Every patch must prove itself in a Git worktree sandbox before touching your code.
5. **Assertion Invariance:** Never weaken the test's original assertions.

By grounding repairs in trace evidence and isolated verification, PIE transforms test maintenance from a fragile chore into a reliable engineering workflow.

---

### Links & Resources

- **npm Package**: [https://www.npmjs.com/package/playwright-intelligence-engine](https://www.npmjs.com/package/playwright-intelligence-engine)
- **GitHub Repository**: [https://github.com/lst2121/playwright-intelligence-engine](https://github.com/lst2121/playwright-intelligence-engine)
- **Issue Tracker & Discussions**: [https://github.com/lst2121/playwright-intelligence-engine/issues](https://github.com/lst2121/playwright-intelligence-engine/issues)
