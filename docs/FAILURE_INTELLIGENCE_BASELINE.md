# Failure Intelligence Baseline

## Implemented

- Deterministic failure fingerprints using normalized category, action, error
  signature, and network status.
- Failure clustering across tests and repositories.
- Cluster severity classification.
- Affected repository and test preservation.
- Evidence-consistency scoring.
- Suite stability summaries.
- Flaky-test detection from pass/fail history.
- Average and p95 duration summaries.
- Failure-cluster association per test.
- Impacted-test selection from changed files, declared dependencies, directories,
  and tags.

## CLI

```text
pw-intel cluster-failures observations.json --out failure-clusters.json
pw-intel suite-health run-history.json --out suite-health.json
```

## Safety and interpretation

These are deterministic intelligence features. A cluster is a grouping signal,
not proof that every test shares the same application defect. Environment,
backend, assertion, and locator categories remain visible and are not silently
merged.

Impacted-test selection is conservative and reports the reason and confidence
class (`direct`, `dependency`, `directory`, or `tag`) for every selected test.

## Verification

- Typecheck passed.
- Full regression suite passed: 473 tests across 43 test files.
- Production build passed.

## Next work

- Add code ownership and dynamic runtime dependency extraction.
- Add historical trend storage beyond the current project ledger.
- Add hosted pull-request and notification connectors beyond local annotations
  and SARIF output.
