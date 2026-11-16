---
name: pie-setup
description: >-
  Audits, initializes, and configures Playwright Intelligence Engine (PIE) in any Playwright workspace.
  Verifies Node/Git/Playwright prerequisites, initializes .pie configuration, and ensures trace
  retention is active in playwright.config.ts without disturbing existing test suites.
---

# PIE Setup & Workspace Readiness Skill

Use this skill when onboarding a Playwright repository to PIE (`playwright-intelligence-engine` / `pw-intel`).

## Execution Runbook

### Step 1: Healthcheck & Prerequisite Audit
Execute the built-in diagnostic healthcheck from the target workspace root:

```bash
npx pw-intel doctor
```

Verify the output:
- **Node.js Runtime:** Version $\ge$ 20.0.0.
- **Git Repository:** Git initialized and workspace accessible.
- **Playwright Test:** `@playwright/test` detected in dependencies.
- **LLM Provider:** Note whether active or running in 100% offline deterministic mode ($0 spend).

*If any prerequisite fails:* Stop and report the exact remediation (e.g., run `git init` or `npm install --save-dev @playwright/test`).

---

### Step 2: Initialize PIE Configuration
If `.pie/config.json` does not exist in the workspace root, initialize it:

```bash
npx pw-intel init
```

*Optional AI Key:* If the user has an OpenAI or custom LLM key and desires semantic test generation:
```bash
npx pw-intel init --api-key <KEY> --model gpt-4o
```
*(Otherwise, default offline deterministic mode is active).*

---

### Step 3: Audit `playwright.config.ts` (Trace Retention)
Inspect the workspace's Playwright configuration (`playwright.config.ts`, `playwright.config.js`, or `playwright.config.mjs`).

PIE requires traces to perform root-cause diagnosis and AST/LLM locator repairs:
1. Check the `use` block for `trace`.
2. If `trace` is missing or set to `'off'`, update it to `'retain-on-failure'` (or `'on-first-retry'`).
3. Ensure existing settings (`projects`, `baseURL`, `browsers`, `testDir`) remain completely untouched.

**Recommended minimal snippet in `use` block:**
```typescript
use: {
  trace: 'retain-on-failure', // Captures trace.zip when tests fail
}
```

---

### Step 4: Verification Complete
Summarize the setup status for the user:
- PIE version and health status.
- Trace retention status in Playwright config.
- How to run diagnostics on their next failed test: `npx pw-intel diagnose <trace.zip>`.
