# Benchmark Results & Empirical Evaluation (v2.5)

This document presents the empirical execution results obtained from evaluating the **Playwright Intelligence Engine** against the **Master Empirical Benchmark Suite** (`benchmarks/runner/master-benchmark-runner.ts`).

**Evaluation Timestamp:** November 2026  
**Artifact Source:** `benchmarks/reports/master-benchmark-results.json` and `artifacts/benchmark-report.json`  
**Execution Environment:** Node.js v20.18.0, Windows 11, Local In-Memory `ControlledAppServer` (Port 4173)  
**Scenarios Evaluated:** 104 total empirical trials  

---

## 1. Executive Summary Table & Disaggregated Metrics

Every scenario is executed against the live in-memory server, scored by `SelectorScorer`, evaluated through `AbstentionPolicy`, verified through `DiffAllowlistValidator` and `IntentValidator`, or classified through `FailureClassifier`:

```
========================================================================
 MASTER EMPIRICAL BENCHMARK SUITE — EMPIRICAL RESULTS
========================================================================
 Total Scenarios Evaluated          : 104
 • Tier 1: Live Baseline Scenarios  : 24 / 24 Passed (Pass Rate: 100.0%)
 • Tier 2: Structural Mutations     : 50 Scenarios (40 Repaired, 10 Safely Abstained)
   - Repair Precision               : 100.0% (Genuinely correct repairs / proposed repairs)
   - Repair Recall                  : 100.0% (Eligible mutations recovered / repairable failures)
   - Repair Coverage                : 80.0%  (Eligible failure population / total mutations)
 • Tier 3: Negative Controls        : 30 / 30 Abstained (Safe Abstention Rate: 100.0%)
 
 RELIABILITY & DEFECT RESISTANCE METRICS:
 • Seeded Defect Detection Rate     : 100.0% (6 / 6 Defect Families)
 • Defect Masking Rate              : 0.0%   (Zero defects concealed by repairs)
 • False Repair Rate                : 0.0%   (Zero incorrect repairs accepted)
 • Regression Rate                  : 0.0%   (Zero regressions introduced)
 • Diagnostic Latency P50 / P95     : 0.62 ms / 33.43 ms
 • Wilson 95% Confidence Interval   : [96.44%, 100.00%]*
========================================================================
 * Note on Statistical Interpretation: The Wilson 95% confidence interval describes
   the binomial sampling confidence over the 104 evaluated benchmark scenario trials
   under controlled distributions. It does not represent an unconstrained universal
   production reliability guarantee across arbitrary unseen enterprise applications.
```

---

## 2. Core Metrics Definitions & Results

| Metric | Definition | Benchmark Result | Interpretation |
| :--- | :--- | :--- | :--- |
| **Repair Precision** | $\frac{\text{Correct Repairs}}{\text{Total Proposed Repairs}}$ | **100.0%** (40 / 40) | Every repair proposed by the engine was verified and correct; zero false repairs. |
| **Repair Recall** | $\frac{\text{Successful Repairs}}{\text{Eligible Repairable Failures}}$ | **100.0%** (40 / 40) | All unambiguous structural locator drift failures were successfully recovered. |
| **Repair Coverage** | $\frac{\text{Repairable Mutations}}{\text{Total Mutations}}$ | **80.0%** (40 / 50) | 40 scenarios had unique locator targets; 10 ambiguous duplicate scenarios were safely rejected. |
| **Safe Abstention Rate**| $\frac{\text{Correctly Abstained Non-Repairable Cases}}{\text{Total Non-Repairable Cases}}$ | **100.0%** (40 / 40) | 10 ambiguous Tier 2 cases + 30 Tier 3 negative controls were all correctly rejected without modification. |
| **False Repair Rate** | $\frac{\text{Incorrect Repairs Accepted}}{\text{Total Negative Controls}}$ | **0.0%** (0 / 30) | Zero repairs accepted for backend errors, auth expiration, or business defects. |
| **Defect Masking Rate** | $\frac{\text{Defects Weakened by Repair}}{\text{Total Seeded Defects}}$ | **0.0%** (0 / 6) | Zero business logic defects masked by assertion or locator alteration. |
| **Regression Rate** | $\frac{\text{Passing Tests Broken by Repair}}{\text{Total Passing Baseline Tests}}$ | **0.0%** (0 / 24) | Repaired Page Objects introduced zero regressions into existing passing test suites. |

---

## 3. Tier-by-Tier Empirical Breakdown

### Tier 1: Live Clean Baselines (24 / 24 Passed — 100.0%)
Executed live against `ControlledAppServer` endpoints on port 4173 covering:
1. Root dashboard view (`GET /`)
2. Login form view (`GET /login`)
3. Admin user authentication (`POST /api/login`)
4. Customer user authentication (`POST /api/login`)
5. Product catalog ingestion (`GET /api/products`)
6. Product filtering by category (`GET /api/products?category=Software`)
7. Shopping cart retrieval (`GET /api/cart`)
8. Cart item addition (`POST /api/cart/add`)
9. Cart quantity update (`POST /api/cart/update`)
10. Checkout page render (`GET /checkout`)
11. Order subtotal summary (`GET /api/checkout/summary`)
12. Credit card payment processing (`POST /api/checkout/pay`)
13. Order history ingestion (`GET /api/orders`)
14. Order status lifecycle check (`GET /api/orders/ORD-101`)
15. User profile metadata (`GET /api/profile`)
16. Admin user management table (`GET /api/admin/users`)
17. System health probe (`GET /health`)
18. Session token validation (`GET /api/session/verify`)
19. Inventory availability check (`GET /api/inventory/prod-1`)
20. Shipping rate calculation (`POST /api/shipping/calculate`)
21. Promo code validation (`POST /api/promo/apply`)
22. Order cancellation workflow (`POST /api/orders/ORD-101/cancel`)
23. Customer support inquiry (`POST /api/support/ticket`)
24. Deterministic session logout (`POST /api/logout`)

### Tier 2: Empirical Structural Mutations (50 Scenarios: 40 Repaired, 10 Safely Abstained)
Evaluated across 5 mutation families (10 scenarios per family):
- **Family A (Dynamic IDs & Hashed Suffixes):** 8 unique dynamic ID drift scenarios repaired; 2 duplicate ID scenarios safely abstained under uniqueness gate.
- **Family B (Accessible Name Drift):** 8 unique accessible name drift scenarios repaired; 2 conflicting target action scenarios (`Continue Shopping` vs `Continue Checkout`) safely abstained.
- **Family C (DOM Container Restructuring):** 8 nested container restructuring scenarios repaired via resilient `data-testid` and role locators; 2 duplicate card scenarios safely abstained.
- **Family D (Utility Class Volatility):** 8 volatile CSS utility class mutations repaired; 2 identical styled button scenarios safely abstained.
- **Family E (Duplicate Controls & Strict-Mode Boundaries):** 8 modal dialog scoped actions repaired; 2 ambiguous page-vs-modal duplicate controls safely abstained.

### Tier 3: Negative Controls & Business-Defect Resistance (30 / 30 Abstained — 100.0%)
- **Backend 500 Server Errors (Scenarios 1–6):** HTTP 500, 502, 503, 504 on application endpoints. Classified as `BACKEND_500` with 100% safe abstention.
- **Authentication Expired (Scenarios 7–10):** HTTP 401 and 403 on protected routes. Classified as `AUTH_EXPIRED` with 100% safe abstention.
- **Incomplete Evidence (Scenarios 11–14):** Missing or empty DOM snapshots. Classified as `INCOMPLETE_EVIDENCE` with 100% safe abstention.
- **Timing Races (Scenarios 15–16):** Detached DOM nodes and destroyed execution contexts. Classified as `TIMING_RACE` with 100% safe abstention.
- **Seeded Business Defects (Scenarios 17–22 - Experiment C):** 6 business logic defects (wrong total, invalid payment accepted, missing validation, wrong record updated, unauthorized action, incorrect workflow). Assertion failures trigger `ASSERTION_FAILURE` classification with 100% safe abstention and 0.0% bug masking.
- **Network Offline & Strict Boundaries (Scenarios 23–30):** Network offline (`ERR_INTERNET_DISCONNECTED`), DNS lookup failures (`ENOTFOUND`), and strict mode violations. 100% safe abstention.
