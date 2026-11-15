---
name: pie-release-verifier
description: >-
  Standard operating procedure for verifying Playwright Intelligence Engine (PIE) releases.
  Runs full invariant test suites, typechecks, builds, verifies supply chain security,
  and enforces the human-approval gate before any npm publication.
---

# PIE Release Verifier Skill

Follow this runbook before any release, milestone tag, or publication.

## Verification Checklist

1. **Adversarial Safety & Invariants:**
   Run full vitest suite across all 70 test files:
   ```powershell
   npm test
   ```
   *Requirement:* All unit and invariant tests (678+ tests) must pass with zero failures.

2. **Static Typing & Build:**
   ```powershell
   npm run typecheck
   npm run build
   ```
   *Requirement:* Clean TypeScript compilation with no diagnostic warnings.

3. **Supply Chain & Security Audit:**
   - Verify no dynamic execution:
     ```powershell
     git grep "eval(" src/
     git grep "$$eval" src/
     ```
     *Must return 0 occurrences in `src/`.*
   - Verify path containment:
     All proposal and token operations must route through `ApprovalService.assertSafeId` and `resolveContainedPath`.
   - Verify workspace boundary:
     All target and candidate file resolution in direct code repair must assert `assertPathWithinWorkspace`.

4. **Flaky Test Auto-Stabilizer & Bug Reporting Smoke Test:**
   - Test stabilization scan:
     ```powershell
     node bin/pw-intel.js stabilize tests/unit/flaky-test-stabilizer.test.ts --no-exec
     ```
   - Test defect ticket generator on a negative control trace:
     ```powershell
     node bin/pw-intel.js report-defect <trace.zip>
     ```

5. **Human Approval Gate (STRICT):**
   > [!CRITICAL]
   > **DO NOT PUBLISH TO NPM WITHOUT EXPLICIT USER PERMISSION.**
   > Only run `npm publish --dry-run` to inspect package contents until the user explicitly commands publication.
