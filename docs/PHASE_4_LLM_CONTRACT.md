# Phase 4 Evidence — Provider-Neutral LLM Contract

## Implemented

- Added redaction-aware `EvidenceBundleSchema`.
- Added strict `LlmRepairProposalSchema`.
- Added JSON parsing and schema validation for model output.
- Rejected malformed proposals and contradictory `ABSTAIN` proposals.
- Kept the provider boundary free of OpenAI/cloud dependencies.
- Added an OpenAI-compatible HTTP provider that still returns proposals only
  through the PIE schema gate.
- Added a redaction-attested evidence-bundle builder.
- Added a bounded repair-proposal agent that runs deterministic classification
  first, refuses model calls for hard abstentions, validates proposal semantics,
  and never executes or promotes model output.
- Added redacted diagnostic summaries to evidence bundles so an optional
  provider receives useful action, DOM, network, and console context without
  receiving unredacted evidence.
- Added bounded project-intelligence context to proposal bundles: locator
  conventions, Page Object/fixture usage, domain vocabulary, and historical
  selector reliability when available. This is metadata, not unrestricted
  repository source access.
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
- Trace-to-proposal workflow returns `MODEL_NOT_CONFIGURED` without invoking a
  provider when no endpoint is configured.

## Deferred

- Multimodal model calls and richer redacted artifact summaries.
- Cost, latency, and model-quality evaluation.
- Worktree execution and approval orchestration after a proposal is received.

