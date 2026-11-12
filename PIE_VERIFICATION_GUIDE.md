# PIE Verification Guide — Static Gates, Trace Repair & Mutation Falsification

This guide explains Phase 4 ([src/intelligence/generation-verifier.ts](file:///D:/Work/playwright-intelligence-engine/src/intelligence/generation-verifier.ts)), detailing how PIE proves generated tests compile, execute accurately, resist assertion weakening, and catch seeded faults.

---

## 1. Stage 1 — Transactional Write & Static Validation

Before any test executes in a browser:
1. **Contract & Anti-Pattern Validation:** `validateFullGenerationProposal` rejects hardcoded secrets, `waitForTimeout()`, constant checks (`expect(true).toBe(true)`), empty tests, `test.skip()`, and references to unverified evidence IDs.
2. **Assertion Quality Gate:** `AssertionQualityGate.evaluate()` ([src/generator/assertion-quality-gate.ts](file:///D:/Work/playwright-intelligence-engine/src/generator/assertion-quality-gate.ts)) enforces web-first Playwright assertions (`toBeVisible`, `toHaveText`, `toContainText`, `toHaveCount`, `toHaveValue`, `toBeChecked`, `toHaveURL`) and blocks trivial heading-echo specs.
3. **Transactional Apply (`CandidateWriter`):** Writes `CREATE`/`MODIFY` files atomically with traversal/symlink guards, local import checks, and full rollback capability on error ([src/generator/candidate-writer.ts](file:///D:/Work/playwright-intelligence-engine/src/generator/candidate-writer.ts)).
4. **TypeScript & Discovery:** Runs target `tsc -p tsconfig.json --noEmit` (when configured) and `playwright test --list` to verify zero compile or fixture wiring errors.

---

## 2. Stage 2 — Execution, Trace Diagnosis & Assertion Preservation

PIE runs generated specs with `--trace=on`. If any test fails:
1. **Trace Inspection:** Unpacks `.zip` traces using `ArchiveReader`, `TraceParser.assembleDiagnosticContext()`, and `EvidenceCorrelator.correlate()`.
2. **Ownership Attribution:** Distinguishes **application defects** (e.g., HTTP `500` -> `BACKEND_500`, `defectOwner: 'application'`) from **automation defects** (`LOCATOR_DRIFT`, `defectOwner: 'automation'`).
   - If `defectOwner === 'application'`, bounded repair **halts immediately** rather than altering the test to hide a broken backend.
3. **Bounded Repair Loop (`maxRepairIterations`, default 3, max 5):** When `repairCallback` supplies a patch, `assertionsPreserved(originalSpec, repairedSpec)` checks that:
   - The total `expect()` assertion count did not shrink.
   - Generic `page.locator('body')` checks did not replace specific locators (`getByText`, `getByTestId`, `getByLabel`).
   - All semantic literal expectations, role names, and matchers (`.toBeVisible()`, `.toHaveCount()`, etc.) remain intact.
   - Any assertion-weakening patch is rejected (`action: 'rejected-assertion-weakening'`, `intentInvariantPreserved: false`).

---

## 3. Stage 3 — Mutation Falsification (Level C & Level B)

Passing tests are stress-tested to confirm they fail when the requirement is violated:

| Mutation Strategy | Mechanism | Interpretation |
|---|---|---|
| **Level C (Assertion Mutation)** | Inverts `.toBeVisible()` ↔ `.toBeHidden()`, corrupts `getByText()` targets, mutates `.toHaveCount(N)` counts. | `KILLED` if mutated spec fails (`exitCode !== 0`); `SURVIVED` if it still passes. |
| **Level B (API Fault Injection)** | Injects `page.route('**/api/**', route => route.fulfill({ status: 500 }))` when API traffic was captured. | Verifies UI/API specs detect server failures instead of passing silently. |

### Mutation Score Formula
$$\text{Mutation Score (\%)} = \frac{\text{Killed Valid Mutants}}{\text{Killed Valid Mutants} + \text{Survived Valid Mutants}} \times 100$$
Invalid or equivalent mutants are recorded separately and excluded from the denominator. Original files are always restored in `finally` blocks so the workspace never remains mutated.

---

## 4. Artifact 3: Final QA Report (`qa-report.json` & `qa-report.md`)

See [qa-report.json](file:///D:/Work/playwright-intelligence-engine/samples/evidence-driven-qa/qa-report.json) and [qa-report.md](file:///D:/Work/playwright-intelligence-engine/samples/evidence-driven-qa/qa-report.md) for verified outputs. Report status taxonomy:
- `VERIFIED`: Static validation, browser execution, intent preservation, zero critical defects, and mutation score `>= 80%` (or N/A when no mutants applicable).
- `VERIFIED_WITH_WARNINGS`: Execution passed, with passive warnings/defects or mutation score `< 80%`.
- `GENERATED`: Generated cleanly with `--no-verify`.
- `NEEDS_INPUT` / `ABSTAINED`: Blocked safely on missing clarification or ungrounded evidence.
- `VERIFICATION_FAILED`: Static errors, failing test execution, or rejected repair.
