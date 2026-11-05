# Test Execution Report — Playwright Intelligence Engine (v2.5)

**Execution Date:** November 2026  
**Test Framework:** Vitest 5.1.0  
**Test Configuration:** ESM, strict NodeNext, multi-worker isolation  
**Total Test Suites:** 22  
**Total Tests Executed:** 365  
**Passed:** 365  
**Failed:** 0  
**Skipped:** 0  
**Pass Rate:** 100.0%  
**Total Duration:** ~5.61 seconds  

---

## 1. Suite-by-Suite Execution Breakdown

| Test Suite File | Tests | Passed | Failed | Duration | Primary Focus |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tests/unit/archive-security-and-parsing.test.ts` | 45 | 45 | 0 | ~476 ms | Zip-Slip path traversal, decompression bomb limits, streaming JSONL limits |
| `tests/unit/version-compatibility-and-snapshots.test.ts` | 35 | 35 | 0 | ~35 ms | Playwright trace schemas v7–v10, snapshot provenance & completeness |
| `tests/unit/failure-classification-and-correlation.test.ts` | 40 | 40 | 0 | ~37 ms | Causal evidence graph, telemetry domain filtering, temporal window |
| `tests/unit/candidate-extraction-and-scoring.test.ts` | 35 | 35 | 0 | ~37 ms | Multi-factor scoring formula $S(L)$, transformed confidence, ARIA weighting |
| `tests/unit/abstention-and-negative-controls.test.ts` | 35 | 35 | 0 | ~26 ms | Strict uniqueness gate, ambiguity delta guardrail, negative controls |
| `tests/unit/ast-patching-and-invariants.test.ts` | 45 | 45 | 0 | ~1534 ms | 5 Page Object patterns, Intent Invariant v2 ($V$), Diff Allowlist |
| `tests/unit/adversarial-safety-remediation.test.ts` | 16 | 16 | 0 | ~772 ms | P0/P1 audit remediation tests (Workstream 10 adversarial battery) |
| `tests/unit/worktree-and-dependency-isolation.test.ts` | 30 | 30 | 0 | ~5056 ms | Npm/Pnpm/Yarn strategies, NTFS directory junctions, PID tracking |
| `tests/unit/cli-and-mcp-integration.test.ts` | 20 | 20 | 0 | ~535 ms | JSON-RPC 2.0 stdio protocol, MCP server tools, CLI flags |
| `tests/unit/end-to-end-repair-workflows.test.ts` | 15 | 15 | 0 | ~984 ms | Autonomous repair pipeline from trace to verified repair evidence |
| `tests/unit/evidence-redactor.test.ts` | 8 | 8 | 0 | ~18 ms | Scrubbing Bearer tokens, JWTs, PANs, SSNs, and HTTP headers |
| `tests/unit/multi-source-collectors.test.ts` | 8 | 8 | 0 | ~61 ms | Error, AST, Network, Live Browser, Environment collectors & scorecard |
| `tests/unit/causal-correlator.test.ts` | 4 | 4 | 0 | ~14 ms | Action-anchored window ($T_{\text{action}}$), frame affinity, directed edges |
| `tests/unit/phase1-diagnostics.test.ts` | 3 | 3 | 0 | ~182 ms | Diagnostic context ingestion contract verification |
| `tests/unit/phase2-repair.test.ts` | 2 | 2 | 0 | ~444 ms | Page Object AST patching and isolated worktree execution |
| `tests/unit/phase3-intelligence.test.ts` | 4 | 4 | 0 | ~53 ms | Multi-factor candidate scoring and calibrated probability |
| `tests/unit/phase4-mcp.test.ts` | 3 | 3 | 0 | ~9 ms | MCP server registration and stdio connection |
| `tests/unit/archive-reader.test.ts` | 6 | 6 | 0 | ~171 ms | Archive discovery and JSONL stream extraction |
| `tests/unit/ast-patcher.test.ts` | 5 | 5 | 0 | ~597 ms | Surgical AST replacements with atomic temporary file swap |
| `tests/unit/trace-parser.test.ts` | 4 | 4 | 0 | ~13 ms | Parsing actions, call IDs, errors, and console streams |
| `tests/unit/worktree-manager.test.ts` | 1 | 1 | 0 | ~932 ms | Git worktree creation and junction linking |
| `tests/unit/bootstrap.test.ts` | 1 | 1 | 0 | ~6 ms | Environment and TypeScript configuration validation |
| **TOTALS** | **365** | **365** | **0** | **~5.61 s** | **100% Pass Rate Across All Suites** |

---

## 2. Compilation and Typecheck Results

- **Compiler Command:** `npm run typecheck` (`tsc --noEmit`)
- **Exit Code:** `0` (Zero compiler errors or warnings)
- **Strictness Level:** Strict Mode enabled (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `noUnusedLocals`, `noUnusedParameters`).

---

## 3. Production Bundling Results

- **Bundler:** `tsup v9.0.0`
- **Target:** `ESM (es2022)`
- **Bundle File:** `dist/index.js` (194.13 KB)
- **Declaration Output:** `dist/index.d.ts` (Clean type definitions generated)
- **Exit Code:** `0`
