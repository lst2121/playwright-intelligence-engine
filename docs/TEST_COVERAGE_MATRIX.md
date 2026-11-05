# Test Coverage Matrix (345 Automated Tests)

This document provides the exhaustive inventory of all 345 automated test cases implemented and verified in the **Playwright Intelligence Engine** test suite (`npm test`).

**Summary:** 19 Test Suites | 345 Tests Executed | 345 Passed | 0 Failed (100% Pass Rate).

---

## Suite Summary Breakdown

| Suite / File Name | Focus Area | Test Count | Pass Rate | Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| `archive-security-and-parsing.test.ts` | Zip-Slip, Zip-Bomb limits, streaming JSONL, memory boundaries | 45 | 100% | ~447 ms |
| `version-compatibility-and-snapshots.test.ts`| Trace adapters v7–v10, snapshot provenance & completeness | 35 | 100% | ~32 ms |
| `failure-classification-and-correlation.test.ts`| Causal Evidence Graph, telemetry filtering, temporal window | 40 | 100% | ~46 ms |
| `candidate-extraction-and-scoring.test.ts` | Multi-factor $S(L)$, transformed score, ARIA & role weighting | 35 | 100% | ~37 ms |
| `abstention-and-negative-controls.test.ts` | Strict uniqueness gate ($matchCount === 1$), ambiguity delta | 35 | 100% | ~28 ms |
| `ast-patching-and-invariants.test.ts` | 5 Page Object patterns, Intent Invariant v2 ($V$), Diff Allowlist | 45 | 100% | ~1225 ms |
| `adversarial-safety-remediation.test.ts` | P0/P1 audit remediation tests (Workstream 10: 16 adversarial tests) | 16 | 100% | ~626 ms |
| `worktree-and-dependency-isolation.test.ts` | Npm/Pnpm/Yarn strategies, NTFS junctions, PID tracking, Windows backoff | 30 | 100% | ~4689 ms |
| `cli-and-mcp-integration.test.ts` | JSON-RPC 2.0 stdio protocol, MCP tools, CLI arguments & flags | 20 | 100% | ~450 ms |
| `end-to-end-repair-workflows.test.ts` | End-to-end pipeline from trace to verified worktree repair evidence | 15 | 100% | ~686 ms |
| `phase1-diagnostics.test.ts` | Phase 1 diagnostic contract regression tests | 3 | 100% | ~172 ms |
| `phase2-repair.test.ts` | Phase 2 AST patcher regression tests | 2 | 100% | ~291 ms |
| `phase3-intelligence.test.ts` | Phase 3 multi-factor scoring regression tests | 4 | 100% | ~63 ms |
| `phase4-mcp.test.ts` | Phase 4 MCP server initialization tests | 3 | 100% | ~7 ms |
| `archive-reader.test.ts` | Archive extraction and entry identification unit tests | 6 | 100% | ~179 ms |
| `ast-patcher.test.ts` | Core AST replacement logic unit tests | 5 | 100% | ~341 ms |
| `trace-parser.test.ts` | JSONL streaming parser unit tests | 4 | 100% | ~11 ms |
| `worktree-manager.test.ts` | Git worktree lifecycle unit tests | 1 | 100% | ~837 ms |
| `bootstrap.test.ts` | TypeScript runtime and environment validation | 1 | 100% | ~6 ms |
| **TOTAL** | **Entire Test Battery** | **345** | **100%** | **~5.22 s** |

---

## Detailed Remediation Suite (`adversarial-safety-remediation.test.ts` — 16 Tests)

Implemented specifically to address the P0 and P1 audit findings:

1. `ADV-01`: Rejects repair authorization when `executionPassed` is `false`. (Fail-closed execution invariant).
2. `ADV-02`: Rejects repair authorization when `executionPassed` is omitted in strict verification mode.
3. `ADV-03`: Rejects repair authorization when diff-validation inputs (original/patched source, member name) are missing.
4. `ADV-04`: Rejects replacement candidate with contradictory cancellation semantics (e.g. `Cancel Order` replacing `#submit-order-button`).
5. `ADV-05`: Detects assertion tampering when whitespace inside string literals is altered (`'Payment  failed'` vs `'Payment failed'`).
6. `ADV-06`: Detects fixture tampering when object key-value pairs are swapped (`{username: 'admin', role: 'alice'}` vs `{username: 'alice', role: 'admin'}`).
7. `ADV-07`: Detects structural control flow tampering when conditional operators are negated (`if (!user.isActive)` vs `if (user.isActive)`).
8. `ADV-08`: Rejects unauthorized new method added to Page Object class via DiffAllowlist.
9. `ADV-09`: Rejects unauthorized top-level function added to Page Object file via DiffAllowlist.
10. `ADV-10`: Rejects arbitrary executable replacement expressions containing multiple statements, semicolons, or process calls (`this.page.locator('x'); process.exit(1);`).
11. `ADV-11`: Rejects ambiguous Playwright locator candidate when element matches multiple DOM nodes ($matchCount === 2$).
12. `ADV-12`: Excludes historical HTTP 500 error occurring outside the 5,000ms temporal window from being falsely classified as causal.
13. `ADV-13`: Rejects locator timeout without DOM snapshot evidence with `INCOMPLETE_EVIDENCE` and mandatory abstention.
14. `ADV-14`: Resolves `UnknownTraceAdapter` (`1.0.0-unsupported`) for unrecognized schema versions.
15. `ADV-15`: Rejects MCP file operations targeting paths outside the authorized workspace root (`../../etc/passwd`).
16. `ADV-16`: Positive end-to-end verification proving legitimate locator repair satisfies all six invariant clauses ($V = A \land T \land F \land I \land D \land E$).
