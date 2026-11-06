---
name: pie-failure-investigation
description: Investigate Playwright failures through PIE evidence, causal classification, failure clustering, and safe abstention.
---

# PIE Failure Investigation

Use `diagnose_trace` for individual traces and `cluster_failures` for multiple
observations. Preserve the original trace, repository, commit, test title, and
source location in every finding.

Do not propose locator changes for backend, authentication, assertion,
environment, incomplete-evidence, or unsupported-trace failures.

When evidence is incomplete, explain what is missing and request a rerun or
additional artifact instead of guessing.
