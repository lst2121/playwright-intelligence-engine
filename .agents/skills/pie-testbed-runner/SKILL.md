---
name: pie-testbed-runner
description: >-
  Inspects, initializes, and executes Playwright tests across the 8 real-world
  testbed repositories in D:\Work\pie-real-repository-testbed\repositories.
  Use when validating engine healing, diagnosing cold starts, or checking multi-stack health.
---

# PIE Testbed Runner Skill

Automates inspecting and running Playwright test suites across the 8 empirical testbed repositories.

## Testbed Repositories Map

| Repository | Tech Stack | Root Directory | Key Considerations |
| :--- | :--- | :--- | :--- |
| **saucedemo-playwright-typescript** | React SPA + POM | `D:\Work\pie-real-repository-testbed\repositories\saucedemo-playwright-typescript` | Single-page app with strict-mode multi-element targets (`.btn_inventory`). |
| **heroku-playwright-project** | jQuery + Select2 | `D:\Work\pie-real-repository-testbed\repositories\heroku-playwright-project` | Custom non-standard Select2 dropdown widgets. Run with `--reporter=list`. |
| **playwright-e2e-tests** | Docker Backend | `D:\Work\pie-real-repository-testbed\repositories\playwright-e2e-tests` | Uses Restful Booker backend container on port 3000. |
| **epic-stack** | Remix + SQLite | `D:\Work\pie-real-repository-testbed\repositories\epic-stack` | Cold-start Vite SSR compilation on port 3100. Uses local SQLite DB. |
| **twenty** | Enterprise CRM | `D:\Work\pie-real-repository-testbed\repositories\twenty` | High-volume single-page app (1,000+ network events per trace). |
| **next-realworld-playwright** | Next.js Conduit | `D:\Work\pie-real-repository-testbed\repositories\next-realworld-playwright` | Full-stack Next.js testbed. |
| **todomvc** | DOM Benchmark | `D:\Work\pie-real-repository-testbed\repositories\todomvc` | Pure DOM benchmark for locator generation. |
| **juice-shop** | Angular / Express | `D:\Work\pie-real-repository-testbed\repositories\juice-shop` | Security testbed. |

## Execution Workflow

1. **Verify Backend Dependencies:**
   - For `playwright-e2e-tests`, verify Docker container is running:
     ```powershell
     docker ps
     ```
   - For `epic-stack`, ensure `PORT=3100` and `DATABASE_URL` are configured to prevent port collision with Restful Booker.

2. **Run Suite Non-Interactively:**
   Always run with `--reporter=list` and `PW_TEST_HTML_REPORT_OPEN=never` to prevent hung interactive HTML reporter servers:
   ```powershell
   npx playwright test --reporter=list
   ```

3. **Diagnose and Repair with PIE:**
   When traces fail in `test-results/`:
   ```powershell
   pw-intel repair test-results/trace.zip --apply --verbose
   ```

4. **Fleet-Wide Automated Runner Script:**
   Execute full-fleet verification, mutation injection, autonomous repair, and metric calculation across all repositories:
   ```powershell
   node .agents/skills/pie-testbed-runner/scripts/run-fleet-testbed.mjs
   ```
