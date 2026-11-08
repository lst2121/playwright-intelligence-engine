# PIE v3.2 — Verification Baseline

Produced by `npm run verify:all` (not written by hand). Re-run to reproduce.

```
PIE verification — 10 check(s) [fast; use --full for suite + repair]
--------------------------------------------------------------------------------
FAIL  typecheck            1766 ms  exit 1
 OK   build                1901 ms  tsup + declarations: exit 0
 OK   determinism           983 ms  exit 0, 3/3 assertions matched (982 ms)
 OK   abstain-ambiguous     831 ms  exit 0, 2/2 assertions matched (830 ms)
 OK   abstain-disabled      812 ms  exit 0, 2/2 assertions matched (811 ms)
FAIL  naming                671 ms  FAIL linter accepted generic identifiers 'actionButton' / 'performActionButton' (0 violations)
FAIL  grounding             696 ms  FAIL navigate-only status=READY (expected NEEDS_INPUT); navigate-only emitted 1 symbol(s): actionButton
 OK   cli-latency          3821 ms  cli.diagnose P50 743 ms / max 856 ms (target max <= 2000 ms)
 OK   ledger                  0 ms  5 append-only evaluation run(s)
 OK   profiler              791 ms  tags clean, baseUrl extracted
--------------------------------------------------------------------------------
TOTAL 10 | PASS 7 | FAIL 3 | UNVERIFIED 0
VERDICT: NOT READY
```

## Confirmed working on this tree

| Check | Evidence |
|---|---|
| Deterministic diagnosis | MUT-01 -> LOCATOR_DRIFT + `getByRole('button', { name: 'Login' })` + repair candidate |
| Ambiguity abstention | MUT-06 -> AMBIGUOUS_MATCH -> ABSTAIN FROM CODE REPAIR |
| Disabled-control abstention | MUT-08 -> DISABLED_ELEMENT -> ABSTAIN FROM CODE REPAIR |
| CLI latency | `cli.diagnose` P50 743 ms, max 856 ms (5 samples, target <= 2000 ms) |
| Profiler hygiene | no Objective-C/CSS tags; baseUrl extracted from playwright config |
| Build | tsup + declaration emit exit 0 |

## Open defects (verified, not inferred)

1. **`npm run typecheck` exits 1** — 19 errors, all in
   `tests/unit/empty-denominator.test.ts`:
   - `formatRate` and `formatCI` are imported but do not exist in
     `benchmarks/runner/master-benchmark-runner.ts` (zero definitions in src)
   - `MasterBenchmarkReport` rate fields are typed `number`, so `null`
     assignments fail
   - `totalAttemptedRepairsCount` / `tier2RepairExpectedCount` are not
     declared on the interface

2. **`empty-denominator.test.ts` fails 3/5 when run alone**
   (`TypeError: formatRate is not a function`) yet the full suite reports
   `✓ (5 tests)` and `552 passed (552)`, 0 failed. **The suite's green is not
   reproducible per-file — treat the aggregate as unreliable until fixed.**

3. **Empty denominators are NOT fixed in source.**
   `master-benchmark-runner.ts:1061-1078` still computes
   `totalAttemptedRepairs > 0 ? ... : 100.0` and
   `tier3.length > 0 ? ... : 100.0`. The `N/A (0 samples)` observed from the CLI
   came from a different build than the source on disk.

4. **Naming linter is not falsifiable for real generator output** — accepts
   `actionButton` / `performActionButton` with `violations: []`.

5. **Generator is not grounded** — a `navigate`-only plan returns
   `status: READY` and emits a synthetic `actionButton` symbol.
