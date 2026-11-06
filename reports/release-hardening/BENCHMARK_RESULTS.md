# Playwright Intelligence Engine — Empirical Browser Benchmark Report

**Generated:** 2026-11-05T15:28:26.575Z  
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
| Latency P50 / P95 | 177.61 ms / 1441.02 ms | N/A | < 5000 ms | ✅ PASS | Measured across live browser sessions |

## Empirical Scenario Breakdown
| Scenario ID | Tier | Category | Name | Expected | Actual | Duration | Status |
|---|---|---|---|---|---|---|---|
| `T1-BASE-01` | TIER_1_BASELINE | Clean Baseline | Module 1: User Authentication Journey | PASS | PASS | 1270.18ms | ✅ PASS |
| `T1-BASE-02` | TIER_1_BASELINE | Clean Baseline | Module 2: Product Catalog & Search Journey | PASS | PASS | 164.04ms | ✅ PASS |
| `T1-BASE-03` | TIER_1_BASELINE | Clean Baseline | Module 3: Shopping Cart Journey | PASS | PASS | 113.15ms | ✅ PASS |
| `T1-BASE-04` | TIER_1_BASELINE | Clean Baseline | Module 4: E-Commerce Checkout Journey | PASS | PASS | 217.15ms | ✅ PASS |
| `T1-BASE-05` | TIER_1_BASELINE | Clean Baseline | Module 5: Admin User Roster Journey | PASS | PASS | 112.56ms | ✅ PASS |
| `POS-MOD-01` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 1: Authentication: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1521ms | ✅ PASS |
| `POS-MOD-02` | TIER_2_MUTATION | Accessible Name Drift | Module 1: Authentication: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1461.72ms | ✅ PASS |
| `POS-MOD-03` | TIER_2_MUTATION | Class Volatility | Module 1: Authentication: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1418.47ms | ✅ PASS |
| `POS-MOD-04` | TIER_2_MUTATION | Role & Name Combination | Module 1: Authentication: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1418.33ms | ✅ PASS |
| `POS-MOD-05` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 1: Authentication: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1436.34ms | ✅ PASS |
| `POS-MOD-06` | TIER_2_MUTATION | DOM Container Restructuring | Module 1: Authentication: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1418.46ms | ✅ PASS |
| `POS-MOD-07` | TIER_2_MUTATION | Parent/Child Nesting | Module 1: Authentication: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1414.43ms | ✅ PASS |
| `POS-MOD-08` | TIER_2_MUTATION | Input Label Association | Module 1: Authentication: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1447.42ms | ✅ PASS |
| `POS-MOD-09` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 1: Authentication: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1441.02ms | ✅ PASS |
| `POS-MOD-10` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 1: Authentication: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1414.05ms | ✅ PASS |
| `POS-MOD-11` | TIER_2_MUTATION | Scoped Selector Shift | Module 1: Authentication: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1418.53ms | ✅ PASS |
| `POS-MOD-12` | TIER_2_MUTATION | Tag Type Substitution | Module 1: Authentication: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1419.31ms | ✅ PASS |
| `POS-MOD-13` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 2: Products: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1388.9ms | ✅ PASS |
| `POS-MOD-14` | TIER_2_MUTATION | Accessible Name Drift | Module 2: Products: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1356.71ms | ✅ PASS |
| `POS-MOD-15` | TIER_2_MUTATION | Class Volatility | Module 2: Products: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1389.18ms | ✅ PASS |
| `POS-MOD-16` | TIER_2_MUTATION | Role & Name Combination | Module 2: Products: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1395.21ms | ✅ PASS |
| `POS-MOD-17` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 2: Products: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1394.57ms | ✅ PASS |
| `POS-MOD-18` | TIER_2_MUTATION | DOM Container Restructuring | Module 2: Products: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1388.09ms | ✅ PASS |
| `POS-MOD-19` | TIER_2_MUTATION | Parent/Child Nesting | Module 2: Products: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1389.31ms | ✅ PASS |
| `POS-MOD-20` | TIER_2_MUTATION | Input Label Association | Module 2: Products: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1390.15ms | ✅ PASS |
| `POS-MOD-21` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 2: Products: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1384.93ms | ✅ PASS |
| `POS-MOD-22` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 2: Products: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1421.9ms | ✅ PASS |
| `POS-MOD-23` | TIER_2_MUTATION | Scoped Selector Shift | Module 2: Products: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1378.32ms | ✅ PASS |
| `POS-MOD-24` | TIER_2_MUTATION | Tag Type Substitution | Module 2: Products: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1413.14ms | ✅ PASS |
| `POS-MOD-25` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 3: Cart: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1405.67ms | ✅ PASS |
| `POS-MOD-26` | TIER_2_MUTATION | Accessible Name Drift | Module 3: Cart: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1412.26ms | ✅ PASS |
| `POS-MOD-27` | TIER_2_MUTATION | Class Volatility | Module 3: Cart: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1369.63ms | ✅ PASS |
| `POS-MOD-28` | TIER_2_MUTATION | Role & Name Combination | Module 3: Cart: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1388.54ms | ✅ PASS |
| `POS-MOD-29` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 3: Cart: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1434.42ms | ✅ PASS |
| `POS-MOD-30` | TIER_2_MUTATION | DOM Container Restructuring | Module 3: Cart: DOM Container Restructuring | REPAIR_SUCCESS | FAIL | 4164.01ms | ❌ FAIL |
| `POS-MOD-31` | TIER_2_MUTATION | Parent/Child Nesting | Module 3: Cart: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1393.78ms | ✅ PASS |
| `POS-MOD-32` | TIER_2_MUTATION | Input Label Association | Module 3: Cart: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1441.56ms | ✅ PASS |
| `POS-MOD-33` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 3: Cart: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1390.39ms | ✅ PASS |
| `POS-MOD-34` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 3: Cart: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1406.1ms | ✅ PASS |
| `POS-MOD-35` | TIER_2_MUTATION | Scoped Selector Shift | Module 3: Cart: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1395.12ms | ✅ PASS |
| `POS-MOD-36` | TIER_2_MUTATION | Tag Type Substitution | Module 3: Cart: Tag Type Substitution | REPAIR_SUCCESS | FAIL | 4181.88ms | ❌ FAIL |
| `POS-MOD-37` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 4: Checkout: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1397.59ms | ✅ PASS |
| `POS-MOD-38` | TIER_2_MUTATION | Accessible Name Drift | Module 4: Checkout: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1404.76ms | ✅ PASS |
| `POS-MOD-39` | TIER_2_MUTATION | Class Volatility | Module 4: Checkout: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1381.76ms | ✅ PASS |
| `POS-MOD-40` | TIER_2_MUTATION | Role & Name Combination | Module 4: Checkout: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1407.48ms | ✅ PASS |
| `POS-MOD-41` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 4: Checkout: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1402.84ms | ✅ PASS |
| `POS-MOD-42` | TIER_2_MUTATION | DOM Container Restructuring | Module 4: Checkout: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1386.23ms | ✅ PASS |
| `POS-MOD-43` | TIER_2_MUTATION | Parent/Child Nesting | Module 4: Checkout: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1402.52ms | ✅ PASS |
| `POS-MOD-44` | TIER_2_MUTATION | Input Label Association | Module 4: Checkout: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1386.44ms | ✅ PASS |
| `POS-MOD-45` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 4: Checkout: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1391.04ms | ✅ PASS |
| `POS-MOD-46` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 4: Checkout: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1395.93ms | ✅ PASS |
| `POS-MOD-47` | TIER_2_MUTATION | Scoped Selector Shift | Module 4: Checkout: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1434.95ms | ✅ PASS |
| `POS-MOD-48` | TIER_2_MUTATION | Tag Type Substitution | Module 4: Checkout: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1385.64ms | ✅ PASS |
| `POS-MOD-49` | TIER_2_MUTATION | Dynamic Hashed IDs | Module 5: Admin: Dynamic Hashed IDs | REPAIR_SUCCESS | REPAIR_SUCCESS | 1384.83ms | ✅ PASS |
| `POS-MOD-50` | TIER_2_MUTATION | Accessible Name Drift | Module 5: Admin: Accessible Name Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1387.92ms | ✅ PASS |
| `POS-MOD-51` | TIER_2_MUTATION | Class Volatility | Module 5: Admin: Class Volatility | REPAIR_SUCCESS | REPAIR_SUCCESS | 1402.99ms | ✅ PASS |
| `POS-MOD-52` | TIER_2_MUTATION | Role & Name Combination | Module 5: Admin: Role & Name Combination | REPAIR_SUCCESS | REPAIR_SUCCESS | 1403.25ms | ✅ PASS |
| `POS-MOD-53` | TIER_2_MUTATION | Test-ID Attribute Removal | Module 5: Admin: Test-ID Attribute Removal | REPAIR_SUCCESS | REPAIR_SUCCESS | 1399.9ms | ✅ PASS |
| `POS-MOD-54` | TIER_2_MUTATION | DOM Container Restructuring | Module 5: Admin: DOM Container Restructuring | REPAIR_SUCCESS | REPAIR_SUCCESS | 1418.36ms | ✅ PASS |
| `POS-MOD-55` | TIER_2_MUTATION | Parent/Child Nesting | Module 5: Admin: Parent/Child Nesting | REPAIR_SUCCESS | REPAIR_SUCCESS | 1402.02ms | ✅ PASS |
| `POS-MOD-56` | TIER_2_MUTATION | Input Label Association | Module 5: Admin: Input Label Association | REPAIR_SUCCESS | REPAIR_SUCCESS | 1381.14ms | ✅ PASS |
| `POS-MOD-57` | TIER_2_MUTATION | Placeholder Attribute Drift | Module 5: Admin: Placeholder Attribute Drift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1373.88ms | ✅ PASS |
| `POS-MOD-58` | TIER_2_MUTATION | Copy Refresh & Verb Shift | Module 5: Admin: Copy Refresh & Verb Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1394.15ms | ✅ PASS |
| `POS-MOD-59` | TIER_2_MUTATION | Scoped Selector Shift | Module 5: Admin: Scoped Selector Shift | REPAIR_SUCCESS | REPAIR_SUCCESS | 1389.62ms | ✅ PASS |
| `POS-MOD-60` | TIER_2_MUTATION | Tag Type Substitution | Module 5: Admin: Tag Type Substitution | REPAIR_SUCCESS | REPAIR_SUCCESS | 1388.11ms | ✅ PASS |
| `NEG-MOD-01` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 1: Authentication: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 154.42ms | ✅ PASS |
| `NEG-MOD-02` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 1: Authentication: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 151.11ms | ✅ PASS |
| `NEG-MOD-03` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 1: Authentication: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 148.69ms | ✅ PASS |
| `NEG-MOD-04` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 1: Authentication: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 150.3ms | ✅ PASS |
| `NEG-MOD-05` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 1: Authentication: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 150.05ms | ✅ PASS |
| `NEG-MOD-06` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 1: Authentication: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 165.94ms | ✅ PASS |
| `NEG-MOD-07` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 1: Authentication: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 150.63ms | ✅ PASS |
| `NEG-MOD-08` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 1: Authentication: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 149.77ms | ✅ PASS |
| `NEG-MOD-09` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 1: Authentication: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 150.21ms | ✅ PASS |
| `NEG-MOD-10` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 1: Authentication: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 151.55ms | ✅ PASS |
| `NEG-MOD-11` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 1: Authentication: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 163.06ms | ✅ PASS |
| `NEG-MOD-12` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 1: Authentication: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 177.61ms | ✅ PASS |
| `NEG-MOD-13` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 2: Products: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 156.18ms | ✅ PASS |
| `NEG-MOD-14` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 2: Products: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 148.49ms | ✅ PASS |
| `NEG-MOD-15` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 2: Products: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 149.43ms | ✅ PASS |
| `NEG-MOD-16` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 2: Products: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 153.37ms | ✅ PASS |
| `NEG-MOD-17` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 2: Products: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 147.86ms | ✅ PASS |
| `NEG-MOD-18` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 2: Products: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 149.27ms | ✅ PASS |
| `NEG-MOD-19` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 2: Products: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 149.18ms | ✅ PASS |
| `NEG-MOD-20` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 2: Products: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 152.59ms | ✅ PASS |
| `NEG-MOD-21` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 2: Products: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 163.18ms | ✅ PASS |
| `NEG-MOD-22` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 2: Products: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 151.32ms | ✅ PASS |
| `NEG-MOD-23` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 2: Products: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 150.65ms | ✅ PASS |
| `NEG-MOD-24` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 2: Products: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 156.79ms | ✅ PASS |
| `NEG-MOD-25` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 3: Cart: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 158.01ms | ✅ PASS |
| `NEG-MOD-26` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 3: Cart: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 149.79ms | ✅ PASS |
| `NEG-MOD-27` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 3: Cart: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 150.73ms | ✅ PASS |
| `NEG-MOD-28` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 3: Cart: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 149.82ms | ✅ PASS |
| `NEG-MOD-29` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 3: Cart: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 150.91ms | ✅ PASS |
| `NEG-MOD-30` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 3: Cart: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 164.74ms | ✅ PASS |
| `NEG-MOD-31` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 3: Cart: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 150.6ms | ✅ PASS |
| `NEG-MOD-32` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 3: Cart: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 148.26ms | ✅ PASS |
| `NEG-MOD-33` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 3: Cart: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 150.99ms | ✅ PASS |
| `NEG-MOD-34` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 3: Cart: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 150.79ms | ✅ PASS |
| `NEG-MOD-35` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 3: Cart: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 148.91ms | ✅ PASS |
| `NEG-MOD-36` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 3: Cart: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 150.4ms | ✅ PASS |
| `NEG-MOD-37` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 4: Checkout: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 167.67ms | ✅ PASS |
| `NEG-MOD-38` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 4: Checkout: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 152.35ms | ✅ PASS |
| `NEG-MOD-39` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 4: Checkout: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 146.23ms | ✅ PASS |
| `NEG-MOD-40` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 4: Checkout: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 151.03ms | ✅ PASS |
| `NEG-MOD-41` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 4: Checkout: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 150.34ms | ✅ PASS |
| `NEG-MOD-42` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 4: Checkout: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 149.45ms | ✅ PASS |
| `NEG-MOD-43` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 4: Checkout: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 149.92ms | ✅ PASS |
| `NEG-MOD-44` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 4: Checkout: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 150.1ms | ✅ PASS |
| `NEG-MOD-45` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 4: Checkout: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 147.7ms | ✅ PASS |
| `NEG-MOD-46` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 4: Checkout: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 152.24ms | ✅ PASS |
| `NEG-MOD-47` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 4: Checkout: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 148.78ms | ✅ PASS |
| `NEG-MOD-48` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 4: Checkout: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 148.76ms | ✅ PASS |
| `NEG-MOD-49` | TIER_3_NEGATIVE_CONTROL | BACKEND_500 | Module 5: Admin: In-Domain HTTP 500 Service Crash | ABSTAIN | ABSTAIN | 150.44ms | ✅ PASS |
| `NEG-MOD-50` | TIER_3_NEGATIVE_CONTROL | BUSINESS_DEFECT | Module 5: Admin: Seeded Business Logic Calculation Error | ABSTAIN | ABSTAIN | 151.61ms | ✅ PASS |
| `NEG-MOD-51` | TIER_3_NEGATIVE_CONTROL | AMBIGUOUS_LOCATOR | Module 5: Admin: StrictMode Duplicate Identical Buttons | ABSTAIN | ABSTAIN | 147.92ms | ✅ PASS |
| `NEG-MOD-52` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 5: Admin: HTTP 401 Session Token Expired | ABSTAIN | ABSTAIN | 150.71ms | ✅ PASS |
| `NEG-MOD-53` | TIER_3_NEGATIVE_CONTROL | AUTH_ERROR | Module 5: Admin: HTTP 403 Forbidden Role Restriction | ABSTAIN | ABSTAIN | 148.66ms | ✅ PASS |
| `NEG-MOD-54` | TIER_3_NEGATIVE_CONTROL | DISABLED_CONTROL | Module 5: Admin: Disabled Button Element Boundary | ABSTAIN | ABSTAIN | 134.09ms | ✅ PASS |
| `NEG-MOD-55` | TIER_3_NEGATIVE_CONTROL | HIDDEN_ELEMENT | Module 5: Admin: Hidden Element (display: none) | ABSTAIN | ABSTAIN | 150.2ms | ✅ PASS |
| `NEG-MOD-56` | TIER_3_NEGATIVE_CONTROL | ASSERTION_FAILURE | Module 5: Admin: Assertion Expectation Mismatch | ABSTAIN | ABSTAIN | 149.52ms | ✅ PASS |
| `NEG-MOD-57` | TIER_3_NEGATIVE_CONTROL | MISSING_DATA | Module 5: Admin: HTTP 404 Missing Resource Defect | ABSTAIN | ABSTAIN | 149.39ms | ✅ PASS |
| `NEG-MOD-58` | TIER_3_NEGATIVE_CONTROL | OBSTRUCTED_ELEMENT | Module 5: Admin: Modal Overlay Covering Target | ABSTAIN | ABSTAIN | 150.94ms | ✅ PASS |
| `NEG-MOD-59` | TIER_3_NEGATIVE_CONTROL | UNRELATED_NETWORK_ERROR | Module 5: Admin: Background Tracking Pixel 404 | ABSTAIN | ABSTAIN | 165.89ms | ✅ PASS |
| `NEG-MOD-60` | TIER_3_NEGATIVE_CONTROL | UNSUPPORTED_EXPRESSION | Module 5: Admin: Unsupported Dynamic Expression | ABSTAIN | ABSTAIN | 150.63ms | ✅ PASS |

## Architectural Verification Evidence
1. **True Browser Execution:** All 125 scenarios were executed in real headless Chromium against `ControlledAppServer`.
2. **Live Reproduction:** Multi-source collectors (`LiveBrowserCollector`) captured live DOM, ariaSnapshot, and console events at the exact point of failure.
3. **Empirical Verifier:** Candidate selectors were validated on the live browser DOM using `LiveLocatorVerifier` prior to AST patching.
4. **Zero Hardcoded Rates:** Regression rate, defect masking rate, and false repair rate were computed strictly from execution arrays with zero hardcoded literals.

## Statistical Interpretation
> [!NOTE]
> Wilson 95% CIs represent separate binomial confidence intervals over real empirical headless Chromium trials under controlled benchmark distributions, not an unconstrained universal production reliability guarantee.