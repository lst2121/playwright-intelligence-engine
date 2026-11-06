---
name: pie-trace-to-repair
description: Use PIE to turn a Playwright trace into a bounded repair proposal, optionally verify it in an isolated worktree, and prepare it for human approval.
---

# PIE Trace to Repair

Use this skill when a Playwright test has a trace archive and the user wants a
diagnosis or a safe locator repair.

## Required safety flow

1. Run `pw-intel init` and `pw-intel profile` when the repository is not yet
   initialized.
2. Run `pw-intel diagnose <trace.zip>` first. Include `--error-context` when
   Playwright produced an `error-context.md` artifact.
3. If PIE classifies the failure as an application, assertion, environment,
   authentication, ambiguous, or incomplete-evidence failure, report the cause
   and stop. Do not propose source mutation.
4. Supply the failing spec, Page Object, class, and member to
   `pw-intel repair <trace.zip>` in proposal-only mode.
5. Review the diff, classification, candidate identity, and audit record.
6. Add `--execute` only when isolated verification is explicitly requested.
7. Require `pw-intel approve <proposalId>` and `pw-intel promote --token <token>`
   for active workspace mutation.

## Allowlisted operations

Frame and Shadow DOM operations may be supplied as structured JSON through the
`--operation` option or the MCP `repair_trace` tool. Overlay dismissal,
prerequisites, combobox flows, and state waits remain proposal-only until their
browser-aware executors are available.

Never edit assertions, bypass worktree verification, treat a proposal as a
verified repair, or grant approval on behalf of the user.
