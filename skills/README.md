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
