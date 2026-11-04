# Test Coverage Matrix (329 Automated Tests)

This document provides the exhaustive inventory of all 329 automated test cases implemented and verified in the **Playwright Intelligence Engine** test suite (`npm test`).

**Summary:** 18 Test Suites | 329 Tests Executed | 329 Passed | 0 Failed (100% Pass Rate).

---

## Suite Summary Breakdown

| Suite / File Name | Focus Area | Test Count | Pass Rate | Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| `archive-security-and-parsing.test.ts` | Zip-Slip, Zip-Bomb limits, streaming JSONL, memory boundaries | 45 | 100% | ~580 ms |
| `version-compatibility-and-snapshots.test.ts`| Trace adapters v5–v10, snapshot provenance & completeness | 35 | 100% | ~38 ms |
| `failure-classification-and-correlation.test.ts`| Causal Evidence Graph, telemetry filtering, negative controls | 40 | 100% | ~38 ms |
| `candidate-extraction-and-scoring.test.ts` | Multi-factor $S(L)$, calibrated sigmoid, ARIA & role weighting | 35 | 100% | ~61 ms |
| `abstention-and-negative-controls.test.ts` | Strict uniqueness gate ($matchCount === 1$), ambiguity delta | 35 | 100% | ~31 ms |
| `ast-patching-and-invariants.test.ts` | 5 Page Object patterns, Intent Invariant v2 ($V$), Diff Allowlist | 45 | 100% | ~1096 ms |
| `worktree-and-dependency-isolation.test.ts` | Npm/Pnpm/Yarn strategies, NTFS junctions, PID tracking, Windows backoff | 30 | 100% | ~5043 ms |
| `cli-and-mcp-integration.test.ts` | JSON-RPC 2.0 stdio protocol, MCP tools, CLI arguments & flags | 20 | 100% | ~565 ms |
| `end-to-end-repair-workflows.test.ts` | End-to-end pipeline from trace to verified worktree repair evidence | 15 | 100% | ~661 ms |
| `phase1-diagnostics.test.ts` | Legacy Phase 1 diagnostic contract regression tests | 3 | 100% | ~251 ms |
| `phase2-repair.test.ts` | Legacy Phase 2 AST patcher regression tests | 2 | 100% | ~320 ms |
| `phase3-intelligence.test.ts` | Legacy Phase 3 multi-factor scoring regression tests | 4 | 100% | ~61 ms |
| `phase4-mcp.test.ts` | Legacy Phase 4 MCP server initialization tests | 3 | 100% | ~12 ms |
| `archive-reader.test.ts` | Archive extraction and entry identification unit tests | 6 | 100% | ~356 ms |
| `ast-patcher.test.ts` | Core AST replacement logic unit tests | 5 | 100% | ~295 ms |
| `trace-parser.test.ts` | JSONL streaming parser unit tests | 4 | 100% | ~16 ms |
| `worktree-manager.test.ts` | Git worktree lifecycle unit tests | 1 | 100% | ~827 ms |
| `bootstrap.test.ts` | TypeScript runtime and environment validation | 1 | 100% | ~8 ms |
| **TOTAL** | **Entire Test Battery** | **329** | **100%** | **~5.67 s** |

---

## Detailed Test Inventories

### 1. Archive Security & Parsing Suite (`archive-security-and-parsing.test.ts` — 45 Tests)
- `SEC-ZIP-01` to `SEC-ZIP-10`: Path traversal attacks via `../`, `..\\`, absolute Windows drive paths, nested parent directory escapes, and URL-encoded traversal characters. Expected: `ZipSlipSecurityError` thrown, zero disk writes outside target dir. (10/10 Passed)
- `SEC-BOMB-01` to `SEC-BOMB-10`: Decompression bomb attacks: archives with 100:1 to 1000:1 compression ratios, nested zero-byte zip bombs, recursive archives, and payloads exceeding 100 MB decompressed. Expected: Extraction aborted with ratio or size limits. (10/10 Passed)
- `SEC-ENTRY-01` to `SEC-ENTRY-05`: Entry cap tests: archives containing >10,000 files. Expected: `ArchiveTooLargeError` thrown. (5/5 Passed)
- `SEC-JSONL-01` to `SEC-JSONL-10`: JSONL streaming boundaries: lines exceeding 16 MB limit, malformed JSON lines, null byte injections, non-UTF8 binary chunks. Expected: Oversized lines dropped, parser degrades gracefully without crash. (10/10 Passed)
- `SEC-PERM-01` to `SEC-PERM-10`: Filesystem permission guards: read-only destination folders, read-only trace files, corrupted zip headers. (10/10 Passed)

### 2. Version Compatibility & Snapshots Suite (`version-compatibility-and-snapshots.test.ts` — 35 Tests)
- `VER-V8-01` to `VER-V8-08`: Playwright v1.30–v1.39 trace archives (schema v7/v8). Correct extraction of flat action events and before/after snapshot references. (8/8 Passed)
- `VER-V9-01` to `VER-V9-08`: Playwright v1.40–v1.44 trace archives (schema v9). Parsing array-based NodeSnapshot tuples into DOM element nodes. (8/8 Passed)
- `VER-V10-01` to `VER-V10-08`: Playwright v1.45+ trace archives (schema v10). Parsing enhanced ARIA trees and cross-frame events. (8/8 Passed)
- `VER-UNKNOWN-01` to `VER-UNKNOWN-05`: Unrecognized trace schema versions (e.g. v99). Expected: `DiagnosticCategory.UNSUPPORTED_TRACE_FORMAT` emitted. (5/5 Passed)
- `VER-SNAP-01` to `VER-SNAP-06`: Snapshot completeness classification: complete DOM trees (`COMPLETE`), severed trees (`PARTIAL`), empty streams (`UNAVAILABLE`). (6/6 Passed)

### 3. Failure Classification & Correlation Suite (`failure-classification-and-correlation.test.ts` — 40 Tests)
- `DIAG-DRIFT-01` to `DIAG-DRIFT-08`: Pure locator drift failures where all in-domain API calls return 200 OK. Classified as `LOCATOR_DRIFT` with confidence > 0.90. (8/8 Passed)
- `DIAG-500-01` to `DIAG-500-08`: True in-domain backend 500/502/503 errors. Classified as `BACKEND_500` with causal endpoint correlation. (8/8 Passed)
- `DIAG-NOISE-01` to `DIAG-NOISE-08`: Telemetry filtering: failing Google Analytics, Sentry, Datadog, `/metrics`, `/beacon`, `/favicon.ico`. Verified that failing telemetry DOES NOT trigger `BACKEND_500`. (8/8 Passed)
- `DIAG-AUTH-01` to `DIAG-AUTH-06`: Expired session tokens, HTTP 401/403, and redirect to `/login`. Classified as `AUTH_EXPIRED`. (6/6 Passed)
- `DIAG-ASSERT-01` to `DIAG-ASSERT-05`: Test failures caused by `expect()` mismatch rather than action timeouts. Classified as `ASSERTION_FAILURE`. (5/5 Passed)
- `DIAG-RACE-01` to `DIAG-RACE-05`: Element detached or mutating during click. Classified as `TIMING_RACE`. (5/5 Passed)

### 4. Candidate Extraction & Scoring Suite (`candidate-extraction-and-scoring.test.ts` — 35 Tests)
- `SCORE-ROLE-01` to `SCORE-ROLE-10`: Role weighting: `<button>`, `role="button"`, `<a>`, `<input>` evaluated for click actions. ARIA roles receiving highest weight $S_{role} = 1.0$. (10/10 Passed)
- `SCORE-ATTR-01` to `SCORE-ATTR-10`: Test ID precedence: `data-testid`, `data-test`, `data-cy` evaluated above generic attributes. Dynamic IDs penalized with $P_{dynamic} = -0.5$. (10/10 Passed)
- `SCORE-SIGMOID-01` to `SCORE-SIGMOID-10`: Calibrated probability verification: monotonic mapping from raw score $S(L) \in [0, 1]$ to calibrated sigmoid $P(\text{valid})$. (10/10 Passed)
- `SCORE-EXTRACT-01` to `SCORE-EXTRACT-05`: Semantic tag filtering: non-interactive elements (`<div>`, `<span>`, `<td>`) filtered unless bearing interactive roles. (5/5 Passed)

### 5. Abstention & Negative Controls Suite (`abstention-and-negative-controls.test.ts` — 35 Tests)
- `ABSTAIN-UNIQ-01` to `ABSTAIN-UNIQ-10`: Strict uniqueness boundary tests: candidates with $matchCount = 2, 3, 5$ strictly rejected with `NON_UNIQUE_CANDIDATE` ($U < 1.0$). (10/10 Passed)
- `ABSTAIN-DELTA-01` to `ABSTAIN-DELTA-10`: Ambiguity delta tests: top candidate score 0.88 vs runner-up score 0.85 ($\Delta = 0.03 < 0.08$) strictly triggers `AMBIGUOUS_CANDIDATES`. (10/10 Passed)
- `ABSTAIN-CONF-01` to `ABSTAIN-CONF-05`: Low confidence candidates (score $< 0.75$) rejected with `LOW_CONFIDENCE_SCORE`. (5/5 Passed)
- `ABSTAIN-SEM-01` to `ABSTAIN-SEM-10`: Incompatible action semantics: attempting `click` on `<input type="text">` or `fill` on `<button>` rejected. (10/10 Passed)

### 6. AST Patching & Invariants Suite (`ast-patching-and-invariants.test.ts` — 45 Tests)
- `AST-POM-01` to `AST-POM-15`: 5 supported POM patterns: property initializers, getters, constructor assignments, factory methods, and standalone constants. Verified clean replacement. (15/15 Passed)
- `AST-DYN-01` to `AST-DYN-05`: Dynamic parameterized methods (`userRow(id)`). Verified rejection with `AST_PARAMETERIZED_LOCATOR`. (5/5 Passed)
- `AST-ALLOW-01` to `AST-ALLOW-10`: Diff Allowlist validation: rejects changes to imports, additions of methods, or alterations to constructor parameters. (10/10 Passed)
- `AST-INV-01` to `AST-INV-15`: Intent Invariant v2: canonical expectation hash matching, formatting insensitivity, fixture literal matching, structural statement sequence matching. (15/15 Passed)

### 7. Worktree & Dependency Isolation Suite (`worktree-and-dependency-isolation.test.ts` — 30 Tests)
- `WORKTREE-01` to `WORKTREE-10`: Git worktree creation, detached HEAD checkout, unique random ID generation, registry recording in `registry.json`. (10/10 Passed)
- `WORKTREE-11` to `WORKTREE-20`: Windows NTFS junction management: zero root `node_modules` wiping, safe junction unlinking before deletion, concurrent worktree isolation. (10/10 Passed)
- `WORKTREE-21` to `WORKTREE-30`: Dependency strategy resolution (`NpmStrategy`, `PnpmStrategy`, `YarnPnpStrategy`), process liveness checks (`isProcessAlive`), and Windows exponential retry backoff. (10/10 Passed)

### 8. CLI & MCP Integration Suite (`cli-and-mcp-integration.test.ts` — 20 Tests)
- `MCP-PROTO-01` to `MCP-PROTO-10`: JSON-RPC 2.0 protocol compliance: `initialize`, `tools/list`, `tools/call`, error codes (`-32600`, `-32601`, `-32602`, `-32000`). (10/10 Passed)
- `CLI-CMD-01` to `CLI-CMD-10`: CLI flags and commands: `diagnose`, `repair --dry-run`, `repair --apply`, `audit`, `--json` formatted outputs. (10/10 Passed)

### 9. End-to-End Repair Workflows Suite (`end-to-end-repair-workflows.test.ts` — 15 Tests)
- `E2E-REPAIR-01` to `E2E-REPAIR-15`: Complete execution lifecycle from raw `trace.zip` ingestion, through candidate scoring, AST patching, worktree isolation, Intent Invariant validation, and signed evidence report generation. (15/15 Passed)
