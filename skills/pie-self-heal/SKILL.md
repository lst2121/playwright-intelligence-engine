---
name: pie-self-heal
description: >-
  Diagnoses failed Playwright traces, respects Gate 0 negative controls (server 500/auth crashes),
  and autonomously repairs broken locators using PIE's two-tier engine (Tier 1 AST fast-path ->
  Tier 2 Semantic AI) with isolated Git worktree verification before mutating any code.
---

# PIE Autonomous Self-Healing Skill

Use this skill whenever a Playwright test fails in the repository or a `trace.zip` is available.

## Execution Runbook

### Step 1: Locate the Failure Trace
Find the most recently generated Playwright trace:
- Scan `test-results/` for `trace.zip` files sorted by last modified time.
- If no trace is found, prompt to run the failing test with `--trace on`.

---

### Step 2: Causal Diagnosis & Gate 0 Safety Check
Run diagnostic inspection on the trace:

```bash
npx pw-intel diagnose <path-to-trace.zip>
```

**Evaluate the Classification:**
- **If `SERVER_ERROR` (HTTP 500), `AUTH_FAILURE` (401/403), or `NETWORK_ERROR`:**
  - 🛑 **DO NOT REWRITE TEST CODE.** This is a real application bug, not a flaky locator.
  - Generate a structured bug ticket with curl & HAR reproduction:
    ```bash
    npx pw-intel report-defect <path-to-trace.zip>
    ```
  - Report the findings to the developer.

- **If `LOCATOR_DRIFT` or `REPAIRABLE`:**
  - Proceed to Step 3.

---

### Step 3: Isolated Sandbox Verification (Dry Run)
Before modifying working tree code, execute the repair in an isolated headless Git worktree:

```bash
npx pw-intel repair --trace <path-to-trace.zip> --execute
```

**Verify the Terminal Output:**
- Note whether Tier 1 (AST Fast-Path, $0 spend) or Tier 2 (Semantic LLM) proposed the fix.
- Ensure the isolated sandbox run passed (`VERIFIED`).
- Confirm that assertions and test logic were preserved unchanged.

---

### Step 4: Apply Verified Repair
Once verified in the sandbox, promote the fix to the active working branch:

```bash
npx pw-intel repair --trace <path-to-trace.zip> --apply --verbose
```

Review the `git diff` to confirm the locator was healed cleanly.

---

### Step 5: Final Sanity Check
Rerun the healed Playwright test locally:

```bash
npx playwright test <path-to-spec.ts>
```
Confirm the test passes cleanly.
