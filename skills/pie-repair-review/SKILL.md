---
name: pie-repair-review
description: Review PIE repair proposals for intent preservation, evidence quality, isolation, regression safety, and approval readiness.
---

# PIE Repair Review

Review the proposed operation and diff in this order:

1. Failure category is eligible for repair.
2. Target identity matches the failed action.
3. Locator grammar is allowlisted.
4. Candidate is unique and actionable.
5. Assertions and test structure are unchanged.
6. Fixtures and business intent are preserved.
7. Target test passed in an isolated worktree.
8. Affected regression tests passed.
9. Required business oracles are verified.
10. Human approval is present before promotion.

If any required evidence is absent, mark the proposal not ready for approval.
