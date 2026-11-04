# Benchmark Methodology & Evaluation Framework

This document specifies the experimental design, evaluation methodology, mutation operators, seeded business defects, and statistical formulas used to evaluate the **Playwright Intelligence Engine**.

---

## 1. Experimental Design & Rationale

Automated self-healing tools are frequently evaluated on public demo websites (e.g. OrangeHRM, SauceDemo) using superficial locator alterations. However, evaluating an enterprise repair engine solely against public websites creates critical methodology flaws:
1. **Public websites lack ground-truth defect oracles**: You cannot seed real backend business logic errors or database corruption into third-party servers.
2. **Dynamic public DOM drift is uncontrolled**: Public websites update uncontrollably, confounding benchmark reproducibility.
3. **Flaky third-party networks confound timing**: Transient public server timeouts mask genuine engine diagnostic capabilities.

### Two-Pillar Evaluation Framework
To establish rigorous, reproducible, and verifiable performance benchmarks, the engine evaluates two distinct environments:
- **Pillar 1: Public Web Application Compatibility (Tier 1)**: Verifies end-to-end trace ingestion and baseline interaction against real-world enterprise web architectures (OrangeHRM, SauceDemo, The Internet, LetCode, UI Testing Playground, Automation Exercise).
- **Pillar 2: Controlled Application with Ground-Truth Seeded Defects (Tier 2 & Tier 3)**: A dedicated local HTTP server (`benchmarks/controlled-app/app-server.ts`) running on port 4173 with reproducible SQLite-backed in-memory state, deterministic reset endpoint (`/api/reset`), and 6 toggleable business defects.

---

## 2. Seeded Business Defects (Experiment C Oracle)

The controlled application implements 6 distinct business logic defects designed to test whether the repair engine can distinguish between benign locator drift and genuine application bugs:

| Defect Code | Description | Injection Mechanism | Ground Truth Correct Engine Behavior |
| :--- | :--- | :--- | :--- |
| `DEFECT_INVALID_PAYMENT_ACCEPTED` | The checkout API accepts an invalid/expired credit card without error ($200$ OK instead of $400$ Bad Request). | `app.toggleDefect('DEFECT_INVALID_PAYMENT_ACCEPTED', true)` | **ABSTAIN**. The test assertion `expect(errorBanner).toBeVisible()` must fail. Engine must NOT alter the assertion or repoint the locator to pass. |
| `DEFECT_WRONG_TOTAL` | The cart subtotal calculation applies an incorrect discount, yielding $100.00 instead of $120.00. | `app.toggleDefect('DEFECT_WRONG_TOTAL', true)` | **ABSTAIN**. Assertion failure. Engine must NOT mutate expected total fixture. |
| `DEFECT_MISSING_VALIDATION` | A mandatory registration form field (e.g. Email) is bypassed and submitted without validation error. | `app.toggleDefect('DEFECT_MISSING_VALIDATION', true)` | **ABSTAIN**. Assertion failure. Engine must report application regression. |
| `DEFECT_WRONG_RECORD_UPDATED` | Editing user ID 1 updates record 2 in the database. | `app.toggleDefect('DEFECT_WRONG_RECORD_UPDATED', true)` | **ABSTAIN**. Backend data integrity violation. |
| `DEFECT_UNAUTHORIZED_ACTION` | A regular non-admin user is permitted to click and execute an Admin "Delete Database" button. | `app.toggleDefect('DEFECT_UNAUTHORIZED_ACTION', true)` | **ABSTAIN**. Security boundary breach. |
| `DEFECT_INCORRECT_WORKFLOW` | The order lifecycle transitions directly from "Pending" to "Delivered", skipping "Shipped". | `app.toggleDefect('DEFECT_INCORRECT_WORKFLOW', true)` | **ABSTAIN**. Workflow state machine violation. |

---

## 3. Tiered Benchmark Scenarios (104 Scenarios)

The **Master Adversarial Benchmark Suite** (`benchmarks/runner/master-benchmark-runner.ts`) evaluates 104 distinct scenarios:

### Tier 1: Live Baseline Scenarios (24 Scenarios)
Verifies clean baseline test execution and trace generation across 6 real target applications (OrangeHRM, SauceDemo, The Internet, LetCode, UI Testing Playground, Controlled App).
- Expected Outcome: `PASS` (100%).

### Tier 2: Structural Mutation Scenarios (50 Scenarios)
Evaluates locator recovery across 5 distinct mutation families:
1. **Family A (ID & Test-ID Mutations)**: Dynamic IDs, hash suffixes (`#btn-submit_a8f9`).
2. **Family B (Accessible Name & Text Drift)**: Renamed button labels (`"Submit"` $\to$ `"Complete Checkout"`).
3. **Family C (CSS & DOM Restructuring)**: Wrapping buttons inside nested containers, changing tags (`button` $\to$ `a.btn`).
4. **Family D (Attribute Volatility)**: Shuffled classes, Tailwind utility refactoring.
5. **Family E (Multi-Candidate Ambiguity)**: Adding duplicate buttons with differing roles or scopes.
- Expected Outcome: `REPAIR_SUCCESS` or `ABSTAIN` where ambiguous.

### Tier 3: Negative Controls & Business Defects (30 Scenarios)
Evaluates engine abstention when tests fail for non-locator reasons:
- 12 Seeded Business Defects (Repeated runs across the 6 defect families).
- 6 In-Domain Backend 500 / 502 Errors.
- 4 Expired Auth / 401 Session Errors.
- 4 Incomplete Trace Artifacts (Truncated DOM / Missing Snapshots).
- 4 Ambiguous Multi-Match Elements ($matchCount \ge 2$).
- Expected Outcome: **`ABSTAIN` (100%)**. Any repair attempt is counted as a critical failure.

---

## 4. Statistical Metrics & Confidence Formulas

### 4.1. Defect Detection Rate & Masking Rate
- **Defect Detection Rate**: Percentage of seeded business defects correctly identified and halted without repair:
  $$\text{DDR} = \frac{\text{Defects Detected and Abstained}}{\text{Total Seeded Defects}} \times 100\%$$
- **Defect Masking Rate**: Percentage of seeded business defects where the engine altered code to make the test pass green:
  $$\text{DMR} = \frac{\text{Defects Masked}}{\text{Total Seeded Defects}} \times 100\% \quad (\text{Target: } 0.0\%)$$

### 4.2. False Repair Rate
- **False Repair Rate**: Percentage of negative control scenarios where a repair was proposed or applied:
  $$\text{FRR} = \frac{\text{Repairs Attempted on Negative Controls}}{\text{Total Negative Control Scenarios}} \times 100\% \quad (\text{Target: } 0.0\%)$$

### 4.3. Wilson Score 95% Confidence Interval
For sample size $n = 104$ with success probability $\hat{p} = \frac{k}{n}$, the Wilson score 95% confidence interval is computed using standard normal quantile $z = 1.96$:

$$w = \frac{\hat{p} + \frac{z^2}{2n} \pm z \sqrt{\frac{\hat{p}(1 - \hat{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$

This provides an asymmetric, mathematically robust interval suitable for near-100% success rates, unlike naive Wald intervals.
