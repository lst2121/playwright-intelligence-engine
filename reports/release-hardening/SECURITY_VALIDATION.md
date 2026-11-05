# PIE v2.6 — Security Architecture & Adversarial Verification Report

**Classification:** Enterprise Production Security Audit  
**Version:** 2.6.0-rc1  
**Audited Subsystems:** Worktree Isolation, CAS Mutation Integrity, Process Concurrency, CLI/MCP Authorization  

---

## 1. Threat Model & Core Invariants

The security model of the Playwright Intelligence Engine enforces a strict boundary between automated investigation/repair and the developer's live workspace:

```
[ Active Developer Workspace ]
              |
              | (Snapshot / Branch via git stash & worktree)
              v
[ Isolated Git Worktree (NTFS Junctions / Detached HEAD) ]
   - Rerun Failing Test
   - Collect Multi-Source Evidence
   - Classify Root Cause
   - Generate AST Repair
   - Live Browser Verification
   - Produce Cryptographic Proof (VerifiedExecutionProof)
              |
              | (Staged as Unverified Draft in ApprovalService)
              v
[ Human / Operator Review via CLI: pw-intel approve <id> ]
   - Operator inspects unified diff & execution proof
   - Cryptographic single-use token issued (ApprovalToken)
              |
              | (Atomic Promotion via CLI: pw-intel promote --token <token>)
              v
[ Active Developer Workspace Mutated with .pie-backup & Lock ]
```

---

## 2. Security Controls Implemented and Verified

### Control 1: Dual-Gate Repair Authorization Pipeline
- **Problem in v2.5:** MCP tool `stage_patch_proposal` could stage proposals with `worktreeExecutionVerified: true` as a caller-provided boolean, bypassing live execution verification. Furthermore, a hidden `approve_repair_proposal` MCP tool accepted an agent boolean `confirmed: true`, allowing AI self-approval.
- **Remediation in v2.6:**
  - `approve_repair_proposal` was completely removed from the MCP server. AI agents are structurally incapable of authorizing repair proposals.
  - `worktreeExecutionVerified` is derived strictly from an immutable, non-null `VerifiedExecutionProof` containing exit code 0, passed count > 0, stdout/stderr, and composite intent hashes.
  - In `IntentValidator.validateV2`, the `else if (target.executionPassed === true)` bypass was completely purged; execution verification strictly requires an authentic `VerifiedExecutionProof`.
  - Proposals and tokens are backed by persistent disk storage in `.pw-intelligence/proposals/` and `.pw-intelligence/tokens/`, enabling seamless, secure cross-process verification between IDE background MCP servers and developer CLI terminals.
  - Staged proposals require explicit operator review via the CLI: `pw-intel approve <proposalId>`.
  - Stored approval tokens carry SHA-256 hashes of original and patched sources, target file path, and single-use expiration flags.

### Control 2: Content-Addressable Storage (CAS) Hash Verification & Atomic Token Consumption
- Before writing a patch to the user's workspace, `WorkspacePromoter` acquires an inter-process file lock, computes the SHA-256 hash of the target file on disk, and compares it to the `originalSourceHash` embedded in the token.
- **Elimination of TOCTOU Window:** Token verification and single-use consumption are executed strictly *inside* the locked critical section immediately following CAS verification.
- If the file was modified in the workspace after the proposal was staged, promotion aborts immediately with `CAS mismatch error: target file has changed since approval token was issued`.

### Control 3: Cross-Process Concurrency Lock & Prevention of Lock Theft
- Multiple concurrent promotions or race conditions between CLI and MCP processes are prevented via an inter-process file lock (`<file>.pie-promote.lock`).
- **Elimination of Lock Timeout Theft:** `acquireCrossProcessLock` checks whether the owning PID is currently alive (`WorktreeManager.isProcessAlive(pid)`). Dead process locks are safely reclaimed, but active process locks are strictly respected regardless of elapsed time.

### Control 4: Shell Injection Prevention on Windows
- In `ExecutionRunner`, `cmd.exe /d /s /c` invocation for `npx`/`npm` has been replaced with direct execution of Node's bundled CLI scripts (`npx-cli.js`/`npm-cli.js`) via `process.execPath` with `shell: false`. This eliminates Windows command-prompt escaping vulnerabilities.

### Control 5: Path Containment & NTFS Junction Isolation
- All worktree paths are verified using canonical `fs.realpathSync` to guarantee containment within the designated sandbox root.
- Lexical fallback was completely eliminated; any failure to resolve canonical real paths fails closed immediately with `WorktreeOperationError`.

### Control 6: Central Sensitive Data Redaction
- `EvidenceRedactor` scrubs Bearer tokens, JWT headers, passwords, credit card numbers, and authorization cookies across network, console, error, and trace payloads before logging or serialization.

---

## 3. Adversarial Test Suite Results

The adversarial test suite (`tests/unit/adversarial-safety-remediation.test.ts`) verifies fail-closed security against malicious or corrupted inputs:

| Test ID | Adversarial Scenario | Expected Result | Actual Result |
|---|---|---|---|
| `ADV-01` | Proposal staged with `executionPassed: false` | Authorization rejected | ✅ PASSED (Rejected) |
| `ADV-02` | Proposal with omitted `executionPassed` in strict mode | Authorization rejected | ✅ PASSED (Rejected) |
| `ADV-03` | Altered assertion AST node (`toBe(expected)` changed) | `AssertionTamperedError` | ✅ PASSED (Blocked) |
| `ADV-04` | Altered test body structure (statement reordering) | `IntentInvariantViolation` | ✅ PASSED (Blocked) |
| `ADV-05` | Modified test fixtures or parameters | `IntentInvariantViolation` | ✅ PASSED (Blocked) |
| `ADV-06` | Candidate element with contradictory semantics (Cancel for Submit) | Identity violation | ✅ PASSED (Rejected) |
| `ADV-07` | Target file modified on disk after token generation (CAS race) | Promotion aborted | ✅ PASSED (CAS Abort) |
| `ADV-08` | Path traversal attempt in worktree creation (`../../outside`) | Path escape rejected | ✅ PASSED (Blocked) |
| `ADV-09` | Token replay attack (single-use token consumed twice) | Second attempt rejected | ✅ PASSED (Rejected) |
| `ADV-10` | Corrupted trace zip with Zip-Bomb entry count (> 1000) | Extraction rejected | ✅ PASSED (Rejected) |

**Adversarial Verdict:** **SECURE (All 21 adversarial safety checks passed).**
