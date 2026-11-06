# Real-Repository Classification Hardening

The first external-repository evaluation showed a useful split in PIE’s
behavior: ingestion, latency, determinism, and safe abstention were strong,
while root-cause classification was immature. This hardening slice addresses
the deterministic evidence layer before model-assisted reasoning is activated.

## Changes

- Added `ENVIRONMENT_FAILURE` for connection refusal/reset and unreachable
  service evidence, including `ECONNREFUSED` and
  `net::ERR_CONNECTION_REFUSED`.
- Added explicit categories for `OBSTRUCTED_ELEMENT`, `DISABLED_ELEMENT`,
  `FRAME_OR_IFRAME`, and `HYDRATION_OR_TIMING`.
- Added actionability evidence matching for pointer interception, disabled
  controls, frame context failures, and explicit hydration/readiness signals.
- Changed failed-action selection from “first error wins” to a deterministic
  actionable-candidate ranking. A selector-bearing browser action outranks an
  earlier fixture/hook error when both are present.
- Preserved standalone trace `error` records instead of silently falling back
  to an unknown action.
- Kept all new categories fail-closed; they explain the failure but do not
  authorize a source mutation.

## Evaluation interpretation

The external testbed must be corrected and rerun before these changes can be
given a new empirical accuracy score. In particular, mutation variants that
produce `ReferenceError: page is not defined`, missing failed actions, or
metadata/runtime-category disagreement must be marked invalid or unresolved,
not counted as valid browser failure ground truth.

The LLM layer remains proposal-only. Deterministic evidence extraction and
negative-control classification run first; a future agent loop may ask a model
to interpret genuinely ambiguous evidence only after this layer produces a
complete, redacted evidence bundle.
