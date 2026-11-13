# PIE Phase 3 — Evidence-Based Disambiguation & Positional Invariant Report

**Phase:** Phase 3  
**Module:** `LocatorDisambiguationEngine` (`src/intelligence/locator-disambiguation-engine.ts`)  
**Status:** FULLY IMPLEMENTED & VERIFIED  
**Benchmark Suite:** `PIE-AMB` (`tests/unit/locator-disambiguation.test.ts`, AMB-01 .. AMB-10, 10/10 passing)  

---

## 1. The Core Engineering Trade-Off: Safety vs Over-Restriction

When a Playwright test encounters multiple matching elements on a page (e.g. 3 identical "Add to Cart" buttons or duplicate "Delete" icons), test automation tools typically make one of two catastrophic mistakes:

1. **The Careless Healer (Unsafe):** Blindly attaches `.first()` or `.nth(0)` to whatever element matches. This causes false positives, clicks the wrong item in an e-commerce cart or table, masks functional regressions, and creates brittle tests.
2. **The Overly Restrictive Healer (Naive Abstention):** Immediately aborts and abstains whenever $>1$ element matches, even when a human SDET could trivially disambiguate the intended element using container context, visibility, or section scoping.

### The PIE Solution: Evidence-Based Disambiguation
A human Playwright engineer does not immediately surrender when multiple elements match. They investigate the DOM hierarchy and determine whether container scoping, visibility, or landmarks uniquely identify the target.

PIE follows this human engineering practice while enforcing the **Positional Invariant**:
> *"PIE may use positional locators (`.first()`, `.nth()`), but it must never invent positional intent."*

---

## 2. The 5-Stage Disambiguation Pipeline

`LocatorDisambiguationEngine` processes candidates through a rigorous 5-stage pipeline:

```mermaid
flowchart TD
    A["Multiple Element Candidates (N > 1)"] --> B{"1. Visibility Filter"}
    B -->|Exactly 1 Visible| C["Strategy: VISIBILITY_FILTER\n.filter({ visible: true })"]
    B -->|Still >1 Visible| D{"2. Container Anchoring"}
    D -->|Distinguishing Text/TestId| E["Strategy: CONTAINER_ANCHOR\nlocator('tr').filter({ hasText })"]
    D -->|No Unique Container| F{"3. Landmark Scoping"}
    F -->|Header / Dialog / Main Match| G["Strategy: LANDMARK_SECTION\nlocator('dialog').getByRole(...)"]
    F -->|No Landmark Match| H{"4. Explicit Positional Intent?"}
    H -->|Original had .first() or .nth()| I["Strategy: EXPLICIT_POSITIONAL_INTENT\nPreserve verified positional syntax"]
    H -->|Original had NO positional intent| J["Strategy: ABSTAIN_AMBIGUOUS\nSafe Abstention Enforced"]
```

### Stage 1: Visibility Filtering
Checks `aria-hidden="true"`, `hidden` attribute, and CSS display properties. If 2 elements match but one is hidden in a collapsed mobile menu while the other is visible on the desktop viewport, PIE scopes to `.filter({ visible: true })`.

### Stage 2: Container Anchoring (`filter({ hasText })`)
Traverses upwards through parent containers (`tr`, `article`, `li`, `div[data-testid="..."]`). If test intent text or step description matches distinguishing text within one container (e.g. `'User #101'` or `'Mechanical Keyboard'`), PIE generates a scoped container query:
```typescript
page.locator('tr').filter({ hasText: 'User #101' }).getByRole('button', { name: 'Edit' })
```

### Stage 3: Landmark Scoping
Checks if elements reside inside structural HTML5 landmarks (`header`, `footer`, `nav`, `main`, `dialog`). If the original test or step intent specifies "in header" or "in modal", PIE scopes to that landmark:
```typescript
page.locator('dialog').getByRole('button', { name: 'Confirm' })
```

### Stage 4: Explicit Positional Intent Preservation
If and only if the original test code or explicit test requirement contained `.first()` or `.nth(k)` (e.g. `page.getByRole('button').first()`), PIE recognizes that the author intentionally wanted positional selection and preserves it.

### Stage 5: Safe Abstention on Ambiguity
If multiple identical elements remain visible, cannot be anchored to any unique container, have no distinguishing landmarks, and the original test had no positional intent, PIE **strictly refuses to guess**. It returns `strategy: 'ABSTAIN_AMBIGUOUS'`, confidence `0.0`, and outputs an actionable diagnostic message explaining that multiple candidates were detected and positional guessing was prevented.

---

## 3. Benchmark Suite PIE-AMB Results

Tested across 10 distinct disambiguation scenarios in `tests/unit/locator-disambiguation.test.ts`:

| Scenario ID | Name & Target | Strategy Applied | Confidence | Invariant Upheld? |
|---|---|---|:---:|:---:|
| **AMB-01** | Unique Direct Match | `UNIQUE_DIRECT_MATCH` | 1.00 | **YES** |
| **AMB-02** | Visibility Filtering (Hidden mobile duplicate) | `VISIBILITY_FILTER` | 0.95 | **YES** |
| **AMB-03** | Container Anchoring (Table row by User ID text) | `CONTAINER_ANCHOR` | 0.95 | **YES** |
| **AMB-04** | Container Anchoring (Product card by title text) | `CONTAINER_ANCHOR` | 0.95 | **YES** |
| **AMB-05** | Landmark Scoping (Header search vs footer search) | `LANDMARK_SECTION` | 0.90 | **YES** |
| **AMB-06** | Landmark Scoping (Delete confirmation in Modal Dialog) | `LANDMARK_SECTION` | 0.90 | **YES** |
| **AMB-07** | Explicit Positional Intent (`.first()` preserved) | `EXPLICIT_POSITIONAL_INTENT` | 0.90 | **YES** |
| **AMB-08** | Explicit Positional Intent (`.nth(2)` preserved) | `EXPLICIT_POSITIONAL_INTENT` | 0.90 | **YES** |
| **AMB-09** | Multi-Match without distinguishing context | `ABSTAIN_AMBIGUOUS` | 0.00 | **YES (Safe Abstain)** |
| **AMB-10** | Positional Invariant Test (Refuse guessing `.first()`) | `ABSTAIN_AMBIGUOUS` | 0.00 | **YES (Refuse Guess)** |

**Summary:** 10/10 scenarios passed (100.0% accuracy). Zero positional invariant violations.
