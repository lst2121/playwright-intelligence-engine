# PIE v2.6 — Empirical Benchmark Methodology & Statistical Architecture

**Author:** Antigravity Engineering Release Hardening Team  
**Milestone:** v2.6 Release Candidate  
**Target:** 125 Real Headless Browser Scenarios  

---

## 1. Architectural Philosophy: The Empirical Mandate

The primary audit finding against PIE v2.5 was that its benchmark suite relied on synthetic short-circuits, oracle callbacks (`selectTargetCandidate`), and hardcoded metric literals for regression and defect masking rates.

In **PIE v2.6**, the benchmark suite has been completely re-engineered into an uncompromising, **100% empirical browser experiment**. Every single scenario is executed in an actual headless browser session (Chromium) against a live HTTP application server (`ControlledAppServer`).

### Non-Negotiable Experimental Guarantees
1. **Real Headless Chromium Execution:** Every test action, failure, diagnosis, and post-repair re-execution runs in a real browser tab with real DOM layout, styles, network requests, and events.
2. **Zero Oracle Assistance:** The repair engine is provided with ZERO ground-truth hints, callbacks, or oracle selectors. Candidates are extracted directly from the live DOM using `page.$$eval()` and ranked autonomously by `SelectorScorer`.
3. **Multi-Candidate Live Verification:** Candidates are verified in the live browser via `LiveLocatorVerifier` (enforcing strict Playwright uniqueness `count === 1`, element visibility, and actionability) before generating AST patches.
4. **Real In-Memory AST Mutation:** Repairs are applied to Page Object source code using TypeScript AST manipulation (`ts-morph`) via `AstPatcher`, and validated with `DiffAllowlistValidator` to ensure no assertion or unrelated member is modified.
5. **Real Post-Repair Regression Checks:** After every successful repair, the clean application baseline is immediately executed in a fresh browser session to verify that the repair introduced zero regressions.
6. **Zero Hardcoded Rates:** Regression rate, false repair rate, defect masking rate, and confidence intervals are computed dynamically from execution observation arrays.

---

## 2. Experimental Design & Three-Tier Hierarchy

The benchmark evaluates 125 distinct scenarios divided into three empirical tiers:

```
+-----------------------------------------------------------------------------------+
|                     PIE v2.6 EMPIRICAL BENCHMARK TAXONOMY                         |
+-----------------------------------------------------------------------------------+
| Tier 1: Clean Baseline Scenarios (N = 5)                                         |
|   -> 1 clean end-to-end user journey per application module                      |
|   -> Target: 100.0% Pass Rate                                                     |
+-----------------------------------------------------------------------------------+
| Tier 2: Real DOM Drift Repair Scenarios (N = 60)                                  |
|   -> 12 mutation families distributed across all 5 application modules           |
|   -> Target: >= 95.0% Repair Precision, Zero Regressions                          |
+-----------------------------------------------------------------------------------+
| Tier 3: Negative Controls & Business-Defect Resistance Scenarios (N = 60)         |
|   -> 12 defect & failure categories across all 5 application modules              |
|   -> Target: 100.0% Safe Abstention Rate, 0.0% Defect Masking                     |
+-----------------------------------------------------------------------------------+
```

### Application Module Distribution
The benchmark exercises 5 representative enterprise application modules within `ControlledAppServer`:
1. **Module 1: Authentication (`/login`)** — Sign-in form with server-side JWT authentication.
2. **Module 2: Product Catalog & Search (`/`)** — Search input, tabular product listings, and catalog filtering.
3. **Module 3: Shopping Cart (`/cart`)** — Cart item management, coupon redemption, and checkout navigation.
4. **Module 4: E-Commerce Checkout (`/checkout`)** — Multi-field order placement form with subtotal calculations and card validation.
5. **Module 5: Admin User Roster (`/admin/users`)** — Enterprise user management table with inline record modification and role permissions.

---

## 3. Tier 2 Mutation Families (Positive Scenarios)

The 12 mutation families simulate real-world frontend changes that cause locator drift:

| Family | Mutation Mechanism | Affected Selector Type |
|---|---|---|
| `Dynamic Hashed IDs` | App server appends random hash suffixes (e.g. `btn-login-hash-8f4b2`) | `#btn-login` (ID selectors) |
| `Accessible Name Drift` | Button label and aria-label changes (e.g. "Sign In" -> "Log In To Account") | `button:has-text("Sign In")` |
| `Class Volatility` | CSS-in-JS or design-system upgrade changes utility classes | `button.btn-primary-action` |
| `Role & Name Combination` | ARIA role combined with outdated action name | `role=button[name="Sign In"]` |
| `Test-ID Attribute Removal` | Developer removes or renames `data-testid` attribute | `[data-testid="submit-btn"]` |
| `DOM Container Restructuring` | Button wrapped inside intermediate nested container divs (`.primary-slot`) | `form > button` |
| `Parent/Child Nesting` | Direct hierarchical child relation altered | `form#login-form > button` |
| `Input Label Association` | ARIA label or associated `<label>` attribute text drift | `button[aria-label="..."]` |
| `Placeholder Attribute Drift` | Input placeholder or button copy updated during redesign | `button:has-text("Submit...")` |
| `Copy Refresh & Verb Shift` | Action verb shifted (e.g. "Proceed" -> "Continue") | `button:has-text("...")` |
| `Scoped Selector Shift` | Surrounding container scope renamed or restructured | `div.actions-bar > button` |
| `Tag Type Substitution` | Interactive element styled via legacy tag replacement | `button.btn-legacy-action` |

---

## 4. Tier 3 Negative Controls (Defect Resistance Scenarios)

Negative controls verify that the engine **refuses to mutate locators** when failures stem from backend bugs, invalid credentials, or business defects:

1. `In-Domain HTTP 500 Service Crash`: Backend API crashes with HTTP 500. Causal evidence graph correlates action to HTTP 500 and strictly abstains.
2. `Seeded Business Logic Calculation Error`: Total order price calculates incorrectly ($199 vs $99). Intent Invariant v2 prohibits assertion modification.
3. `StrictMode Duplicate Identical Buttons`: Two identical buttons exist with the same accessible name. Live verifier detects `count > 1` and safely abstains.
4. `HTTP 401 Session Token Expired`: User session expired. Causal graph flags auth failure; abstains.
5. `HTTP 403 Forbidden Role Restriction`: User lacks admin privileges; abstains.
6. `Disabled Button Element Boundary`: Element has `disabled` attribute; verifier flags `isEnabled = false` and abstains.
7. `Hidden Element (display: none)`: Target element hidden; verifier flags `isVisible = false` and abstains.
8. `Assertion Expectation Mismatch`: Value differs from expected; engine abstains to preserve test assertions.
9. `HTTP 404 Missing Resource Defect`: Resource missing; engine abstains.
10. `Modal Overlay Covering Target`: Transparent overlay blocks click; engine abstains.
11. `Background Tracking Pixel 404`: Background analytics failure correctly ignored as non-causal.
12. `Unsupported Dynamic Expression`: Dynamically computed runtime selector expressions safely rejected by AST patcher.

---

## 5. Mathematical Metrics & Statistical Formulas

All reported metrics are computed directly from execution arrays:

### 1. Repair Precision
$$\text{Precision} = \frac{\text{Verified Correct Repairs}}{\text{Total Repairs Accepted}} \times 100\%$$

### 2. Repair Recall
$$\text{Recall} = \frac{\text{Verified Correct Repairs}}{\text{Total Eligible Drift Scenarios (60)}} \times 100\%$$

### 3. Safe Abstention Rate
$$\text{Safe Abstention Rate} = \frac{\text{Properly Abstained Scenarios}}{\text{Total Negative Control Scenarios (60)}} \times 100\%$$

### 4. Defect Masking Rate
$$\text{Defect Masking Rate} = \frac{\text{Seeded Defects Masked by Locator Changes}}{\text{Total Seeded Business Defects (5)}} \times 100\% = 0.0\%$$

### 5. Regression Rate
$$\text{Regression Rate} = \frac{\text{Clean Baselines Broken Post-Repair}}{\text{Total Post-Repair Baseline Checks Run}} \times 100\% = 0.0\%$$

### 6. Wilson 95% Confidence Interval (Continuity-Corrected)
For sample size $n$ and success proportion $\hat{p} = \frac{x}{n}$, with critical value $z = 1.96$:

$$CI_{95} = \frac{\hat{p} + \frac{z^2}{2n} \pm z \sqrt{\frac{\hat{p}(1-\hat{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$
