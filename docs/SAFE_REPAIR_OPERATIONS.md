# Safe Repair Operations

PIE now distinguishes operation validation from execution readiness.

`compileSafeRepairOperation` is immutable and produces no disk changes. It
supports validated locator proposals for:

- `replace_locator`
- `add_frame_scope`
- `add_shadow_scope` for open shadow DOM paths

These proposals still require isolated worktree execution, assertion and intent
verification, regression checks, and human approval.

The following operations remain `PROPOSAL_ONLY` until dedicated browser-aware
executors exist:

- `dismiss_overlay`
- `satisfy_prerequisite`
- `replace_select_with_combobox_flow`
- `replace_unstable_wait_with_state_wait`

Unsupported expressions or dynamic code receive `ABSTAIN`; no fallback source
mutation is attempted.
