---
name: pie-release-readiness
description: Produce a release-readiness report for a Playwright repository using PIE suite health, failure clusters, impacted tests, and verification evidence.
---

# PIE Release Readiness

Run repository profile, suite-health, failure clustering, and impacted-test
analysis. Report:

- total tests and impacted tests;
- new failures and root-cause clusters;
- flaky-test changes;
- duration regressions;
- blocked or environment failures;
- proposed repairs and their evidence state;
- business-oracle status;
- unresolved evidence.

Do not declare release readiness solely from a green test count. A release is
not ready when critical business tests are failing, required evidence is
missing, or a repair is only proposal-only.
