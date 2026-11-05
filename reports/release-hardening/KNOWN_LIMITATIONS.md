# PIE v2.6 — Truthful Disclosures of Known Limitations & Boundaries

**Release Candidate:** v2.6.0-rc1  
**Audit Principle:** Complete intellectual honesty regarding supported vs unsupported engineering patterns.

---

## 1. Supported Architecture Patterns

The Playwright Intelligence Engine v2.6 excels at diagnosing and repairing modern, standard Playwright test architectures:

1. **Page Object Model (POM):**
   - Constructor-initialized locators: `this.btn = page.getByRole(...)` or `this.btn = page.locator(...)`
   - Readonly property initializers: `readonly submitBtn = this.page.getByRole(...)`
   - Getter methods: `get searchInput() { return this.page.locator(...) }`
2. **Locator Strategies:**
   - ARIA role-based locators: `page.getByRole('button', { name: '...' })`
   - Test-ID locators: `page.getByTestId('...')`
   - Form labels: `page.getByLabel('...')`
   - Placeholders: `page.getByPlaceholder('...')`
   - Visible text: `page.getByText('...')`
   - Scoped stable CSS: `page.locator('button.btn-primary')`
3. **Failure Diagnostics:**
   - Locator drift & timeouts
   - Action-anchored in-domain HTTP 5xx errors
   - Authentication session expiration (401/403)
   - StrictMode multi-element ambiguity
   - Timing races & DOM detachment

---

## 2. Explicitly Unsupported Patterns (Fail-Closed Behaviors)

When PIE encounters the following scenarios, it deliberately **abstains from generating or applying repairs**, logging a transparent reason for human review:

### 1. Cross-Domain Iframe Piercing
- **Limitation:** Elements embedded inside cross-origin `<iframe>` elements that require explicit frame handles (`page.frameLocator()`).
- **Engine Behavior:** If a target locator times out because it exists inside an un-pierced iframe, the candidate extractor will not find it in the top-level DOM snapshot and will abstain with `INCOMPLETE_EVIDENCE` or `LOCATOR_DRIFT_UNRESOLVED`.

### 2. Canvas, WebGL, and SVG Path Internals
- **Limitation:** Graphics rendered inside `<canvas>` or WebGL contexts do not expose standard HTML DOM nodes or ARIA accessibility trees.
- **Engine Behavior:** PIE does not perform computer vision, OCR, or pixel-coordinate clicking. It refuses to construct synthetic coordinate clicks, abstaining safely.

### 3. Dynamic Computed Member Names in Page Objects
- **Limitation:** Page Objects that use dynamically computed property accessors (e.g. `this[getDynamicName()] = ...`).
- **Engine Behavior:** `AstPatcher` operates via static TypeScript AST analysis and requires concrete string or identifier member names. Dynamic property access triggers `UnsupportedAstStructureError`.

### 4. Third-Party Network Flakiness and Remote Service Outages
- **Limitation:** When a test fails because a third-party analytics script or CDN timed out, but the application backend is functional.
- **Engine Behavior:** The causal evidence correlator evaluates the temporal window $[T-5\text{s}, T+1\text{s}]$ and filters known analytics domains. If an in-domain backend endpoint failed with HTTP 500, PIE strictly abstains from locator healing.

### 5. Highly Complex Drag-and-Drop and Mouse Gestures
- **Limitation:** Multi-step mouse physics (e.g. mouse down, drag through specific bezier curves, drop on custom dropzones).
- **Engine Behavior:** PIE currently supports standard Playwright actions (`click`, `fill`, `check`, `selectOption`, `press`, `hover`). Complex custom gesture repairs require human intervention.

### 6. Bare Tag Selector Generation (Intentionally Prohibited)
- **Design Decision:** The candidate generator **strictly refuses** to produce bare tag locators like `page.locator('button')` or `page.locator('div')`. If no distinctive accessibility, test ID, label, or scoped class exists, it throws `InsufficientIdentifiersError` rather than generating a brittle repair.
