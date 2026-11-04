# Product Roadmap: Playwright Intelligence Engine (v2.2)

**Project:** Enterprise Playwright Reliability & Test Intelligence Platform  
**Target Market:** Engineering teams running mission-critical TypeScript Playwright suites (Healthcare, FinTech, Regulated SaaS)  
**Core Motto:** "Verification-First: Diagnosing root causes and proving intent preservation before modifying code."

---

## 1. 30-Day Tactical Validation Roadmap

```
Week 1 (Days 1–5)       Week 2 (Days 6–12)      Week 3 (Days 13–19)     Week 4 (Days 20–30)
Diagnostic Foundation   Candidate Extraction    Worktree Verification   4-Part Benchmark &
& Trace Ingestion       & Failure Classifier    & Intent Invariant      Design Partner Demos
```

### Sprint 1: Days 1–5 — Deterministic Failure Diagnostic Foundation
* **Goal**: Build an engine that reads real Playwright traces and generates a grounded failure diagnostic report **without modifying any code**.
* **Day 1**: Project bootstrap, `package.json` (ESM, strict Node20+), core types (`DiagnosticContext`), safe zip unpacker with path-traversal protection.
* **Day 2**: Version-aware trace reader: parse `.trace` and `.network` JSONL streams, correlate call IDs with source locations.
* **Day 3**: Snapshot resolver: reconstruct the failing DOM view from compact delta snapshot records.
* **Day 4**: Failure Classifier: correlate network events and errors to distinguish `LOCATOR_DRIFT` from `AUTH_EXPIRED`, `TIMING_RACE`, and `BACKEND_500`.
* **Day 5**: Diagnostic Report Generator: terminal output displaying failed action, original locator, candidate elements, evidence summary, and abstention reasons.
* **Exit Gate**: Feeds a real Playwright failure trace and outputs a 100% accurate diagnosis with evidence provenance.

---

### Sprint 2: Days 6–12 — Scorer, Candidate Extraction & Negative Controls
* **Goal**: Extract candidate replacement selectors and prove the engine knows when to **ABSTAIN**.
* **Deliverables**:
  - `candidate-extractor.ts`: Identifies candidate interactive elements matching user action semantics.
  - `selector-scorer.ts`: Multi-factor ranking $S(L) = w_1 U + w_2 I + w_3 M + w_4 A + w_5 H - w_6 D$.
  - `abstention-policy.ts`: Explicit rejection when candidates are ambiguous or confidence is $<0.75$.
  - **Negative Controls Suite**: Ingests 401 auth failures, 500 backend errors, and missing test data failures; **must output ABSTAIN with zero attempted locator changes**.
* **Exit Gate**: 100% appropriate abstention on non-locator failures.

---

### Sprint 3: Days 13–19 — Isolated Git Worktree & Constrained AST Patcher
* **Goal**: Safely test repairs in background worktrees without touching the active developer branch.
* **Deliverables**:
  - `worktree-manager.ts`: Manages detached worktrees at `.pw-intelligence/worktrees/repair-xxx` with automatic stale worktree cleanup.
  - `ast-patcher.ts`: Constrained `ts-morph` modifier supporting Constructor, Property Initializer, and Getter Page Object patterns.
  - `intent-validator.ts`: Verifies assertion AST SHA-256 fingerprint remains untouched and checks target entity match.
* **Exit Gate**: One real flaky Playwright test repaired end-to-end in an isolated worktree and verified green.

---

### Sprint 4: Days 20–30 — 4-Part Benchmark & Customer Discovery
* **Goal**: Execute the complete adversarial benchmark and demo to enterprise SDET leads.
* **The 4 Experiments**:
  - **Experiment A (Baseline)**: 30-run baseline (expanding to 100 runs) with retries disabled to measure true flakiness.
  - **Experiment B (Mutation Recovery)**: 5 structural classes (Accessible name, test-id removed, CSS change, duplicate controls, table re-renders).
  - **Experiment C (Defect Resistance)**: 3 seeded business bugs; **repaired test must fail on all 3 bugs** (zero masked regressions).
  - **Experiment D (Negative Controls)**: Authentication, backend 500, and data errors trigger strict abstention.
* **Customer Interviews**: 10 structured interviews with enterprise QA/SDET leads demonstrating the diagnostic and worktree verification engine.
* **Exit Gate**: At least 2 leads agree to evaluate a 6-week team pilot.

---

## 2. Long-Term Evolution (Post-POC)

* **Phase 2 (Months 2–3): Enterprise Framework Adapters**: Expand AST coverage to custom fixtures and multi-project configs.
* **Phase 3 (Months 3–5): Institutional Memory & Verified Generation**: Local SQLite stability ledger + curated `.playwright-rules.yaml` + verified Day-1 test generation.
* **Phase 4 (Months 5–7): IDE & CI Integration**: Model Context Protocol (`@playwright-intelligence/mcp-server`) for Cursor/Claude + GitHub Action bot.
* **Phase 5 (Months 7–10): Enterprise Hardening**: Client-side PII redaction, private Azure OpenAI endpoints, and multi-team rollouts.
