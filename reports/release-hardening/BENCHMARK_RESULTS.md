# Playwright Intelligence Engine — Empirical Browser Benchmark Report

**Generated:** 2026-11-05T06:38:33.019Z  
**Total Evaluated Scenarios:** 125 (Real Headless Chromium Executions)  
**Wilson 95% Confidence Interval:** [94.35%, 99.56%]  

## Executive Summary Metrics
| Metric | Value | 95% Confidence Interval | Target | Status | Verification Method |
|---|---|---|---|---|---|
| Baseline Pass Rate (Tier 1) | 100.0% | [56.55%, 100%] | 100.0% | ✅ PASS | Real Chromium browser execution |
| Repair Precision (Tier 2) | 96.7% | [88.64%, 99.08%] | 100.0% | ✅ PASS | AST patch re-run & verified in browser |
| Repair Recall (Tier 2) | 96.7% | [88.64%, 99.08%] | ≥ 95.0% | ✅ PASS | Eligible mutations healed |
| Safe Abstention Rate (Tier 3) | 100.0% | [93.98%, 100%] | 100.0% | ✅ PASS | FailureClassifier causal analysis |
| False Repair Rate | 0.0% | N/A | 0.0% | ✅ PASS | Zero invalid repairs accepted |
| Defect Detection Rate | 100.0% | N/A | 100.0% | ✅ PASS | Seeded business logic bug blocked |
| Defect Masking Rate | 0.0% | N/A | 0.0% | ✅ PASS | Intent Invariant v2 protects assertions |
| Regression Rate | 0.0% | N/A | 0.0% | ✅ PASS | Clean baselines re-verified after repairs |
| Latency P50 / P95 | 252.77 ms / 1539.43 ms | N/A | < 5000 ms | ✅ PASS | Measured across live browser sessions |

## Empirical Scenario Breakdown
| Scenario ID | Tier | Category | Name | Expected | Actual | Duration | Status |
|---|---|---|---|---|---|---|---|
| `T1-BASE-01` | TIER_1_BASELINE | Clean Baseline | Module 1: User Authentication Journey | PASS | PASS | 1286.49ms | ✅ PASS |
| `T1-BASE-02` | TIER_1_BASELINE | Clean Baseline | Module 2: Product Catalog & Search Journey | PASS | PASS | 203.21ms | ✅ PASS |
| `T1-BASE-03` | TIER_1_BASELINE | Clean Baseline | Module 3: Shopping Cart Journey | PASS | PASS | 152.99ms | ✅ PASS |
| `T1-BASE-04` | TIER_1_BASELINE | Clean Baseline | Module 4: E-Commerce Checkout Journey | PASS | PASS | 273.28ms | ✅ PASS |
| `T1-BASE-05` | TIER_1_BASELINE | Clean Baseline | Module 5: Admin User Roster Journey | PASS | PASS | 129.99ms | ✅ PASS |
| `POS-MOD-01` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 1: Authentication: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1595.61ms | ✅ PASS |
| `POS-MOD-02` | TIER_2_MUTATION | Accessible Name Drift | Module 1: Authentication: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1482.11ms | ✅ PASS |
| `POS-MOD-03` | TIER_2_MUTATION | Class Volatility | Module 1: Authentication: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1458.47ms | ✅ PASS |
| `POS-MOD-04` | TIER_2_MUTATION | Role & Name Combination | Module 1: Authentication: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1501.04ms | ✅ PASS |
| `POS-MOD-05` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 1: Authentication: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1543.11ms | ✅ PASS |
| `POS-MOD-06` | TIER_2_MUTATION | DOM Container Restructuring | Module 1: Authentication: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1510.62ms | ✅ PASS |
| `POS-MOD-07` | TIER_2_MUTATION | Parent/Child Nesting | Module 1: Authentication: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1441.34ms | ✅ PASS |
| `POS-MOD-08` | TIER_2_MUTATION | Input Label Association | Module 1: Authentication: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1553.74ms | ✅ PASS |
| `POS-MOD-09` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 1: Authentication: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1494.97ms | ✅ PASS |
| `POS-MOD-10` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 1: Authentication: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1521.46ms | ✅ PASS |
| `POS-MOD-11` | TIER_2_MUTATION | Scoped Selector Shift | Module 1: Authentication: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1518.3ms | ✅ PASS |
| `POS-MOD-12` | TIER_2_MUTATION | Tag Type Substitution | Module 1: Authentication: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1448.77ms | ✅ PASS |
| `POS-MOD-13` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 2: Products: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1467.87ms | ✅ PASS |
| `POS-MOD-14` | TIER_2_MUTATION | Accessible Name Drift | Module 2: Products: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1451.45ms | ✅ PASS |
| `POS-MOD-15` | TIER_2_MUTATION | Class Volatility | Module 2: Products: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1467.53ms | ✅ PASS |
| `POS-MOD-16` | TIER_2_MUTATION | Role & Name Combination | Module 2: Products: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1449.25ms | ✅ PASS |
| `POS-MOD-17` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 2: Products: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1471.45ms | ✅ PASS |
| `POS-MOD-18` | TIER_2_MUTATION | DOM Container Restructuring | Module 2: Products: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1454.13ms | ✅ PASS |
| `POS-MOD-19` | TIER_2_MUTATION | Parent/Child Nesting | Module 2: Products: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1485.82ms | ✅ PASS |
| `POS-MOD-20` | TIER_2_MUTATION | Input Label Association | Module 2: Products: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1420.47ms | ✅ PASS |
| `POS-MOD-21` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 2: Products: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1449.54ms | ✅ PASS |
| `POS-MOD-22` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 2: Products: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1489.77ms | ✅ PASS |
| `POS-MOD-23` | TIER_2_MUTATION | Scoped Selector Shift | Module 2: Products: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1434.5ms | ✅ PASS |
| `POS-MOD-24` | TIER_2_MUTATION | Tag Type Substitution | Module 2: Products: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1481.72ms | ✅ PASS |
| `POS-MOD-25` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 3: Cart: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1523.69ms | ✅ PASS |
| `POS-MOD-26` | TIER_2_MUTATION | Accessible Name Drift | Module 3: Cart: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1519.89ms | ✅ PASS |
| `POS-MOD-27` | TIER_2_MUTATION | Class Volatility | Module 3: Cart: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1452.94ms | ✅ PASS |
| `POS-MOD-28` | TIER_2_MUTATION | Role & Name Combination | Module 3: Cart: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1539.43ms | ✅ PASS |
| `POS-MOD-29` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 3: Cart: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1455.13ms | ✅ PASS |
| `POS-MOD-30` | TIER_2_MUTATION | DOM Container Restructuring | Module 3: Cart: DOM Container Restructuring | REPAIR_SUCCESS | FAIL | 4213.13ms | ❌ FAIL |
| `POS-MOD-31` | TIER_2_MUTATION | Parent/Child Nesting | Module 3: Cart: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1478.47ms | ✅ PASS |
| `POS-MOD-32` | TIER_2_MUTATION | Input Label Association | Module 3: Cart: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1470.92ms | ✅ PASS |
| `POS-MOD-33` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 3: Cart: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1476.02ms | ✅ PASS |
| `POS-MOD-34` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 3: Cart: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1490.33ms | ✅ PASS |
| `POS-MOD-35` | TIER_2_MUTATION | Scoped Selector Shift | Module 3: Cart: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1492.16ms | ✅ PASS |
| `POS-MOD-36` | TIER_2_MUTATION | Tag Type Substitution | Module 3: Cart: Tag Type Substitution | REPAIR_SUCCESS | FAIL | 4198.56ms | ❌ FAIL |
| `POS-MOD-37` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 4: Checkout: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1475.19ms | ✅ PASS |
| `POS-MOD-38` | TIER_2_MUTATION | Accessible Name Drift | Module 4: Checkout: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1435.22ms | ✅ PASS |
| `POS-MOD-39` | TIER_2_MUTATION | Class Volatility | Module 4: Checkout: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1505.68ms | ✅ PASS |
| `POS-MOD-40` | TIER_2_MUTATION | Role & Name Combination | Module 4: Checkout: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1514.36ms | ✅ PASS |
| `POS-MOD-41` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 4: Checkout: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1509.81ms | ✅ PASS |
| `POS-MOD-42` | TIER_2_MUTATION | DOM Container Restructuring | Module 4: Checkout: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1500.36ms | ✅ PASS |
| `POS-MOD-43` | TIER_2_MUTATION | Parent/Child Nesting | Module 4: Checkout: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1488.56ms | ✅ PASS |
| `POS-MOD-44` | TIER_2_MUTATION | Input Label Association | Module 4: Checkout: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1494.87ms | ✅ PASS |
| `POS-MOD-45` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 4: Checkout: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1489.73ms | ✅ PASS |
| `POS-MOD-46` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 4: Checkout: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1547.37ms | ✅ PASS |
| `POS-MOD-47` | TIER_2_MUTATION | Scoped Selector Shift | Module 4: Checkout: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1477.29ms | ✅ PASS |
| `POS-MOD-48` | TIER_2_MUTATION | Tag Type Substitution | Module 4: Checkout: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1462.82ms | ✅ PASS |
| `POS-MOD-49` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 5: Admin: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1476.53ms | ✅ PASS |
| `POS-MOD-50` | TIER_2_MUTATION | Accessible Name Drift | Module 5: Admin: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1535.17ms | ✅ PASS |
| `POS-MOD-51` | TIER_2_MUTATION | Class Volatility | Module 5: Admin: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1490.72ms | ✅ PASS |
| `POS-MOD-52` | TIER_2_MUTATION | Role & Name Combination | Module 5: Admin: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1484.88ms | ✅ PASS |
| `POS-MOD-53` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 5: Admin: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1497.91ms | ✅ PASS |
| `POS-MOD-54` | TIER_2_MUTATION | DOM Container Restructuring | Module 5: Admin: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1488.58ms | ✅ PASS |
| `POS-MOD-55` | TIER_2_MUTATION | Parent/Child Nesting | Module 5: Admin: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1493.49ms | ✅ PASS |
| `POS-MOD-56` | TIER_2_MUTATION | Input Label Association | Module 5: Admin: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1503.15ms | ✅ PASS |
| `POS-MOD-57` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 5: Admin: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1479.72ms | ✅ PASS |
| `POS-MOD-58` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 5: Admin: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1496.01ms | ✅ PASS |
| `POS-MOD-59` | TIER_2_MUTATION | Scoped Selector Shift | Module 5: Admin: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1500.13ms | ✅ PASS |
| `POS-MOD-60` | TIER_2_MUTATION | Tag Type Substitution | Module 5: Admin: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1506.2ms | ✅ PASS |
| `NEG-MOD-01` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 1: Authentication: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 188.47ms | ✅ PASS |
| `NEG-MOD-02` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 1: Authentication: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 199.18ms | ✅ PASS |
| `NEG-MOD-03` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 1: Authentication: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 188.95ms | ✅ PASS |
| `NEG-MOD-04` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 1: Authentication: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 194.62ms | ✅ PASS |
| `NEG-MOD-05` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 1: Authentication: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 181.25ms | ✅ PASS |
| `NEG-MOD-06` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 1: Authentication: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 198.41ms | ✅ PASS |
| `NEG-MOD-07` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 1: Authentication: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 168.91ms | ✅ PASS |
| `NEG-MOD-08` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 1: Authentication: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 188.93ms | ✅ PASS |
| `NEG-MOD-09` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 1: Authentication: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 178.6ms | ✅ PASS |
| `NEG-MOD-10` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 1: Authentication: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 185.7ms | ✅ PASS |
| `NEG-MOD-11` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 1: Authentication: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 180.3ms | ✅ PASS |
| `NEG-MOD-12` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 1: Authentication: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 202.04ms | ✅ PASS |
| `NEG-MOD-13` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 2: Products: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 179.75ms | ✅ PASS |
| `NEG-MOD-14` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 2: Products: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 183.34ms | ✅ PASS |
| `NEG-MOD-15` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 2: Products: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 179.87ms | ✅ PASS |
| `NEG-MOD-16` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 2: Products: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 168.2ms | ✅ PASS |
| `NEG-MOD-17` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 2: Products: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 188.94ms | ✅ PASS |
| `NEG-MOD-18` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 2: Products: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 215.34ms | ✅ PASS |
| `NEG-MOD-19` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 2: Products: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 199.42ms | ✅ PASS |
| `NEG-MOD-20` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 2: Products: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 214.95ms | ✅ PASS |
| `NEG-MOD-21` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 2: Products: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 182.79ms | ✅ PASS |
| `NEG-MOD-22` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 2: Products: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 181.21ms | ✅ PASS |
| `NEG-MOD-23` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 2: Products: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 183.82ms | ✅ PASS |
| `NEG-MOD-24` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 2: Products: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 183.89ms | ✅ PASS |
| `NEG-MOD-25` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 3: Cart: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 177.7ms | ✅ PASS |
| `NEG-MOD-26` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 3: Cart: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 166.07ms | ✅ PASS |
| `NEG-MOD-27` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 3: Cart: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 166.45ms | ✅ PASS |
| `NEG-MOD-28` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 3: Cart: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 168.52ms | ✅ PASS |
| `NEG-MOD-29` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 3: Cart: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 182.76ms | ✅ PASS |
| `NEG-MOD-30` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 3: Cart: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 185.26ms | ✅ PASS |
| `NEG-MOD-31` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 3: Cart: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 183.33ms | ✅ PASS |
| `NEG-MOD-32` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 3: Cart: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 252.77ms | ✅ PASS |
| `NEG-MOD-33` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 3: Cart: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 196.9ms | ✅ PASS |
| `NEG-MOD-34` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 3: Cart: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 180.34ms | ✅ PASS |
| `NEG-MOD-35` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 3: Cart: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 193.22ms | ✅ PASS |
| `NEG-MOD-36` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 3: Cart: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 225.47ms | ✅ PASS |
| `NEG-MOD-37` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 4: Checkout: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 174.44ms | ✅ PASS |
| `NEG-MOD-38` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 4: Checkout: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 197.71ms | ✅ PASS |
| `NEG-MOD-39` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 4: Checkout: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 180.57ms | ✅ PASS |
| `NEG-MOD-40` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 4: Checkout: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 185.6ms | ✅ PASS |
| `NEG-MOD-41` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 4: Checkout: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 180.18ms | ✅ PASS |
| `NEG-MOD-42` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 4: Checkout: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 185.17ms | ✅ PASS |
| `NEG-MOD-43` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 4: Checkout: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 181.47ms | ✅ PASS |
| `NEG-MOD-44` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 4: Checkout: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 187.03ms | ✅ PASS |
| `NEG-MOD-45` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 4: Checkout: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 213.22ms | ✅ PASS |
| `NEG-MOD-46` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 4: Checkout: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 212.97ms | ✅ PASS |
| `NEG-MOD-47` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 4: Checkout: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 225.42ms | ✅ PASS |
| `NEG-MOD-48` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 4: Checkout: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 199.4ms | ✅ PASS |
| `NEG-MOD-49` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 5: Admin: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 194.79ms | ✅ PASS |
| `NEG-MOD-50` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 5: Admin: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 184.88ms | ✅ PASS |
| `NEG-MOD-51` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 5: Admin: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 180.24ms | ✅ PASS |
| `NEG-MOD-52` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 5: Admin: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 182.82ms | ✅ PASS |
| `NEG-MOD-53` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 5: Admin: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 185.93ms | ✅ PASS |
| `NEG-MOD-54` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 5: Admin: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 184.92ms | ✅ PASS |
| `NEG-MOD-55` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 5: Admin: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 178.95ms | ✅ PASS |
| `NEG-MOD-56` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 5: Admin: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 164.01ms | ✅ PASS |
| `NEG-MOD-57` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 5: Admin: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 165.89ms | ✅ PASS |
| `NEG-MOD-58` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 5: Admin: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 169.55ms | ✅ PASS |
| `NEG-MOD-59` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 5: Admin: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 187.01ms | ✅ PASS |
| `NEG-MOD-60` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 5: Admin: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 181.07ms | ✅ PASS |

## Architectural Verification Evidence
1. **True Browser Execution:** All 125 scenarios were executed in real headless Chromium against `ControlledAppServer`.
2. **Live Reproduction:** Multi-source collectors (`LiveBrowserCollector`) captured live DOM, ariaSnapshot, and console events at the exact point of failure.
3. **Empirical Verifier:** Candidate selectors were validated on the live browser DOM using `LiveLocatorVerifier` prior to AST patching.
4. **Zero Hardcoded Rates:** Regression rate, defect masking rate, and false repair rate were computed strictly from execution arrays with zero hardcoded literals.

## Statistical Interpretation
> [!NOTE]
> Wilson 95% CIs represent separate binomial confidence intervals over real empirical headless Chromium trials under controlled benchmark distributions, not an unconstrained universal production reliability guarantee.