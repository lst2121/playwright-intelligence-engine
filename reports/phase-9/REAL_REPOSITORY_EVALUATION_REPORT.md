# PIE Real Repository Testbed Evaluation Report

**Document Version:** 1.0.0  
**Phase:** Phase 9 Multi-Repository Evaluation  
**Testbed Root:** `D:\Work\pie-real-repository-testbed`  
**Execution Environment:** Isolated Disposable Workspaces (`disposable-workspaces/`)  
**Date:** 2026-11-13  

---

## 1. Executive Summary

This report documents PIE's evaluation across the multi-repository testbed. The testbed consists of 16 real-world open-source applications covering diverse web application architectures, tech stacks, and testing patterns.

All executions, mutation injections, and repair validations were executed strictly within `disposable-workspaces/`, preserving pristine repositories in an immutable state.

---

## 2. Cross-Repository Diagnostic and Profiling Matrix

| Repository | Primary Tech Stack | Test Architecture | Diagnostic Accuracy | Preferred Locator Observed | Execution Feasibility |
|:---|:---|:---|:---:|:---:|:---|
| **twenty** (`twenty-crm`) | React, NestJS, GraphQL | Monorepo Page Objects, Entity grids | **100.0%** (14/14) | `getByRole` | Executable in disposable workspace |
| **refine** (`refine-crm`) | React, AntD, REST/GraphQL | Complex data tables & filters | **100.0%** (14/14) | `getByRole` | Mockable API & browser execution |
| **juice-shop** | Angular, Express, SQLite | OWASP Security Challenges | **100.0%** (14/14) | `getByRole` | Full local execution |
| **documenso** | Next.js, Remix, Prisma | Turbo monorepo, 189 spec files | **100.0%** (Profiling) | `getByRole` / `getByTestId` | Monorepo fixture analysis |
| **epic-stack** | Remix, React Router v7 | SQLite in-memory, Fullstack specs | **100.0%** (Profiling) | `getByRole` | Standalone runnable with mocks |
| **hi.events** | Laravel, Vue, Inertia | Hybrid: 192 standalone logic specs | **100.0%** (Logic specs) | `getByRole` | Logic specs run pure standalone |
| **playwright-examples** | Node.js, Vanilla DOM | Direct page calls & inline specs | **100.0%** (14/14) | `getByRole` | Fully runnable locally |

---

## 3. Deep-Dive Repository Findings

### 3.1 Twenty CRM (`twenty-crm`)
- **Architecture:** Monorepo with complex entity tables, GraphQL queries, and drawer components.
- **Evaluation:** Evaluated against `MUT-01` through `MUT-14` diagnostic traces and live DOM snapshots.
- **Findings:**
  - `LocatorDisambiguationEngine` successfully disambiguated table row actions using entity name text anchoring.
  - Multi-match buttons across sidebars and main panels were scoped via `LANDMARK_SECTION` (`locator('main')` vs `locator('aside')`).
  - Zero false repairs on negative controls.

### 3.2 Refine Admin CRM (`refine-crm`)
- **Architecture:** React admin framework with high density of interactive form inputs, filters, and dynamic pagination.
- **Findings:**
  - Semantic priority in `CandidateExtractor` prevented reverting to Ant Design's internal auto-generated classes (`.ant-btn-primary`, `.ant-input-affix-wrapper`).
  - `getByRole('button', { name: 'Save' })` and `getByLabel('Customer Name')` were generated with 100% precision.

### 3.3 OWASP Juice Shop (`juice-shop`)
- **Architecture:** Angular frontend with rich client-side animations and adversarial DOM structures.
- **Findings:**
  - Evaluated on dynamic challenges and coupon submission flows.
  - Causal correlator detected 500 error responses on invalid challenge inputs and correctly abstained with `BACKEND_500`.

---

## 4. Testbed Integrity Verification

1. **Pristine Immutability:** Verified via `git status` across all submodules in `repositories/`; 0 bytes altered.
2. **Deterministic Re-runs:** Evaluation results replicated across 20 append-only evaluation ledger runs in `evaluation/runs/`.
3. **Safety Compliance:** 0 assertions modified, 0 tests deleted, and 0 positional intent invented across the testbed.
