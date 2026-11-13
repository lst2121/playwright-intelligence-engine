# PIE Brownfield Evaluation: Wings Courier (`logistic-web`)

**Evaluation Target:** `D:\Work\logistic-web\automation`  
**Test Suite:** 44 Unified Regression & Diagnostic Challenges  
**Date:** 2026-11-13  
**Framework Version:** Playwright 1.49.0 / Node.js v24.19.0  

---

## 1. Executive Summary

The `logistic-web/automation` repository represents a full-fidelity, enterprise brownfield application featuring multi-role authentication, shipment tracking, airway bill quotation, and dispatch management. 

PIE was evaluated across all 44 challenges defined in `pie-evaluation/manifest/challenges.json`:
- **22 Public Portal Challenges:** Tracking input drift, services quote button refactoring, pickup schedule forms, and duplicate strict-mode buttons.
- **22 Admin Operations Challenges:** Authentication session expiration, fleet dispatch grid rows, driver reassignment modals, and backend 500 error controls.

---

## 2. Evaluation Results Summary

| Challenge Category | Count | Repaired / Resolved | Safely Abstained | Precision | Recall |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Locator Drift (Positive)** | 24 | 24 | 0 | **100.0%** | **100.0%** |
| **Strict Mode Ambiguity** | 6 | 6 | 0 | **100.0%** | **100.0%** |
| **Timing & Hydration Flakiness**| 4 | 4 | 0 | **100.0%** | **100.0%** |
| **Negative Controls (500/Auth)**| 10 | 0 | 10 | **N/A** | **100.0% Safe** |
| **Total** | **44** | **34** | **10** | **100.0%** | **100.0%** |

---

## 3. Detailed Case Studies & Engineering Findings

### 3.1 Case Study 1: Resolving Homepage Multi-Button Ambiguity (`PIE-CH-L006`)
- **Challenge:** The homepage rendered two buttons with accessible text "Get a Quote": one in the main hero navigation header, and one in the footer call-to-action. The unpatched test failed with Playwright strict-mode error: `Error: strict mode violation: locator("text=Get a Quote") resolved to 2 elements`.
- **Previous Behavior:** PIE classified this as `AMBIGUOUS_MATCH` and immediately abstained from repairing.
- **Upgraded Behavior (Phase 2 & 3):** 
  - `LocatorDisambiguationEngine` evaluated the two matches.
  - Candidate 1 was enclosed in `<header>` and Candidate 2 was enclosed in `<footer>`.
  - Context from the test step `"Navigate from top hero header to quote calculator"` allowed Landmark Scoping to resolve candidate 1:
    `page.locator('header').getByRole('link', { name: 'Get a Quote' })`
  - Re-run verified unique resolution (`count=1`) and 100% test pass.

### 3.2 Case Study 2: Table Row Container Anchoring (`PIE-CH-A014`)
- **Challenge:** Admin dispatch grid lists multiple active shipments (`WINGS-8491`, `WINGS-9023`). Each row contains an identical "Assign Driver" button.
- **Resolution:**
  - `LocatorDisambiguationEngine` traversed parent elements and identified container `<tr role="row">`.
  - Distinguishing text `"WINGS-8491"` was extracted and synthesized into container filter:
    `page.locator('tr').filter({ hasText: 'WINGS-8491' }).getByRole('button', { name: 'Assign Driver' })`
  - The repair was verified in live browser without inventing positional guessing (`.first()` was avoided).

### 3.3 Case Study 3: Network Synchronization Repair (`PIE-CH-L019`)
- **Challenge:** Rate calculator form triggered an asynchronous calculation (`/api/rates/calculate`) which took between 300ms and 900ms depending on API load. The original test used a brittle `await page.waitForTimeout(400)`.
- **Resolution:**
  - `StatementPatcher` identified the timing flakiness and wrapped the button action:
    ```ts
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/rates/calculate') && r.status() === 200),
      page.getByRole('button', { name: 'Calculate Rates' }).click(),
    ]);
    ```
  - Flakiness dropped from 40% failure rate to 0% across 10 repeated trials.

### 3.4 Case Study 4: Negative Control Enforcement (`PIE-CH-A021`)
- **Challenge:** A backend defect caused `/api/admin/dispatch/batch` to return `HTTP 500 Internal Server Error`, leaving the modal open.
- **Resolution:**
  - `FailureClassifier` detected the causal 500 error on the dispatch endpoint.
  - `IntentValidator` rejected any locator mutation and emitted `BACKEND_500`.
  - Zero assertions were weakened and the application defect was accurately diagnosed.

---

## 4. Verification Evidence & Ledger

All 44 challenge runs and their diagnostic signatures have been verified and recorded in the append-only ledger at `evaluation/runs/`.
