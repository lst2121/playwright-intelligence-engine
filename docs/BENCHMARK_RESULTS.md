# Benchmark Results & Empirical Evaluation (v2.6)

This document presents the empirical execution results obtained from evaluating the **Playwright Intelligence Engine v2.6** against the **Empirical Browser Benchmark Suite** (`benchmarks/runner/master-benchmark-runner.ts`).

**Evaluation Timestamp:** November 2026  
**Artifact Sources:** `benchmarks/reports/master-benchmark-results.json` and `artifacts/benchmark-report.json` / `artifacts/benchmark-report.md`  
**Execution Environment:** Node.js v24.19.0, Windows, Headless Chromium, Local In-Memory `ControlledAppServer` (Port 4173)  
**Scenarios Evaluated:** 9 real end-to-end browser executions in headless Chromium  

---

## 1. Executive Summary Table & Disaggregated Metrics

Every scenario is executed in a real headless browser against the live in-memory server, capturing live failure evidence (`LiveBrowserCollector`), scoring candidates, verifying candidate locators live on the page (`LiveLocatorVerifier`), validating Intent Invariants ($V = A \land T \land F \land I \land D \land E$), re-executing repaired actions in Chromium, and running regression checks on baseline clean tests:

```
========================================================================
 MASTER EMPIRICAL BROWSER BENCHMARK SUITE — REAL PLAYWRIGHT EXECUTION
 Evaluating Playwright Intelligence Engine Enterprise Reliability
========================================================================
 TOTAL EMPIRICAL BENCHMARK SCENARIOS EVALUATED: 9
 • Tier 1 Baseline Scenarios       : 2 / 2 Passed (Pass Rate: 100.0%)
 • Tier 2 Structural Mutations     : 4 / 4 Repaired in Browser (100.0%)
   - Repair Precision              : 100.0% (Genuinely correct repairs / proposed repairs)
   - Repair Recall                 : 100.0% (Eligible mutations recovered / repairable failures)
   - Repair Coverage               : 100.0% (Mutation population handled)
 • Tier 3 Negative Controls        : 3 / 3 Abstained (Safe Abstention Rate: 100.0%)
 
 RELIABILITY & DEFECT RESISTANCE METRICS:
 • Seeded Defect Detection Rate    : 100.0% (Business defect detected & blocked)
 • Defect Masking Rate             : 0.0%   (Zero defects concealed by repairs)
 • False Repair Rate               : 0.0%   (Zero incorrect repairs accepted)
 • Regression Rate                 : 0.0%   (Zero regressions across 4 baseline re-runs)
 • Latency P50 / P95               : 1268.08 ms / 2069.84 ms
 • Wilson 95% Confidence Interval  : [70.08%, 100.00%]*
========================================================================
 * Note on Statistical Interpretation: The Wilson 95% confidence interval describes
   the binomial sampling confidence over real empirical trials under controlled
   distributions. It does not represent an unconstrained universal production guarantee.
```

---

## 2. Core Metrics Definitions & Results

| Metric | Definition | Benchmark Result | Interpretation |
| :--- | :--- | :--- | :--- |
| **Baseline Pass Rate** | $\frac{\text{Passing Clean Baselines}}{\text{Total Baselines}}$ | **100.0%** (2 / 2) | Clean user journeys (login, checkout) execute and pass in headless Chromium. |
| **Repair Precision** | $\frac{\text{Correct Repairs}}{\text{Total Proposed Repairs}}$ | **100.0%** (4 / 4) | Every repair proposed was verified in browser; zero false repairs. |
| **Repair Recall** | $\frac{\text{Successful Repairs}}{\text{Eligible Repairable Failures}}$ | **100.0%** (4 / 4) | All 4 DOM drift mutations successfully healed in browser. |
| **Repair Coverage** | $\frac{\text{Repairable Mutations}}{\text{Total Mutations}}$ | **100.0%** (4 / 4) | 100% of tested mutation families healed. |
| **Safe Abstention Rate**| $\frac{\text{Correctly Abstained Non-Repairable Cases}}{\text{Total Non-Repairable Cases}}$ | **100.0%** (3 / 3) | 500 crash, business defect, and duplicate controls safely rejected. |
| **False Repair Rate** | $\frac{\text{Incorrect Repairs Accepted}}{\text{Total Negative Controls}}$ | **0.0%** (0 / 3) | Zero repairs accepted for backend errors or business defects. |
| **Defect Masking Rate** | $\frac{\text{Defects Weakened by Repair}}{\text{Total Seeded Defects}}$ | **0.0%** (0 / 1) | Zero business logic defects masked by assertion or locator alteration. |
| **Regression Rate** | $\frac{\text{Passing Tests Broken by Repair}}{\text{Total Regression Re-runs}}$ | **0.0%** (0 / 4) | Clean baselines re-verified after every repair with zero regressions. |

---

## 3. Tier-by-Tier Empirical Breakdown

### Tier 1: Real Headless Chromium Baselines (2 / 2 Passed — 100.0%)
1. `T1-BASE-01`: Baseline User Authentication Journey — Headless Chromium fills credentials, submits login form, verifies "Login Successful" status message (1268ms).
2. `T1-BASE-02`: Baseline E-Commerce Checkout Journey — Verifies $99.00 subtotal, fills payment form, verifies order dispatch and receipt (234ms).

### Tier 2: Real DOM Drift Browser Repairs (4 / 4 Repaired — 100.0%)
1. `T2-MUT-01`: Dynamic Button ID Hash Shift on Login — Button ID changes to `#btn-login-hash-8f4b2`. Engine captures failure snapshot, extracts candidate `getByRole('button', { name: 'Sign In' })`, verifies `count === 1` live in Chromium, patches Page Object, confirms test turns green, verifies clean baseline has zero regressions (2070ms).
2. `T2-MUT-02`: Accessible Name Drift on Login Submit — Button label drifts to `"Log In To Account"`. Engine captures failure DOM, extracts `getByRole('button', { name: 'Log In To Account' })`, verifies live in Chromium, patches Page Object, verifies green pass and zero regressions (2020ms).
3. `T2-MUT-03`: Container Slot Restructure & Test-ID Removal — Button wrapped in `.checkout-actions-v2` and `data-testid` removed. Engine heals via `getByRole('button', { name: 'Place Order' })`, verifies live, re-runs successfully in Chromium with zero regressions (2003ms).
4. `T2-MUT-04`: CSS Class Volatility on Checkout Button — Class changes from `.btn-checkout-primary` to `.btn-checkout-v2-active`. Engine heals via `getByRole('button', { name: 'Place Order' })`, verifies live, re-runs in Chromium with zero regressions (2005ms).

### Tier 3: Real Negative Controls & Defect Resistance (3 / 3 Abstained — 100.0%)
1. `T3-NEG-01`: In-Domain Payment Gateway HTTP 500 Crash — Live network collector captures HTTP 500 on `/api/checkout` in action-anchored window. Engine classifies as `BACKEND_500` and strictly abstains with 0 repairs (705ms).
2. `T3-NEG-02`: Seeded Business Defect: Incorrect Order Total ($199 vs $99) — Assertion `expect(total).toHaveText('$99.00')` fails because app calculated $199.00. Classified as `ASSERTION_FAILURE`. Intent Invariant v2 strictly protects assertions from alteration, preventing defect masking (147ms).
3. `T3-NEG-03`: Strict Mode Boundary: Duplicate Identical Buttons — Server renders 2 identical Place Order buttons without distinctive attributes. `LiveLocatorVerifier` verifies `count === 2`. `AbstentionPolicy` triggers `NON_UNIQUE_CANDIDATE` abstention with 0 repairs (130ms).
