# Phase 1B Evidence — Project-Aware Ranking and Adaptive Memory

## Implemented

- Added project-scoped stability-ledger metadata and migration from older ledger records.
- Added `ProjectIntelligenceSnapshot` loading from `.pie/repository-profile.json` and
  `.pw-intelligence/stability-ledger.json`.
- Added `RepairCandidateRanker` as the production ranking path for proposed locators.
- Repository locator counts now provide a bounded distribution-based convention
  signal, rather than only a single preferred-locator flag.
- Connected historical selector reliability to candidate scoring.
- Connected repository preferred-locator conventions to candidate scoring.
- Connected CLI and MCP trace diagnosis to project intelligence.
- Records only actionable locator/timing failures in selector memory.
- Does not penalize selectors for backend, authentication, assertion, or environment failures.
- Preserves fail-closed abstention gates after project-aware ranking.

## Verification

- Typecheck passed.
- Focused intelligence, memory, MCP, and diagnostic tests passed: 22 tests.
- Production build passed.
- Full-suite verification is required before release promotion.

The latest full-suite checkpoint passed 473 tests across 43 test files.

## Safety boundary

Project memory influences ranking only. It cannot authorize a repair, bypass
uniqueness checks, weaken assertions, or promote source changes. Worktree
execution and approval gates remain authoritative.

## Deferred work

- Browser- and environment-specific reliability models.
- Human acceptance/rejection feedback ingestion beyond accepted promotions.
- Time decay and confidence calibration.
- Cross-repository failure memory and richer domain oracle integration.

## Next phase started

The deterministic failure fingerprint and clustering engine is now available
through the `cluster-failures` CLI command and the public `clusterFailures` API.
It groups observations by normalized category, action, error signature, and
network status while preserving affected repositories and test identities.
