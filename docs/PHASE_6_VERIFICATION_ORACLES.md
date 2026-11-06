# Phase 6 Evidence — Verification and Oracle Gates

## Implemented

- Added explicit verification-gate evaluation.
- Promotion gates now model execution, target identity, assertions, fixtures,
  diff allowlist, regression, operation validation, and business-oracle status.
- Added strict mode requiring a verified business oracle.
- Contradicted business-oracle results always block promotion.
- Isolated repair verification now evaluates the built-in execution and
  assertion-preservation oracles and includes their result evidence in the
  verification result. Missing assertion source remains `unavailable`.

## Verified

- Tests prove that unavailable business-oracle evidence blocks promotion when
  strict oracle mode is enabled.
- Existing approval and CAS controls remain unchanged.
- The built-in oracle aggregation is covered by unit tests and does not claim
  domain truth beyond test execution and assertion preservation.

## Deferred

- Domain-specific oracle adapters.
- Independent application-state checks for every external repository.

