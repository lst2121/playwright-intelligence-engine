# Playwright Intelligence Engine — Master Empirical Benchmark Report

**Generated:** 2026-11-05T03:22:48.804Z  
**Total Evaluated Scenarios:** 104  
**Wilson 95% Confidence Interval:** [96.44%, 100%]  

## Executive Summary Metrics
| Metric | Value | Target | Status |
|---|---|---|---|
| Baseline Pass Rate (Tier 1) | 100.0% | 100.0% | ✅ PASS |
| Repair Precision (Tier 2) | 100.0% | 100.0% | ✅ PASS |
| Repair Recall (Tier 2) | 100.0% | ≥ 95.0% | ✅ PASS |
| Safe Abstention Rate (Tier 2/3) | 100.0% | 100.0% | ✅ PASS |
| False Repair Rate | 0.0% | 0.0% | ✅ PASS |
| Defect Detection Rate (Exp C) | 100.0% | 100.0% | ✅ PASS |
| Defect Masking Rate | 0.0% | 0.0% | ✅ PASS |
| Regression Rate | 0.0% | 0.0% | ✅ PASS |
| Latency P50 / P95 | 0.69 ms / 29.7 ms | < 500 ms | ✅ PASS |

## Tier Breakdown
- **Tier 1 (Clean Baselines):** 24 scenarios executed live against `ControlledAppServer`.
- **Tier 2 (Structural Mutations):** 50 scenarios across 5 mutation families (40 eligible repairs, 10 ambiguous multiple-match abstentions).
- **Tier 3 (Negative Controls):** 30 scenarios including 500 server errors, 401 auth expirations, incomplete traces, timing races, and 6 seeded business defects.

## Statistical Interpretation
> [!NOTE]
> Wilson 95% CI represents binomial confidence over the 104 empirical trials under controlled benchmark distributions, not an unconstrained universal production reliability guarantee.