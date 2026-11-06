# Phase 5 Evidence — Allowlisted Workflow Operations

## Implemented

- Added a typed operation grammar for:
  - locator replacement;
  - frame scope;
  - Shadow DOM scope;
  - overlay dismissal;
  - prerequisite actions;
  - select-to-combobox flows;
  - state-based wait replacement;
  - abstention.
- Added required-field validation for every operation.
- Added a source-mutation classifier so abstention cannot contain mutation operations.
- Added a workflow-plan compiler that rejects unsafe locator expressions and
  produces an executable intermediate plan without generating arbitrary code.
- Added the trace-to-repair workflow bridge in `src/repair/repair-workflow.ts`.
- Validated `replace_locator`, `add_frame_scope`, and `add_shadow_scope`
  operations can flow through the compiler into the AST proposal path.
- Added `executeBrowserOperation`, which verifies typed locator, frame, and
  Shadow DOM operations against a live Page/Frame and requires explicit
  interaction permission for overlay dismissal.
- Added a constrained combobox executor supporting only typed target-state,
  open, and visible `option:<label>` steps; arbitrary evaluation or selector
  strings remain rejected.
- Added `pw-intel repair` and MCP `repair_trace` entry points.
- Proposal-only mode stages a reviewable diff without touching the active
  workspace.
- Optional execution creates an isolated worktree, runs the target test, records
  execution proof, and still requires explicit approval before promotion.
- External `error-context.md` can supplement traces that do not contain a usable
  failed action.
- When the failed selector maps uniquely to a Page Object locator, the workflow
  can discover the spec, Page Object file, class, and member automatically.
  Ambiguous or missing source matches remain `INPUT_REQUIRED`.

## Verified

- Invalid frame operations are rejected.
- Valid frame operations are accepted.
- Structured LLM proposals are checked against the same operation grammar.
- MCP trace-to-repair integration stages a valid proposal and preserves the
  original Page Object byte-for-byte.
- Full verification: `npm run typecheck`, 43 test files / 473 tests, and
  `npm run build` pass.

## Deferred

- AST/browser executors for every workflow operation.
- Browser proof for iframe, Shadow DOM, and constrained combobox flows is now
  available through the runtime executor; wizard/prerequisite repairs remain
  deferred.
- Real-repository mutation results.
- Provider-backed model selection inside the workflow; the provider-neutral
  proposal agent remains opt-in and cannot bypass deterministic gates.
- Browser-dependent prerequisite operations remain explicitly proposal-only.
  Overlay dismissal and combobox interaction require explicit interaction
  permission, and state-wait operations execute only a constrained vocabulary
  (`load_state:domcontentloaded`, `load_state:load`, `load_state:networkidle`,
  `target_visible`, and `target_enabled`) against typed plans.

