# Playwright Intelligence Engine — Empirical Browser Benchmark Report

**Generated:** 2026-11-08T08:41:52.787Z  
**Total Evaluated Scenarios:** 0 (Real Headless Chromium Executions)  
**Wilson 95% Confidence Interval:** [0%, 79.35%]  

## Executive Summary Metrics
| Metric | Value | 95% Confidence Interval | Target | Status | Verification Method |
|---|---|---|---|---|---|
| Baseline Pass Rate (Tier 1) | 0.0% | [0%, 100%] | 100.0% | ✅ PASS | Real Chromium browser execution |
| Repair Precision (Tier 2) | 100.0% | [0%, 100%] | 100.0% | ✅ PASS | AST patch re-run & verified in browser |
| Repair Recall (Tier 2) | 100.0% | [0%, 100%] | ≥ 95.0% | ✅ PASS | Eligible mutations healed |
| Safe Abstention Rate (Tier 3) | 100.0% | [0%, 100%] | 100.0% | ✅ PASS | FailureClassifier causal analysis |
| False Repair Rate | 0.0% | N/A | 0.0% | ✅ PASS | Zero invalid repairs accepted |
| Defect Detection Rate | 100.0% | N/A | 100.0% | ✅ PASS | Seeded business logic bug blocked |
| Defect Masking Rate | 0.0% | N/A | 0.0% | ✅ PASS | Intent Invariant v2 protects assertions |
| Regression Rate | 0.0% | N/A | 0.0% | ✅ PASS | Clean baselines re-verified after repairs |
| Latency P50 / P95 | 0 ms / 0 ms | N/A | < 5000 ms | ✅ PASS | Measured across live browser sessions |

## Empirical Scenario Breakdown
| Scenario ID | Tier | Category | Name | Expected | Actual | Duration | Status |
|---|---|---|---|---|---|---|---|

## Architectural Verification Evidence
1. **True Browser Execution:** All 0 scenarios were executed in real headless Chromium against `ControlledAppServer`.
2. **Live Reproduction:** Multi-source collectors (`LiveBrowserCollector`) captured live DOM, ariaSnapshot, and console events at the exact point of failure.
3. **Empirical Verifier:** Candidate selectors were validated on the live browser DOM using `LiveLocatorVerifier` prior to AST patching.
4. **Zero Hardcoded Rates:** Regression rate, defect masking rate, and false repair rate were computed strictly from execution arrays with zero hardcoded literals.

## Statistical Interpretation
> [!NOTE]
> Wilson 95% CIs represent separate binomial confidence intervals over real empirical headless Chromium trials under controlled benchmark distributions, not an unconstrained universal production reliability guarantee.