# Phase 3 Evidence — Diagnostic Decision Contract

## Implemented

- Added `DiagnosticDecisionSchema` and `createDiagnosticDecision()`.
- Standardized recommendations into repair candidate, gather evidence, report application/environment failure, or abstain.
- Added explicit missing-evidence reporting.
- Preserved failed-action and trace-version provenance in every decision.
- Every correlated diagnosis now emits a deterministic failure observation and
  normalized fingerprint shared with clustering, CI, and dashboard layers.

## Verified

- TypeScript typecheck passes.
- Diagnostic decision tests cover fail-closed behavior when DOM, network, and source evidence are unavailable.

## Deferred

- Accuracy validation against the external repository corpus.
- Full flakiness detection and application-oracle integration.

