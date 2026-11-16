---
name: pie-stabilize
description: >-
  Eliminates flaky Playwright tests by detecting and refactoring arbitrary sleeps (waitForTimeout)
  into deterministic event-driven awaits (waitForResponse, waitForSelector, toBeVisible) with
  multi-trial stability validation.
---

# PIE Flaky Test Stabilizer Skill

Use this skill when tests suffer from intermittent timing flakiness or contain arbitrary sleeps.

## Execution Runbook

### Step 1: Scan & Detect Flaky Sleep Patterns
Scan the suspect Playwright specification file:

```bash
npx pw-intel stabilize <path-to-spec.ts>
```

**What PIE Analyzes:**
- Identifies `page.waitForTimeout(N)` and arbitrary millisecond delays.
- Inspects surrounding network and DOM actions to infer causal triggers.
- Formulates deterministic replacements (`waitForResponse`, `waitForSelector`, `toBeVisible`).

---

### Step 2: Multi-Trial Stability Verification
Verify that the proposed event-driven awaits eliminate flakiness across consecutive executions:

```bash
npx pw-intel stabilize <path-to-spec.ts> --trials=3
```

PIE executes multiple consecutive test iterations to measure variance and guarantee stability.

---

### Step 3: Apply Refactored Code
Once stability is verified across all trials, apply the refactored code to the test file:

```bash
npx pw-intel stabilize <path-to-spec.ts> --apply
```

Review `git diff` to verify clean, idiomatic Playwright awaits with zero arbitrary timeouts.
