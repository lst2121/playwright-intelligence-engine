# Phase 7 Evidence — CI and MCP Integration Surface

## Implemented

- Added CI summary rendering for Markdown reports.
- Added GitHub Actions annotation rendering.
- Added SARIF 2.1.0 output for code-scanning and review integrations.
- Added `pw-intel ci-report --sarif-out <file>` and SARIF in the MCP CI result.
- Added the `get_product_status` MCP tool.
- Added the first-party `pie-trace-to-repair` agent skill for the complete
  diagnosis, proposal, isolated-verification, approval, and promotion flow.
- MCP status reports package identity, milestone, fail-closed mode, approval
  policy, LLM policy, repository inspection/baseline-runner availability, and
  currently available capabilities.
- Corrected MCP documentation to match the registered tools.

## Verified

- MCP tool-list tests pass with the new status tool.
- CI summaries and annotations are covered by automated tests.
- SARIF rule/result generation is covered by automated tests.

## Deferred

- Native GitHub PR creation.
- GitLab/Jenkins adapters.
- Hosted dashboard and notification connectors.

