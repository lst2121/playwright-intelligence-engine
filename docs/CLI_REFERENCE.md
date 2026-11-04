# CLI Reference Guide (`pw-intel`)

This document provides complete reference documentation for the `pw-intel` command-line utility.

---

## 1. Global Usage & Flags

```bash
npx pw-intel [command] [options]
```

### Global Options
- `-h, --help`: Displays help information and command summaries.
- `-v, --version`: Displays the current engine version (e.g. `0.1.0`).
- `--json`: Formats command output as structured JSON for CI/CD scripting.
- `--verbose`: Enables debug logging, trace adapter details, and AST node dumps.

---

## 2. Command Reference

### 2.1. `pw-intel diagnose`
Ingests a Playwright `trace.zip` archive and outputs root-cause failure classification with causal graph evidence.

```bash
npx pw-intel diagnose <tracePath> [options]
```

#### Options:
- `--format <text|json>`: Output format (default: `text`).

#### Example Output:
```text
========================================================================
 PLAYWRIGHT INTELLIGENCE ENGINE — DIAGNOSTIC REPORT
========================================================================
 Trace File      : ./traces/checkout-failure.zip
 Trace Version   : 9 (Playwright v1.42.0)
 Diagnostic Class: LOCATOR_DRIFT (Confidence: 94.2%)

 FAILED ACTION:
 • Action        : click
 • Target        : button#submit-order
 • Call ID       : call@14
 • Error         : Timeout 30000ms exceeded waiting for locator('button#submit-order')

 CAUSAL EVIDENCE:
 • In-Domain API : 12 requests (100% HTTP 2xx/3xx — Healthy)
 • Excluded Noise: 4 third-party telemetry beacons ignored (Google Analytics, Sentry)
 • DOM Provenance: COMPLETE (Frame: main, Elements resolved: 412)

 REMEDY:
 • Status        : Eligible for Automated AST Repair
 • Recommendation: Run 'pw-intel repair' to evaluate candidate locators.
========================================================================
```

---

### 2.2. `pw-intel repair`
Plans, executes, and verifies an automated Page Object repair inside an isolated Git worktree.

```bash
npx pw-intel repair <tracePath> --target-page <pageObjectPath> [options]
```

#### Options:
- `--target-page <path>`: (Required) Path to the TypeScript Page Object containing the locator.
- `--spec <path>`: Path to the failing test spec file for Intent Invariant v2 validation.
- `--dry-run`: Generates candidate scores and unified diff without creating a worktree or running tests.
- `--apply`: Automatically commits the verified diff to the active working branch after human review.

#### Example Output:
```text
[1/5] Ingesting trace and resolving DOM snapshot... Done.
[2/5] Extracting semantic candidates... 3 candidates discovered.
[3/5] Scoring candidates with Calibrated Sigmoid:
      1. getByRole('button', { name: 'Complete Checkout' }) -> P(valid): 92.4% (Match: 1)
      2. getByTestId('order-submit-btn')                     -> P(valid): 81.1% (Match: 1)
      3. locator('.checkout-btn')                            -> P(valid): 54.0% (Match: 2, Ambiguous)
[4/5] Evaluating Intent Invariant v2:
      • Assertion Invariant (A) : PASSED (Canonical AST Hash: 8f4e2a...)
      • Structural Invariant (T): PASSED (Statements: 8 == 8)
      • Fixture Invariant (F)   : PASSED (Input literals identical)
      • Identity Invariant (I)  : PASSED (Role: button, Tokens: checkout)
      • Diff Allowlist (D)      : PASSED (1 Property updated, 0 collateral changes)
[5/5] Executing test in isolated worktree (.pw-intelligence/worktrees/repair-1730761200000)...
      Running: npx playwright test tests/e2e/checkout.spec.ts
      Result: 1 passed (1.4s) — Exit Code: 0

========================================================================
 VERIFIED REPAIR READY FOR REVIEW:
========================================================================
--- a/src/pages/checkout.page.ts
+++ b/src/pages/checkout.page.ts
@@ -14,1 +14,1 @@
-  readonly submitButton = this.page.locator('button#submit-order');
+  readonly submitButton = this.page.getByRole('button', { name: 'Complete Checkout' });

 To apply this patch to your current branch, run:
   npx pw-intel repair ./traces/checkout-failure.zip --target-page src/pages/checkout.page.ts --apply
========================================================================
```

---

### 2.3. `pw-intel verify`
Runs test execution verification in an isolated sandbox for an existing spec and config.

```bash
npx pw-intel verify <specPath> [--config <configPath>]
```

---

### 2.4. `pw-intel audit`
Scans the repository for orphaned Git worktrees, checks NTFS junction integrity, validates package manager compatibility, and purges stale temp branches.

```bash
npx pw-intel audit [--clean-worktrees]
```

#### Example Output:
```text
[Audit] Scanning Git worktrees...
• Registered worktrees: 0 active, 0 orphaned.
• Package Manager: npm (Strategy: IMMUTABLE_SHARED)
• Windows NTFS Junction Support: Available
• Stability Ledger: 14 recorded locators (.pw-intelligence/stability-ledger.json)
• System Status: All systems healthy.
```

---

## 3. CI/CD Exit Codes

| Exit Code | Meaning | CI Action |
| :--- | :--- | :--- |
| `0` | Success / Verified repair generated / Diagnostic complete | Proceed |
| `1` | Diagnostic abstention (e.g. `BACKEND_500`, `AUTH_EXPIRED`, `ASSERTION_FAILURE`) | Fail CI, notify developer of application bug |
| `2` | Security violation (Zip-Slip, Decompression Bomb detected) | Block build, alert security team |
| `3` | Invalid command line arguments or missing required files | Fix configuration |
