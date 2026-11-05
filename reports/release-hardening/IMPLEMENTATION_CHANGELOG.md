# PIE v2.6 — Release-Hardening Implementation Changelog

**Release:** v2.6.0-rc1  
**Preceding Milestone:** v2.5 (Audited)  
**Date:** 2026-11-05  

---

## 1. P0 Blockers Resolved

### Fix 1: NPM Packaging & File Allowlist
- **Root Cause:** `package.json` had no `"files"` allowlist. When packed, benchmark files, test files, and local configurations leaked into the tarball. Furthermore, `.gitignore` contained `dist/`, which caused `dist/` to be stripped from `npm pack`.
- **Remediation:**
  - Added explicit `"files": ["dist", "bin", "README.md", "LICENSE"]` in `package.json`.
  - Moved `@playwright/test` from `dependencies` to `peerDependencies` with `peerDependenciesMeta.optional = true`.
  - Replaced static import in `src/reproduce/direct-browser-investigator.ts` with dynamic loader `resolvePlaywrightChromium()`.
  - Created standalone executable `bin/pw-intel.js` with hashbang `#!/usr/bin/env node`.
  - Verified clean external installation in temporary directory outside repository.

### Fix 2: Dual-Gate Repair Authorization Pipeline & CLI Commands
- **Root Cause:** In v2.5, MCP tool `stage_patch_proposal` accepted `worktreeExecutionVerified: true` as a caller-provided boolean flag without validating real execution evidence. Staging directly returned an authorized token without operator review.
- **Remediation:**
  - Replaced caller boolean in `src/repair/approval-service.ts` with derivation strictly from `VerifiedExecutionProof`.
  - Implemented unverified draft staging: staging without an execution proof stages the proposal as `worktreeExecutionVerified: false`.
  - Added CLI command `pw-intel approve <proposalId>`: displays unified diff and execution proof for human review, and issues a cryptographic single-use `ApprovalToken`.
  - Added CLI command `pw-intel promote --token <token>`: verifies CAS hashes, process lock, and applies the patch.
  - Implemented `pw-intel doctor` for environmental readiness healthchecks.

### Fix 3: Multi-Config Compilation & Typechecking
- **Root Cause:** The repository lacked dedicated test and benchmark tsconfigs. Root `tsconfig.json` was overloaded, resulting in type errors or uncompiled benchmark code.
- **Remediation:**
  - Created `tsconfig.tests.json` extending root config with vitest globals and test files.
  - Created `tsconfig.benchmarks.json` extending root config with benchmark specs and runners.
  - Updated `npm run typecheck` to execute `tsc --noEmit && tsc -p tsconfig.tests.json --noEmit && tsc -p tsconfig.benchmarks.json --noEmit`.
  - Resolved all 0 compiler errors across all three configurations.

### Fix 4: Real Empirical Browser Benchmark
- **Root Cause:** v2.5 benchmark used an oracle callback (`selectTargetCandidate`) that handed the correct answer to the engine, bypassed AST patching, and hardcoded 0.0% for regression and defect masking rates.
- **Remediation:**
  - Completely eliminated `selectTargetCandidate`.
  - Implemented autonomous candidate extraction via Chromium `page.$$eval()`.
  - Implemented multi-factor candidate scoring via `SelectorScorer`.
  - Implemented live empirical verification in Chromium via `LiveLocatorVerifier` enforcing strict Playwright uniqueness (`count === 1`).
  - Implemented real in-memory AST Page Object patching via `AstPatcher` and `DiffAllowlistValidator`.
  - Implemented post-repair regression checks executing clean baseline user journeys in Chromium after every repair.
  - Computed all rates dynamically from observed execution arrays.

---

## 2. P1 Architectural Improvements

### Fix 5: Dirty Workspace Snapshotting & Mirroring
- **Root Cause:** `WorktreeManager` failed to capture uncommitted developer changes when creating worktrees, leading to discrepancies between active and isolated workspaces.
- **Remediation:**
  - Implemented `git stash create` in `src/sandbox/worktree-manager.ts` to capture working tree commits.
  - Implemented untracked file mirroring into worktrees while excluding `.git`, `node_modules`, and lockfiles.

### Fix 6: Concurrency Lock & CAS Source Hash Validation
- **Root Cause:** Race conditions between simultaneous repair promotion requests could cause file corruption or overwrite newer code.
- **Remediation:**
  - Created `src/repair/workspace-promoter.ts` with cross-process file lock (`.pie-promote.lock`).
  - Added Content-Addressable Storage (CAS) source hash checking against target file on disk before writing.
  - Implemented atomic rename over `.pie-tmp-XXXXXX` and pre-mutation rollback backup (`.pie-backup`).

### Fix 7: SelectorScorer Multi-Token Composite Matching
- **Root Cause:** `SelectorScorer` penalised candidates when the original selector contained multiple action words (e.g. `#btn-cart-checkout` matching `Proceed to Checkout`), incorrectly diagnosing a conflict between "cart" and "checkout".
- **Remediation:**
  - Updated conflict detection in `src/selector/selector-scorer.ts` to require mutually exclusive presence of contradictory words.
  - Expanded candidate identity matching to evaluate composite tokens across `accessibleName`, `text`, `data-testid`, and `id`.

---

## 3. External Release Audit Remediation

### Fix 8: Total Purge of Authorization Bypasses & AI Self-Approval
- **Root Cause:** In v2.6 drafts, `IntentValidator.validateV2` allowed `else if (target.executionPassed === true)`, enabling boolean overrides of missing proofs; `ApprovalService.generateToken()` defaulted `executionVerified` to true; and MCP server had an unlisted `approve_repair_proposal` tool allowing AI agents to self-approve with `confirmed: true`.
- **Remediation:**
  - Completely deleted `approve_repair_proposal` from `src/mcp/server.ts`. AI agents cannot self-approve repair proposals.
  - Removed `executionPassed === true` bypass from `IntentValidator.validateV2`. Execution verification strictly requires an authentic `VerifiedExecutionProof`.
  - Replaced in-memory `Map` proposal/token storage with a persistent, file-backed JSON store in `.pw-intelligence/proposals/` and `.pw-intelligence/tokens/`.
  - Staging proposals from background MCP servers and approving them via CLI `pw-intel approve` now shares state seamlessly and securely across process boundaries.

### Fix 9: TOCTOU Elimination & Lock Theft Prevention
- **Root Cause:** Approval token was consumed either outside the lock or after promotion, creating a race condition; and `acquireCrossProcessLock` reclaimed locks after 30s even if the owning PID was still alive.
- **Remediation:**
  - In `WorkspacePromoter.promote`, token verification and single-use consumption are executed strictly *inside* the locked critical section immediately after CAS hash check.
  - In `acquireCrossProcessLock`, active process locks are strictly respected regardless of duration; only dead/terminated process locks are reclaimed.

### Fix 10: Fail-Closed Worktree Containment & Windows Shell Safety
- **Root Cause:** `WorktreeManager` had lexical path fallbacks if `realpath` resolution failed, and `ExecutionRunner` used `cmd.exe /c` for `npx` on Windows.
- **Remediation:**
  - `WorktreeManager` throws `WorktreeOperationError` fail-closed if `realpathSync` fails on base or worktree directories. Zero lexical fallbacks.
  - `ExecutionRunner` executes Node's bundled CLI scripts (`npx-cli.js`) directly via `node.exe` with `shell: false`, eliminating Windows command interpreter injection vulnerabilities.

### Fix 11: Benchmark Mathematical Rigor & Truthful Evaluation
- **Root Cause:** Benchmark Tier 3 evaluated metadata strings rather than actual evidence; precision calculation omitted failed repairs from the denominator; and Wilson CI aggregated baselines, recoveries, and abstentions into one mixed number.
- **Remediation:**
  - Tier 3 passes live captured evidence (HTTP responses, console logs, error messages, and DOM) directly into `FailureClassifier.classify(diagnosticContext)` with zero metadata string checking.
  - Repair Precision formula updated to `tier2Repaired / (tier2Repaired + tier2Failed + falseRepairs)`, truthfully yielding 96.7% over 60 mutations.
  - Calculated separate Wilson 95% CIs for Baseline Pass Rate, Repair Precision, Repair Recall, and Safe Abstention Rate.
