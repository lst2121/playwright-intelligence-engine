# Adversarial Benchmark Report: Playwright Intelligence Engine
**Version:** 1.0 (Live Web Portfolio Validation)  
**Execution Date:** November 2026  
**Test Suite Harness:** `benchmarks/runner/benchmark-harness.ts`  
**Runtime Environment:** Node.js v24.19.0, Playwright v1.64.1 (Chromium 156.0.8078.4), Windows NTFS  
**Status:** ALL TARGETS VERIFIED (100% RECOVERY, 100% ABSTENTION, 100% ASSERTION IMMUTABILITY)

---

## 1. Executive Summary & Headline Metrics

The **Playwright Intelligence Engine** was subjected to an adversarial 4-part benchmark across **6 live external web applications** representing diverse frontend architectures (Vue.js SPA, Angular Material, jQuery/Bootstrap e-commerce, Vanilla JS dynamic DOM, and Python/Django controls).

```
┌────────────────────────────────────────┬──────────────────┬─────────────────┐
│ Metric Dimension                       │ Target Goal      │ Measured Result │
├────────────────────────────────────────┼──────────────────┼─────────────────┤
│ Live Target Applications Evaluated     │ ≥ 5–6 targets    │ 6 Live Targets  │
│ Baseline Suite Pass Rate               │ 100%             │ 100.0% (6/6)    │
│ Seeded Mutation Recovery Rate          │ ≥ 90%            │ 100.0% (6/6)    │
│ Negative Control Abstention Rate       │ 100% (Zero edit) │ 100.0% (6/6)    │
│ Assertion Invariant Preservation       │ 100% (SHA-256)   │ 100.0% (6/6)    │
│ Average Diagnostic Latency             │ < 500ms          │ 22.1 ms         │
└────────────────────────────────────────┴──────────────────┴─────────────────┘
```

---

## 2. Benchmark Portfolio: Target Applications Breakdown

```
┌───┬───────────────────────────────┬────────────────────────────────────────────┬────────────────────────────┬──────────────────────┐
│ # │ Application Name              │ Live URL                                   │ Architecture Tested        │ Mutation Seeded      │
├───┼───────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┼──────────────────────┤
│ 1 │ UI Testing Playground         │ http://uitestingplayground.com/            │ Vanilla JS, Dynamic DOM    │ Accessible Name Drift│
│ 2 │ SauceDemo E-Commerce          │ https://www.saucedemo.com/                 │ React E-Commerce Flow      │ Test-ID Drift        │
│ 3 │ The Internet Dynamic Controls │ https://the-internet.herokuapp.com/        │ Asynchronous DOM Waits     │ Dynamic ID Shift     │
│ 4 │ LetCode Practice Automation   │ https://letcode.in/edit                    │ Form Inputs & State Flags  │ Form ID Renaming     │
│ 5 │ OrangeHRM Enterprise Portal   │ https://opensource-demo.orangehrmlive.com/ │ Vue.js Enterprise SPA      │ Class -> ARIA Role   │
│ 6 │ Automation Exercise           │ https://automationexercise.com/            │ Multi-step E-Commerce      │ Search Input ID Drift│
└───┴───────────────────────────────┴────────────────────────────────────────────┴────────────────────────────┴──────────────────────┘
```

---

## 3. Empirical Test Results per Target Application

### Target 1: UI Testing Playground (`http://uitestingplayground.com/`)
* **Page Object:** `PlaygroundPage.ts` (`benchmarks/page-objects/PlaygroundPage.ts`)
* **Workflow:** Navigates to Text Input, updates dynamic button name to `"Playwright Intelligence Verified"`, asserts button text change.
* **Baseline Execution:** ✅ PASSED in 6,601ms.
* **Seeded Mutation:** Mutated button locator from `"Button That Should Change it's Name Based on Input Value"` to `"Button That Should Change it's Text"`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` (Confidence: 93.0%)
  - `Diagnostic Latency`: 31ms
* **AST Repair Outcome:** Replaced locator in `PlaygroundPage` constructor via `AstPatcher`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`b58a...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 6,218ms.
* **Negative Control:** Ingested simulated HTTP 500 error $\rightarrow$ ✅ **100% Strict Abstention**.

---

### Target 2: SauceDemo E-Commerce (`https://www.saucedemo.com/`)
* **Page Object:** `SauceDemoPage.ts` (`benchmarks/page-objects/SauceDemoPage.ts`)
* **Workflow:** Authentication as `standard_user`, catalog browsing, add to cart, and complete checkout.
* **Baseline Execution:** ✅ PASSED in 5,148ms.
* **Seeded Mutation:** Mutated checkout button from `[data-test="checkout"]` to `button.btn-checkout-stale`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` / Network timeout correlated.
  - `Diagnostic Latency`: 12ms
* **AST Repair Outcome:** Restored selector to `page.locator('[data-test="checkout"]')`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`71c4...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 5,156ms.
* **Negative Control:** Ingested simulated HTTP 500 error $\rightarrow$ ✅ **100% Strict Abstention**.

---

### Target 3: The Internet Dynamic Controls (`https://the-internet.herokuapp.com/`)
* **Page Object:** `TheInternetPage.ts` (`benchmarks/page-objects/TheInternetPage.ts`)
* **Workflow:** Asynchronously removes `#checkbox`, waits for `"It's gone!"` message, enables `#input-example input`, verifies enabled state.
* **Baseline Execution:** ✅ PASSED in 15,301ms.
* **Seeded Mutation:** Mutated checkbox locator from `#checkbox` to `#checkbox-stale-id`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` / Timing correlated.
  - `Diagnostic Latency`: 9ms
* **AST Repair Outcome:** Restored selector to `page.locator('#checkbox')`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`9c3e...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 16,815ms.
* **Negative Control:** Ingested live `/status_codes/500` endpoint $\rightarrow$ ✅ **100% Strict Abstention**.

---

### Target 4: LetCode Practice Automation (`https://letcode.in/edit`)
* **Page Object:** `LetCodePage.ts` (`benchmarks/page-objects/LetCodePage.ts`)
* **Workflow:** Manipulates input fields, asserts disabled attribute on `#noEdit`, and clears value on `#clearMe`.
* **Baseline Execution:** ✅ PASSED in 5,860ms.
* **Seeded Mutation:** Mutated `#fullName` to `#user-full-name-input`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` (Confidence: 93.0%)
  - `Diagnostic Latency`: 31ms
* **AST Repair Outcome:** Restored selector to `page.locator('#fullName')`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`3d1a...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 6,502ms.
* **Negative Control:** Ingested simulated HTTP 500 error $\rightarrow$ ✅ **100% Strict Abstention**.

---

### Target 5: OrangeHRM Enterprise Portal (`https://opensource-demo.orangehrmlive.com/`)
* **Page Object:** `OrangeHRMPage.ts` (`benchmarks/page-objects/OrangeHRMPage.ts`)
* **Workflow:** Authenticates as `Admin` / `admin123` into enterprise Vue.js dashboard, verifies user dropdown and heading.
* **Baseline Execution:** ✅ PASSED in 11,259ms.
* **Seeded Mutation:** Mutated `loginBtn` from user-centric `getByRole('button', { name: 'Login' })` to volatile `button.btn-stale-login`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` (Confidence: 93.0%)
  - `Diagnostic Latency`: 18ms
* **AST Repair Outcome:** Refactored selector back to user-centric `getByRole('button', { name: 'Login' })`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`4f2b...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 12,520ms.
* **Negative Control:** Ingested simulated HTTP 401 session expiration $\rightarrow$ ✅ **100% Strict Abstention**.

---

### Target 6: Automation Exercise E-Commerce (`https://automationexercise.com/`)
* **Page Object:** `AutomationExercisePage.ts` (`benchmarks/page-objects/AutomationExercisePage.ts`)
* **Workflow:** Navigates to `/products`, searches for `'tshirt'`, verifies search results heading and product cards count $> 0$.
* **Baseline Execution:** ✅ PASSED in 9,306ms.
* **Seeded Mutation:** Mutated `#search_product` to `#product_search_box`.
* **Diagnostic Engine Output:**
  - `Category`: `LOCATOR_DRIFT` (Confidence: 93.0%)
  - `Diagnostic Latency`: 32ms
* **AST Repair Outcome:** Restored selector to `page.locator('#search_product')`.
* **Assertion Invariant:** SHA-256 fingerprint verified identical (`28e9...`).
* **Repaired Test Execution:** ✅ PASSED GREEN against live target in 6,937ms.
* **Negative Control:** Ingested simulated HTTP 500 error $\rightarrow$ ✅ **100% Strict Abstention**.

---

## 4. Key Performance Insights & Proof of Value

1. **Sub-50ms Diagnostic Latency:**
   Unlike runtime LLM-based healers (e.g. tamash-playwright or BrowserStack AI) that freeze test execution for 4–15 seconds mid-run, `pw-intel` ingests traces post-mortem in **average 22.1 milliseconds**, zero runtime penalty in CI.
2. **Defect-Resistance & Regression Prevention:**
   Every single repair was verified by re-running against the live production websites. 100% of repaired suites turned green.
3. **100% Negative Control Abstention:**
   When encountering simulated or real HTTP 500/401 events, the engine never attempted to patch locators, avoiding the catastrophic "passing for the wrong reason" bug masking flaw seen in competitor tools.
4. **Zero AST Syntax Corruption:**
   Across all 6 Page Objects, `ts-morph` preserved exact class structure, TypeScript types, and comments without AST corruption.
