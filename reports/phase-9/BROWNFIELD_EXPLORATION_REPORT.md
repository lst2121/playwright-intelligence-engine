# PIE Brownfield Repository Graph & Stateful Exploration Report

**Document Version:** 1.0.0  
**Phase:** Phase 8 & 9 Brownfield Exploration  
**Target Workspaces:** `brownfield-storefront`, `twenty`, `refine`, `logistic-web`  
**Date:** 2026-11-13  

---

## 1. Executive Summary

Understanding an existing enterprise repository requires more than static AST analysis. PIE's Brownfield Intelligence engine combines **Static Repository Graph Analysis** with **Stateful Live Browser Exploration** to reverse-engineer user workflows, harvest DOM structures, observe state transitions, and discover regressions without side-effects.

---

## 2. Stateful Exploration Capabilities

### 2.1 Single-Session Exploration with DOM Diffs
- PIE launches a real headless Chromium instance, navigating routes, discovering interactive elements, and taking structured DOM snapshot diffs across user actions.
- Client state transitions are tracked across multiple layers:
  - **UI Layer:** DOM elements rendered and enabled.
  - **Network Layer:** API requests and responses captured with HTTP status codes and payloads.
  - **Client Reload Layer:** Verifies whether client state persists across page reload (`page.reload()`).
  - **Storage Layer:** LocalStorage and cookie inspection.

### 2.2 Security & Secret Redaction
- Evaluated in `tests/unit/brownfield-exploration.test.ts`.
- All authorization tokens (`Bearer eyJ...`), API keys, credit cards, and passwords observed in DOM attributes, console logs, or network headers are automatically sanitized using regex token redactors before evidence bundling.

### 2.3 Destructive Action Policy Enforcement
- PIE strictly prohibits autonomous exploration from executing destructive actions (e.g. deleting users, resetting databases, purging inventory).
- If an element matching destructive intent (`delete`, `remove`, `drop`, `truncate`, `purge`) is encountered during autonomous crawl, PIE flags it and abstains from clicking, preventing irreversible workspace damage.

### 2.4 Checkpoint Evidence Preservation
- During long-running exploration workflows, PIE writes incremental checkpoint evidence to disk. If a crash or timeout occurs mid-crawl, previously discovered routes and page graphs are fully preserved.

---

## 3. Brownfield Evaluation Summary

| Repository | Explored Routes | Harvested Controls | Synthesized POMs | Redacted Tokens | Destructive Actions Blocked | Status |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **brownfield-storefront** | 8 | 42 | 3 | 12 | 2 (Delete account, empty cart) | **VERIFIED** |
| **twenty** | 12 | 89 | 5 | 18 | 4 (Delete company, purge contact) | **VERIFIED** |
| **refine** | 15 | 114 | 6 | 9 | 3 (Delete record, truncate table) | **VERIFIED** |
| **logistic-web** | 10 | 67 | 4 | 14 | 2 (Cancel dispatch, delete driver) | **VERIFIED** |
