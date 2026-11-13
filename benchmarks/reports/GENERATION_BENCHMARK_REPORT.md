# PIE Next-Generation Empirical Benchmark Report

- **Generated:** 2026-11-12T16:57:51.400Z
- **Environment:** Node v24.19.0 on win32
- **Tier-L2 Provider:** deepseek-chat
- **Constraint Verified:** `D:\Work\pie-real-repository-testbed\repositories\` remained unmodified; all runs executed in `disposable-workspaces\`.

## Summary Matrix
| Benchmark | Mode | Topology | Status | Used Fallback | TSC Pass | Discovery | Exec Pass | Reused Fixture | Cfgs | Mut Killed/Total | Mut Score | Duration (ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| caltermine-todo-app | pie-tier-l1-hybrid | greenfield | `VERIFIED` | true | n/a | true | true | false | 1 | 3/3 | 100% | 63077 |
| caltermine-todo-app | pie-tier-l2-llm | greenfield | `VERIFIED` | false | n/a | true | true | false | 1 | 3/3 | 100% | 54508 |
| caltermine-todo-app | human-reference | greenfield | `VERIFIED` | false | true | true | true | false | 1 | 1/1 | 100% | 11617 |
| brownfield-storefront | pie-tier-l1-hybrid | brownfield | `VERIFIED` | true | true | true | true | true | 1 | 2/2 | 100% | 80209 |
| brownfield-storefront | pie-tier-l2-llm | brownfield | `VERIFICATION_FAILED` | false | true | true | false | true | 1 | 0/0 | n/a | 54122 |
| brownfield-storefront | human-reference | brownfield | `VERIFIED` | false | true | true | true | true | 1 | 4/4 | 100% | 43807 |
| todomvc-react | pie-tier-l2-llm | brownfield | `VERIFICATION_FAILED` | false | n/a | true | false | false | 1 | 0/0 | n/a | 26650 |
| playwright-examples | brownfield-graph-and-planner | standalone | `STATIC_PROFILED` | false | n/a | true | n/a | false | 1 | 0/0 | n/a | 0 |
| playwright-e2e-tests | brownfield-graph-and-planner | monorepo | `STATIC_PROFILED` | false | n/a | true | n/a | true | 1 | 0/0 | n/a | 0 |
| commerce | external-prereq-check | unknown | `BLOCKED` | false | n/a | false | n/a | false | 0 | 0/0 | n/a | 0 |
| juice-shop | external-prereq-check | unknown | `BLOCKED` | false | n/a | false | n/a | false | 0 | 0/0 | n/a | 0 |

## Detailed Observations & Notes
- **caltermine-todo-app (pie-tier-l1-hybrid)**: Evidence-grounded deterministic fallback suite synthesized from ExplorationContextBundle.
- **caltermine-todo-app (pie-tier-l2-llm)**: Greenfield Playwright TypeScript suite for the Todo Task Management app at http://127.0.0.1:5173/todo-app/. Generates a focused TodoAppPage POM grounded in verified locators (placeholder "Add a New Task", button "Create"), a playwright.config.ts (no existing config in repo), and three spec files covering add-task, empty-submission validation, and completion/delete/persistence scenarios. Task-item and completion/delete controls are not individually evidenced, so those interactions are scoped via the evidenced list container and counter text ("Created Task", "Completed Tasks", "N of M") rather than invented selectors; completion/delete assertions are limited to counter/state verification with explicit assumptions recorded.
- **caltermine-todo-app (human-reference)**: Human-authored reference baseline with domain POM and Playwright assertions.
- **brownfield-storefront (pie-tier-l1-hybrid)**: Evidence-grounded deterministic fallback suite synthesized from ExplorationContextBundle.
- **brownfield-storefront (pie-tier-l2-llm)**: Brownfield Playwright suite for the Cart Checkout Flow. Reuses the existing tests/fixtures/index.ts (productPage, loginPage) and ProductPage POM; adds a CartPage and CheckoutPage POM plus a cart-checkout spec covering all six planned scenarios. All locators are grounded in the exploration bundle (loc-1..loc-33); the POST /api/checkout assertion is grounded in REQ-3 and the observed /api/cart + /api/products fetch pattern (net-2, net-3).
- **brownfield-storefront (human-reference)**: Human-authored reference baseline with domain POM and Playwright assertions.
- **todomvc-react (pie-tier-l2-llm)**: Brownfield Playwright suite for REQ-1 (add todo displays in list and persists on reload) against the TodoMVC React demo. Reuses the existing tests/fixtures/test.ts import and TodoAppPage POM (goto/addTodo/todoByText) rather than redefining config or fixtures. Happy-path and validation scenarios are grounded in executed evidence (act-1, act-2). The persistence scenario is grounded in act-3, which shows the item is NOT preserved across reload (clientReloadPreserved=false), so the persistence spec asserts the observed behavior and documents the gap instead of asserting a passing reload.
- **playwright-examples (brownfield-graph-and-planner)**: Discovered 2 POMs, 0 fixtures, testImport='@playwright/test', 0 helpers; live runtime excluded (external target/Docker required).
- **playwright-e2e-tests (brownfield-graph-and-planner)**: Discovered 8 POMs, 8 fixtures, testImport='fixtures/credentials.ts', 5 helpers; live runtime excluded (external target/Docker required).
- **commerce (external-prereq-check)**: BLOCKED: Next.js Shopify starter has no .env / external Shopify storefront credentials in offline workspace.
- **juice-shop (external-prereq-check)**: SKIPPED: Full OWASP Juice Shop server build not started in this benchmark run.
