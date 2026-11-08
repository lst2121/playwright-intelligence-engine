# PIE v3.2 — Verification Baseline

Produced by `npm run verify:all` (not written by hand). Re-run to reproduce.

```
PIE verification — 10 check(s) [fast; use --full for suite + repair]
--------------------------------------------------------------------------------
 OK   typecheck            2313 ms  tsc: 0 errors across 3 configs
 OK   build                2045 ms  tsup + declarations: exit 0
 OK   determinism          1408 ms  exit 0, 3/3 assertions matched (1407 ms)
 OK   abstain-ambiguous     842 ms  exit 0, 2/2 assertions matched (841 ms)
 OK   abstain-disabled      971 ms  exit 0, 2/2 assertions matched (971 ms)
FAIL  naming                704 ms  FAIL linter accepted generic identifiers (0 violations)
FAIL  grounding             724 ms  FAIL navigate-only status=READY (expected NEEDS_INPUT); emitted 1 symbol: actionButton
 OK   cli-latency          4228 ms  cli.diagnose P50 854 ms / max 970 ms (target max <= 2000 ms)
 OK   ledger                  0 ms  5 append-only evaluation run(s)
 OK   profiler              829 ms  tags clean, baseUrl extracted
--------------------------------------------------------------------------------
TOTAL 10 | PASS 8 | FAIL 2 | UNVERIFIED 0
VERDICT: NOT READY
```

## Correction notice

An earlier revision of this file reported `typecheck` failing with 19 errors,
`empty-denominator.test.ts` failing 3 of 5, and `: 100.0` fallbacks in
`master-benchmark-runner.ts`. Those measurements were taken against a working
tree that had been **reverted by an external process** (`cline checkpoint`
entries in the reflog): `formatRate`, `formatCI`, the nullable rate types, the
count fields and the append-only history writer had been deleted from the
working tree while remaining present in HEAD.

Restoring the file with `git checkout -- benchmarks/runner/master-benchmark-runner.ts`
returns `npm run typecheck` to 0 errors. The earlier findings were artefacts of
tree corruption, not defects in committed code, and are retracted.

## Confirmed working on this tree

| Check | Evidence |
|---|---|
| Typecheck | tsc --noEmit across 3 configs: 0 errors |
| Build | tsup + declaration emit: exit 0 |
| Deterministic diagnosis | MUT-01 to LOCATOR_DRIFT, repair getByRole button Login |
| Ambiguity abstention | MUT-06 to AMBIGUOUS_MATCH to ABSTAIN FROM CODE REPAIR |
| Disabled-control abstention | MUT-08 to DISABLED_ELEMENT to ABSTAIN FROM CODE REPAIR |
| CLI latency | cli.diagnose P50 854 ms, max 970 ms over 5 samples (target max 2000 ms) |
| Test suite | npm test: 55 files / 552 tests passed after pinning pool vmForks |
| Append-only ledger | 5 evaluation runs present |
| Profiler hygiene | no Objective-C/CSS tags; baseUrl extracted from playwright config |

## Remaining defects (verified, reproducible)

1. **Naming linter is not falsifiable for real generator output.**
   It accepts `actionButton` / `performActionButton` with `violations: []` and
   `namingConformanceRate: 1`. Root cause is upstream: a `navigate` step is
   assigned `role = 'button'` and then named from that role.

2. **Generator is not grounded.**
   A `navigate`-only plan returns `status: READY` and emits a synthetic
   `actionButton` symbol, plus a fabricated
   `assert-visible heading { name: featureName }` assertion.

Both are addressed by WP3 (generator grounding) in the v3.2 plan.
