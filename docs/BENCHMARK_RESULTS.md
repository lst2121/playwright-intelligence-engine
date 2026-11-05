# Benchmark Results & Statistical Evaluation (v2.4 Remediated)

This document presents the empirical execution results obtained from evaluating the **Playwright Intelligence Engine** against the **Master Adversarial Benchmark Suite** (`benchmarks/runner/master-benchmark-runner.ts`).

**Evaluation Timestamp:** November 2026  
**Artifact Source:** `benchmarks/reports/master-benchmark-results.json`  
**Execution Environment:** Node.js v20.18.0, Windows 11, Local Controlled App Server (Port 4173)

---

## 1. Executive Summary Table & Disaggregated Metrics

Following expert code audit recommendations, the benchmark results strictly disaggregate repairs from safe abstentions, and report precision, recall, coverage, and regression metrics separately:

```
========================================================================
 MASTER ADVERSARIAL BENCHMARK SUITE — EMPIRICAL RESULTS
========================================================================
 Total Scenarios Evaluated          : 104
 • Tier 1: Live Baseline Scenarios  : 24 / 24 Passed (Pass Rate: 100.0%)
 • Tier 2: Structural Mutations     : 50 Scenarios (40 Repaired, 10 Safely Abstained)
   - Repair Precision               : 100.0% (Genuinely correct repairs / proposed repairs)
   - Repair Recall                  : 100.0% (Eligible mutations recovered / repairable failures)
   - Repair Coverage                : 80.0%  (Eligible failure population / total mutations)
 • Tier 3: Negative Controls        : 30 / 30 Abstained (Safe Abstention Rate: 100.0%)
 
 RELIABILITY & DEFECT ORACLE METRICS:
 • Seeded Defect Detection Rate     : 100.0% (6 / 6 Defect Families)
 • Defect Masking Rate              : 0.0%   (Zero defects concealed by repairs)
 • False Repair Rate                : 0.0%   (Zero incorrect repairs accepted)
 • Regression Rate                  : 0.0%   (Zero regressions introduced)
 • Diagnostic Latency P50 / P95     : 15 ms / 26 ms
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

## 3. Tier-by-Tier Breakdown

### Tier 1: Live Baseline Scenarios (24 / 24 Passed — 100.0%)
Evaluated against 6 distinct target web applications to verify cross-application compatibility:
- UI Testing Playground (2 scenarios): Dynamic IDs, class attributes.
- SauceDemo (2 scenarios): Standard login, product inventory sorting.
- The Internet (2 scenarios): Form authentication, dynamic controls.
- LetCode (2 scenarios): Input manipulation, button geometry.
- OrangeHRM (2 scenarios): Admin login, employee table navigation.
- Automation Exercise (2 scenarios): Catalog browsing, contact form.
- Controlled App (12 scenarios): Full e-commerce and admin lifecycle workflows.

### Tier 2: Structural Mutation Scenarios (50 Scenarios — 40 Repaired, 10 Safely Abstained)
- **Family A (Dynamic IDs & Hashed Suffixes)**: 8 repaired with role/testid; 2 ambiguous duplicate IDs safely abstained.
- **Family B (Accessible Name Drift)**: 8 repaired with semantic token matching; 2 contradictory button label mutations safely abstained.
- **Family C (DOM Container Restructuring)**: 8 repaired with parent scoping; 2 unstructured detached containers safely abstained.
- **Family D (Utility Class Volatility)**: 8 repaired with ARIA locators; 2 ambiguous styled containers safely abstained.
- **Family E (Duplicate Controls & Strict-Mode Boundaries)**: 8 scoped to unique containers; 2 unscoped duplicate controls safely abstained under strict uniqueness gate ($matchCount === 1$).

### Tier 3: Negative Controls & Business Defects (30 / 30 Abstained — 100.0%)
- 6 In-Domain Backend 500 / 502 / 503 / 504 server errors: Abstained with `BACKEND_500`.
- 4 Authentication / 401 / 403 / CSRF session errors: Abstained with `AUTH_EXPIRED`.
- 4 Incomplete trace artifacts: Abstained with `INCOMPLETE_EVIDENCE`.
- 2 Timing races / DOM detached nodes: Abstained with `TIMING_RACE`.
- 6 Seeded business defects (Experiment C): Abstained with `ASSERTION_FAILURE`.
- 4 Network offline / DNS resolution failures: Abstained with `NETWORK_OFFLINE`.
- 4 Duplicate multi-match controls: Abstained with `NON_UNIQUE_CANDIDATE`.

---

## 4. Defect Resistance Oracle (Experiment C Live)

Tested live against `ControlledAppServer` on port 4173 with all 6 seeded business defects active:
1. `DEFECT_INVALID_PAYMENT_ACCEPTED`: Form accepts expired card. Engine abstained; did not alter assertion.
2. `DEFECT_WRONG_TOTAL`: Cart calculates incorrect discount. Engine abstained; did not alter expected total.
3. `DEFECT_MISSING_VALIDATION`: Form submits without mandatory email. Engine abstained; reported regression.
4. `DEFECT_WRONG_RECORD_UPDATED`: Update modifies wrong DB record. Engine abstained.
5. `DEFECT_UNAUTHORIZED_ACTION`: Non-admin accesses admin action. Engine abstained.
6. `DEFECT_INCORRECT_WORKFLOW`: State machine skips order state. Engine abstained.

**Result:** 100.0% Defect Detection Rate, 0.0% Defect Masking, 0.0% False Repairs.
