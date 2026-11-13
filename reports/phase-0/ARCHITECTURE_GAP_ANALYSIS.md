# PIE Architecture Gap Analysis & Engineering Roadmap

**Document Version:** 1.0.0  
**Phase:** Phase 0 Baseline  
**Author:** PIE Principal Architecture & Systems Team  
**Date:** 2026-11-13  

---

## Executive Summary

PIE (Playwright Intelligence Engine) has established strong core capabilities in trace diagnosis, Page Object class locator healing, and safety-aware abstention. Across 125 benchmark scenarios, PIE achieved 100% precision and 100% safe abstention on negative controls.

However, detailed experimentation (Experiments A, B, and C) and testbed exploration have identified five critical architectural gaps that must be resolved to achieve production readiness across real-world, enterprise Playwright codebases.

---

## 1. Architectural Gap: Statement-Level AST Patching (`StatementPatcher`)

### The Problem & Experiment B Finding
- **Current State:** `src/repair/ast-patcher.ts` operates exclusively on **Page Object class declarations**. It locates property declarations (`readonly submitButton = ...`) and replaces their initializer expressions.
- **The Gap:** Modern Playwright tests frequently contain inline locators and complex action sequences directly within `test('...', async ({ page }) => { ... })` blocks. 
- **Flakiness & Synchronization:** Eliminating timing flakiness requires transforming statement sequences:
  1. Replacing arbitrary sleep calls (`await page.waitForTimeout(5000)`) with event-driven synchronization (`await expect(locator).toBeVisible({ timeout: 5000 })`).
  2. Wrapping action-response pairs in `await Promise.all([page.waitForResponse(...), page.click(...)])`.
  3. Pre-flight action readiness checks (`await expect(btn).toBeEnabled()`).
- **Impact:** While PIE's diagnostic engine accurately flags `HYDRATION_OR_TIMING`, the repair engine cannot apply statement-level rewrites inside test functions, leaving synchronization repairs manual.

### Required Architecture: `StatementPatcher`
- Implement `src/repair/statement-patcher.ts` using `ts-morph`.
- Support:
  - Statement replacement, removal, and insertion.
  - Multi-statement wrapping (e.g. `Promise.all` enclosing an action and response listener).
  - Variable declaration extraction and locator variable references.
  - AST preservation of surrounding comments, formatting, and imports.

---

## 2. Architectural Gap: Multi-Match Disambiguation vs Blind Abstention

### The Problem
- **Current State:** When a locator candidate matches multiple DOM elements (`count > 1`), PIE immediately marks it as `AMBIGUOUS_MATCH` and refuses to patch the test.
- **The Gap:** In enterprise applications (e.g. Amazon, e-commerce, CRM tables), multiple identical controls (e.g. multiple "Add to Cart" or "Edit" buttons) are normal. Blindly abstaining on every multi-match makes PIE overly restrictive.
- **The Danger:** Simply slapping `.first()` or `.nth(0)` on ambiguous locators is brittle and dangerous—it masks broken tests and invents intent that the developer never specified.

### The Positional Invariant
> **"PIE may use positional locators (`.first()`, `.nth()`), but it must never invent positional intent."**

### Required Architecture: `LocatorDisambiguationEngine`
Implement an evidence-based disambiguation pipeline with strict hierarchy:
1. **Visibility Filtering:** Filter out off-screen, hidden, or mobile drawer duplicates (`filter({ visible: true })`).
2. **Container Anchoring:** Scope the locator to an enclosing row, card, or panel identified by unique text (`locator('tr').filter({ hasText: '...' }).getByRole(...)`).
3. **Landmark / Section Scoping:** Scope to semantic landmarks (`main`, `nav`, `dialog`).
4. **Explicit Positional Intent:** Only use `.first()` or `.nth(i)` if the original test or business requirement explicitly expressed positional semantics (e.g. "first item in search results", "second row").
5. **Safe Abstention:** If none of the above establish unique intent, abstain and emit `AMBIGUOUS_MATCH` or `NEEDS_INPUT`.

---

## 3. Architectural Gap: Semantic Fallback Degradation (The `#id` Trap)

### The Problem & Experiment A Finding
- In Experiment A-02, when `getByLabel('User Login ID')` broke because the label text changed to `Email Address`, PIE recovered by generating `page.locator('#username')`.
- While `#username` passed the test, reverting from a user-facing accessibility locator to a technical DOM ID is bad practice. If the ID changes or is auto-generated, the test breaks again.
- **Root Cause:** `CandidateExtractor` and `SelectorScorer` awarded a high baseline score (0.80) to `#id`, allowing it to beat semantic candidates that had lower lexical overlap with the old name.

### Required Architecture: Semantic Priority Engine
- Re-weight `SelectorScorer`:
  - `getByRole` with accessible name: Tier 1 (highest priority).
  - `getByLabel` / `getByPlaceholder`: Tier 2.
  - `getByTestId`: Tier 3 (stable technical hook).
  - `#id`: Tier 4 (only if semantic locators are unavailable and ID is verified non-volatile).
  - Volatility Detection: detect and penalize hash-like IDs (`#btn_78a8f1`) and CSS-in-JS classes (`.sc-bczRLJ`).

---

## 4. Architectural Gap: Causal Root Cause vs Runtime Symptom Separation

### The Problem
- A Playwright error trace typically terminates with `TimeoutError: locator.click: Timeout 30000ms exceeded`.
- This is a **runtime symptom**, not a root cause. The root cause might be:
  - Network request taking 35 seconds.
  - Button disabled pending form validation.
  - Button covered by an invisible modal overlay.
  - Element selector changed in DOM.
  - Backend 500 error preventing state transition.
- **Current State:** Failure classifier classifies some traces directly to symptom buckets.

### Required Architecture: Two-Layer Diagnostic Model
- Structure all failure reports with:
  - `runtimeSymptom`: The Playwright failure mode (`TIMEOUT`, `ELEMENT_NOT_FOUND`, `ASSERTION_FAILED`, etc.).
  - `causalRootCause`: The underlying causal failure deduced from correlating DOM mutations, network requests, console errors, and timing events (`DYNAMIC_CONTENT_SLOW`, `NETWORK_SYNCHRONIZATION_FAILURE`, `OBSTRUCTED_ELEMENT`, `BACKEND_500`, `LOCATOR_DRIFT`, `BUSINESS_LOGIC_DEFECT`).

---

## 5. Architectural Gap: Statistical Flakiness Verification (Wilson Confidence Intervals)

### The Problem
- Running a repaired test once (or even 3 times) cannot prove that flakiness has been eliminated.
- Single successful runs provide a false sense of security.

### Required Architecture: Multi-Trial Statistical Verification
- Extend `ExecutionRunner` to support repeated execution matrices:
  - Screening trials: 5 iterations.
  - Deep validation trials: 20-30 iterations under simulated network latency, hydration delay, and CPU throttling.
  - Compute Wilson score 95% confidence intervals on pass rates before declaring any flakiness repair verified.

---

## Summary of Planned Engineering Phases

| Phase | Core Deliverable | Key Files |
|-------|------------------|-----------|
| **Phase 0** | Baseline Audit, Testbed Inventory, Gap Analysis | `reports/phase-0/*` |
| **Phase 1** | Statement-Level AST Patching (`StatementPatcher`) | `src/repair/statement-patcher.ts` |
| **Phase 2 & 3** | Semantic Resilience & Multi-Match Disambiguation | `src/intelligence/locator-disambiguation-engine.ts`, `src/selector/*` |
| **Phase 4 & 5** | Intent Invariant Preservation & Causal Root Cause | `src/repair/intent-validator.ts`, `src/diagnostics/failure-classifier.ts` |
| **Phase 6 & 7** | Statistical Verification & Flakiness Benchmark Suite | `src/sandbox/execution-runner.ts`, `benchmarks/flakiness/*` |
| **Phase 8 - 11** | Testbed Evaluation & Comprehensive Benchmark Program | Full testbed runs, `reports/phase-9/*` |
| **Phase 12** | Master Engineering Report & Release Hardening | `reports/PIE_MASTER_ENGINEERING_REPORT.md` |
