# PIE Testbed Repository Inventory & Execution Matrix

**Document Version:** 1.0.0  
**Audit Date:** 2026-11-13  
**Testbed Root:** `D:\Work\pie-real-repository-testbed`  
**Pristine Baseline:** `D:\Work\pie-real-repository-testbed\repositories\` (READ-ONLY)  
**Execution Workspaces:** `D:\Work\pie-real-repository-testbed\disposable-workspaces\`  

---

## 1. Testbed Overview & Hygiene Policy

To guarantee statistical integrity, reproducibility, and prevent contamination:
1. **Pristine Repositories (`repositories/`):** Kept in an immutable, clean state. Never execute tests, modify configs, or generate artifacts directly inside this folder.
2. **Disposable Workspaces (`disposable-workspaces/`):** All test execution, mutation injection, AST patching, and browser profiling must run strictly in these isolated sandboxes.
3. **External Real Brownfield Suite (`D:\Work\logistic-web\automation`):** Real-world logistics platform with 44 Playwright tests and full PIE harness.

---

## 2. Testbed Repository Audit & Inventory

| Repository Name | App Type / Stack | Playwright Config | Test Files | Dependencies / Services | Evaluation Suitability & Notes |
|:---|:---|:---|:---|:---|:---|
| **playwright-examples** | Example web workflows | `playwright.config.ts` | 4 specs | Pure Node.js / standalone | **Fully Runnable.** Ideal for pure locator and synchronization validation. |
| **documenso** | Next.js / Remix / Prisma / Postgres | `packages/app-tests/playwright.config.ts` | 189 specs | Turbo, Docker, Prisma, Inngest | **Complex Enterprise.** Monorepo with high fixture density; excellent for deep Page Object profiling. |
| **twenty** | Modern CRM / NestJS / GraphQL / React | 4 config files (`twenty-e2e-testing`) | 13 specs | Monorepo, PostgreSQL, Redis | **Modern Web Application.** Complex DOM with shadow roots, dynamic tables, and entity grids. |
| **hi.events** | Event Ticketing / Laravel / Inertia / Vue | `playwright.config.ts` | 203 specs (192 logic specs) | Docker Compose (Laravel/Postgres) | **Hybrid.** 192 logic specs run standalone; full e2e requires containerized backend. |
| **epic-stack** | Fullstack Remix / SQLite / Tailwind | `playwright.config.ts` | 9 specs | React Router v7, Mock services | **High Fidelity.** Embedded SQLite mocks allow robust local end-to-end execution. |
| **juice-shop** | OWASP Angular / Express / SQLite | Disposable harness (`juice-shop`) | 123 specs | Node.js / Angular app | **Adversarial & Dynamic.** Rich interactive security challenges; ideal for DOM mutation tests. |
| **erpnext-playwright-framework**| ERPNext / Frappe Python framework | `playwright.config.ts` | 10 specs | Multi-GB bench, Frappe stack | **Enterprise ERP.** Requires live Frappe backend or mock replay. |
| **nextjs-playwright-testing** | Next.js SSR / MySQL | `playwright.config.ts` | 2 specs | MySQL 8.0, Node SSR | **SSR Hydration.** Tests SSR hydration timing and layout shift flakiness. |
| **playwright-e2e-tests** | Booking platform / Java / REST | `playwright.config.ts` | 5 specs | Restful Booker Docker stack | **API/UI Flow.** Tests multi-step checkout and booking confirmation flows. |
| **next-realworld-playwright** | Conduit RealWorld / Next.js | `playwright.config.ts` | 1 spec | Conduit backend | **Standard Spec.** Clean implementation of standard RealWorld CRUD flows. |
| **langfuse** | LLM observability / Next.js | `playwright.config.ts` | 9 specs | Next.js, Postgres | **Data-Intensive.** Complex charts, filter dropdowns, and streaming telemetry tables. |
| **refine** / **refine-crm** | React admin framework | Disposable harness | 142 specs | Mock GraphQL / REST | **Complex Dynamic UI.** Rich data tables, sorting, pagination, and multi-tenant views. |
| **commerce** | Next.js commerce template | None (Target for greenfield gen) | 0 specs | Next.js dev server | **Greenfield Gen Target.** E-commerce product catalog, cart, and search. |
| **precedent** | Next.js starter template | None (Target for greenfield gen) | 0 specs | Next.js dev server | **Greenfield Gen Target.** Authentication, modal dialogs, and responsive layout. |
| **taxonomy** | Next.js App Router | None (Target for greenfield gen) | 0 specs | Next.js dev server | **Greenfield Gen Target.** Dashboard, post creation, and role-based permissions. |
| **todomvc** | TodoMVC Vanilla / React | Disposable harness | Multi-spec | Browser DOM | **Deterministic Baseline.** Pure DOM state machine for falsification benchmarks. |

---

## 3. Dedicated Brownfield & Disposable Test Suites

| Suite Name | Location | Specs | Purpose in PIE Validation |
|:---|:---|:---|:---|
| **logistic-web (automation)** | `D:\Work\logistic-web\automation` | 44 tests | Enterprise brownfield evaluation: 22 public tracking/booking tests + 22 admin dispatch/management tests. |
| **caltermine-todo-app** | `disposable-workspaces\caltermine-todo-app` | Greenfield targets | Autonomous test authoring validation (Tier-L1 / Tier-L2). |
| **brownfield-storefront** | `disposable-workspaces\brownfield-storefront` | Brownfield targets | Exploration, POM synthesis, and regression discovery. |
| **MUT-01 .. MUT-05** | `disposable-workspaces\MUT-*` | Mutation traces | Positive mutation drift recovery benchmark. |
| **MUT-06 .. MUT-14** | Testbed traces | Diagnostic traces | Negative control benchmark: safe abstention on bugs, timeouts, overlays, and 500 errors. |
