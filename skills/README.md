# PIE Agent Skill Pack

This directory contains first-party skills for agents that use PIE through the
CLI or MCP server.

- `pie-quality-engineer`: end-to-end quality workflow.
- `pie-failure-investigation`: evidence-first diagnosis.
- `pie-repair-review`: safe repair review and approval readiness.
- `pie-trace-to-repair`: trace diagnosis through bounded repair proposal and
  isolated verification.
- `pie-release-readiness`: suite health and release reporting.

The skills orchestrate PIE. They do not replace PIE's deterministic safety
gates, worktree isolation, verification, or human approval model.

## Architectural Rule: Workflow vs Conventions vs Truth

- **Skills carry workflow** (sequencing, diagnostic reasoning, human review narrative).
- **Conventions live in `.pie/conventions.json`** (discovered runtime facts: locator strategies, directory layout, identifier conventions, sibling exemplars).
- **Truth is enforced by a validator** (AST invariant proofs, typechecking, execution proofs). Anything that must be true is enforced by a validator, never by a prompt.
