# Phase 4 Evidence — Provider-Neutral LLM Contract

## Implemented

- Added redaction-aware `EvidenceBundleSchema`.
- Added strict `LlmRepairProposalSchema`.
- Added JSON parsing and schema validation for model output.
- Rejected malformed proposals and contradictory `ABSTAIN` proposals.
- Kept the provider boundary free of OpenAI/cloud dependencies.
- Added an OpenAI-compatible HTTP provider that still returns proposals only
  through the PIE schema gate.
- Added an Anthropic Messages-compatible provider with the same strict proposal
  boundary and redaction requirements.
- Added optional provider usage telemetry for token counts, estimated cost, and
  request latency.
- Added a redaction-attested evidence-bundle builder.
- Added a bounded repair-proposal agent that runs deterministic classification
  first, refuses model calls for hard abstentions, validates proposal semantics,
  and never executes or promotes model output.
- Added a protocol-v2 reasoning-and-action loop with strict `STEP` and `FINAL`
  responses, an explicit schema contract in the provider prompt, fenced-JSON
  recovery, allowlisted PIE action handlers, a six-step maximum, no-progress
  termination, an elapsed-time budget, and per-step audit records.
- Added generic response-envelope normalization for explicitly recognized
  transport metadata (`callId`, request/response IDs, model/provider, finish
  reason, and usage). These fields are captured as sanitized metadata before
  strict validation; all other unknown response fields remain rejected.
- Added redacted diagnostic summaries to evidence bundles so an optional
  provider receives useful action, DOM, network, and console context without
  receiving unredacted evidence.
- Added bounded project-intelligence context to proposal bundles: locator
  conventions, Page Object/fixture usage, domain vocabulary, and historical
  selector reliability when available. This is metadata, not unrestricted
  repository source access.
- Added compact follow-up evidence and bounded Page Object source snippets.
- Added a high-confidence single-shot proposal path.
- Added an explicit, host-allowlisted browser-state observation action.
- Added a bridge that sends validated LLM operations through the deterministic
  repair workflow.
- Added `propose_repair` as a bounded MCP workflow backed by an optional
  OpenAI-compatible endpoint configured through `PIE_LLM_ENDPOINT` and
  `PIE_LLM_MODEL`.

## Safety boundary

The model cannot edit files, execute commands, approve repairs, or bypass the
deterministic verifier. It may only return structured hypotheses.

## Verified

- Valid locator proposal accepted by tests.
- Mutation proposal rejected when the model declares abstention.
- Environment failures do not cross the model boundary.
- Unredacted bundles are rejected before provider invocation.
- Model proposals that conflict with deterministic classification are rejected.
- Compatibility category aliases are normalized before proposal/classification
  comparison, while the original model label remains available for reporting.
- Bounded loop can execute a source-mapping observation before accepting a final
  schema-validated proposal.
- Trace-to-proposal workflow returns `MODEL_NOT_CONFIGURED` without invoking a
  provider when no endpoint is configured.

## Deferred

- Multimodal model calls and richer redacted artifact summaries.
- Model-quality evaluation against the external repository testbed.
- Multi-operation worktree execution remains deferred until combined
  convergence and assertion-proof semantics are implemented.

