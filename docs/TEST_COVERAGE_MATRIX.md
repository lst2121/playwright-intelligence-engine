# Test Coverage Matrix (382 Automated Tests)

This document provides the exhaustive inventory of all 382 automated test cases implemented and verified in the **Playwright Intelligence Engine** test suite (`npm test`).

**Summary:** 24 Test Suites | 382 Tests Executed | 382 Passed | 0 Failed (100% Pass Rate).

---

## Suite Summary Breakdown

| Suite / File Name | Focus Area | Test Count | Pass Rate | Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| `archive-security-and-parsing.test.ts` | Zip-Slip, Zip-Bomb limits, streaming JSONL, memory boundaries | 45 | 100% | ~544 ms |
| `ast-patching-and-invariants.test.ts` | 5 Page Object patterns, Intent Invariant v2 ($V$), Diff Allowlist | 45 | 100% | ~2231 ms |
| `failure-classification-and-correlation.test.ts`| Causal Evidence Graph, telemetry filtering, temporal window | 40 | 100% | ~33 ms |
| `candidate-extraction-and-scoring.test.ts` | Multi-factor $S(L)$, transformed score, ARIA & role weighting | 35 | 100% | ~30 ms |
| `abstention-and-negative-controls.test.ts` | Strict uniqueness gate ($matchCount === 1$), ambiguity delta | 35 | 100% | ~26 ms |
| `version-compatibility-and-snapshots.test.ts`| Trace adapters v8–v10, snapshot provenance & completeness | 35 | 100% | ~32 ms |
| `worktree-and-dependency-isolation.test.ts` | Npm/Pnpm/Yarn strategies, NTFS junctions, PID tracking, Windows backoff | 30 | 100% | ~7075 ms |
| `adversarial-safety-remediation.test.ts` | P0/P1 audit remediation tests (Workstream 10 & Gate A: 21 adversarial tests) | 21 | 100% | ~1062 ms |
| `cli-and-mcp-integration.test.ts` | JSON-RPC 2.0 stdio protocol, MCP tools, CLI arguments & flags | 20 | 100% | ~749 ms |
| `end-to-end-repair-workflows.test.ts` | End-to-end pipeline from trace to verified worktree repair evidence | 15 | 100% | ~1080 ms |
| `live-browser-reproduction.test.ts` | LiveBrowserCollector, DirectBrowserInvestigator, LiveLocatorVerifier (Gate B) | 9 | 100% | ~2282 ms |
| `evidence-redactor.test.ts` | Multi-channel redaction (Bearer, JWT, credit cards, SSNs, headers) | 8 | 100% | ~17 ms |
| `multi-source-collectors.test.ts` | Independent collectors (Error, AST, Network, Live Browser, Env, Scorecard) | 8 | 100% | ~173 ms |
| `archive-reader.test.ts` | Archive extraction and entry identification unit tests | 6 | 100% | ~209 ms |
| `ast-patcher.test.ts` | Core AST replacement logic unit tests | 5 | 100% | ~310 ms |
| `causal-correlator.test.ts` | Action-anchored windowing ($T_{\text{action}}$), frame affinity, causal graph edges | 4 | 100% | ~20 ms |
| `phase3-intelligence.test.ts` | Phase 3 multi-factor scoring regression tests | 4 | 100% | ~87 ms |
| `trace-parser.test.ts` | JSONL streaming parser unit tests | 4 | 100% | ~13 ms |
| `empirical-benchmark-runner.test.ts` | Benchmark configuration, filtering, fast classifier unit tests (Gate C) | 3 | 100% | ~24 ms |
| `phase1-diagnostics.test.ts` | Phase 1 diagnostic contract regression tests | 3 | 100% | ~208 ms |
| `phase4-mcp.test.ts` | Phase 4 MCP server initialization tests | 3 | 100% | ~16 ms |
| `phase2-repair.test.ts` | Phase 2 AST patcher regression tests | 2 | 100% | ~677 ms |
| `worktree-manager.test.ts` | Git worktree lifecycle unit tests | 1 | 100% | ~1006 ms |
| `bootstrap.test.ts` | TypeScript runtime and environment validation | 1 | 100% | ~7 ms |
| **TOTAL** | **Entire Test Battery** | **382** | **100%** | **~7.75 s** |

---

## Detailed Remediation Suite (`adversarial-safety-remediation.test.ts` — 21 Tests)

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
17. `ADV-17`: Proves token isolation: proposal response does not leak auto-usable authorization tokens.
18. `ADV-18`: Enforces VerifiedExecutionProof in IntentValidator.authorizeVerifiedRepair.
19. `ADV-19`: Proves WorkspacePromoter enforces CAS atomic promotion and rejects modified source.
20. `ADV-20`: Enforces canonical realpath containment in WorkspacePromoter.
21. `ADV-21`: Enforces fail-closed dependency validation in WorktreeManager.createWorktree.

---

## Live Browser Reproduction Suite (`live-browser-reproduction.test.ts` — 9 Tests)

1. `LIVE-LOC-01`: LiveLocatorVerifier verifies valid getByRole locator candidate live in browser.
2. `LIVE-LOC-02`: LiveLocatorVerifier detects and rejects duplicate/ambiguous controls (`count === 2`).
3. `LIVE-LOC-03`: LiveLocatorVerifier detects hidden non-interactive elements.
4. `LIVE-COLL-01`: LiveBrowserCollector redacts Bearer tokens and sensitive query parameters in live console logs.
5. `LIVE-COLL-02`: LiveBrowserCollector redacts sensitive password and authentication input values in DOM snapshots.
6. `LIVE-COLL-03`: LiveBrowserCollector captures accessibility snapshot using modern `page.ariaSnapshot()`.
7. `DIRECT-INV-01`: DirectBrowserInvestigator launches direct browser investigation and verifies locator candidate live.
8. `RERUN-PATH-01`: DiagnosticRerunner maps absolute spec path within workspace to relative spec inside worktree.
9. `RERUN-PATH-02`: DiagnosticRerunner rejects spec path outside workspace boundary.
