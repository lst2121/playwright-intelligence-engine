# PIE LLM Development Phases 1–6

## Phase 1 — Contract and loop stability

Implemented:

- Explicit protocol-v2 STEP and FINAL contract in provider prompts.
- Strict schema validation with allowlisted compatibility normalization.
- No-progress termination for repeated actions and unchanged observations.
- Configurable elapsed-time budget through `PIE_LLM_AGENT_MAX_DURATION_MS`.
- Redacted response diagnostics and normalized provider usage fields.

Status: implemented and covered by unit tests.

## Phase 2 — Fast-path reasoning

Implemented:

- High-confidence deterministic `LOCATOR_DRIFT` cases use the single-shot
  proposal provider path.
- Complex or lower-confidence cases retain the bounded action loop.
- Proposal prompts explicitly describe the required operation schema.

Status: implemented; external model validation requires an available provider
quota.

## Phase 3 — Context optimization and repository intelligence

Implemented:

- Full evidence is sent on the first agent step.
- Follow-up steps receive clipped snapshots, bounded network/console events,
  and clipped source context.
- Project intelligence is included as bounded metadata.
- A bounded Page Object source snippet is included when source mapping is
  uniquely discovered.
- Source context is redacted before crossing the provider boundary.

Status: implemented; context-size and latency metrics are emitted by external
evaluation harnesses.

## Phase 4 — Bounded browser investigation

Implemented:

- `inspect_browser_state` is an allowlisted agent action.
- Investigation requires explicit opt-in, an explicit URL, and an explicit
  hostname allowlist.
- Browser investigation is read-only by default and returns clipped evidence.
- It cannot write source, approve a repair, or promote a patch.

Status: implemented as an opt-in fallback. It is not enabled for ordinary
locator-drift evaluation.

## Phase 5 — Verified LLM repair bridge

Implemented:

- `runVerifiedLlmRepairWorkflow` validates an LLM proposal before routing it
  into the existing deterministic repair workflow.
- Execution remains subject to locator grammar, AST diff, assertion, worktree,
  test, approval, and promotion gates.
- The first execution bridge intentionally permits one exact-target operation.

Status: implemented for one-operation verified repair. Direct LLM file writes
remain prohibited.

## Phase 6 — Multi-locator and generation intelligence

Implemented:

- Multi-operation proposals can be validated and compiled as a workflow plan
  without touching source files.
- Existing deterministic convergence, architecture generation, repository
  profiling, brownfield additive generation, impact selection, clustering, and
  SARIF capabilities remain the execution foundation.

Safety boundary:

- Multi-operation LLM plans are proposal/validation-only until combined
  worktree convergence and assertion-proof semantics are implemented.
- No claim of autonomous one-shot multi-file LLM repair is made by this phase.

## External validation requirement

The configured DeepSeek smoke test currently reaches the provider but returned
HTTP 402. The implementation therefore has local validation, but current live
model acceptance, latency, and proposal-quality metrics must be rerun after
provider quota is available.
