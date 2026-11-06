# CI Quality Gates

PIE now exposes `evaluateQualityGate` and the `evaluate_quality_gate` MCP tool.

It also includes a Playwright JSON report adapter. `pw-intel ci-report <playwright-report.json>` converts nested Playwright suites and retries into PIE run observations, failure clusters, stability summaries, Markdown evidence, and GitHub Actions annotations. The equivalent MCP tool is `ingest_playwright_report`.

The adapter preserves a key distinction: it records a failed test as `TEST_FAILURE`, but does not pretend to know whether the root cause is a locator, application defect, environment issue, or timing problem. Trace diagnosis and other evidence sources can refine that category later. A raw failed test still fails the CI gate, while flaky and high-severity evidence remains visible and can produce an abstention outcome.

CI ingestion is also appended to the tamper-evident `.pw-intelligence/audit.log` with counts and gate status; raw test output and secret-bearing payloads are not copied into the audit event.

Example:

```text
pw-intel ci-report playwright-report.json --repository checkout --out pie-ci-evidence.json
```
The gate combines failure clusters, flaky-test summaries, blocked results,
business-oracle availability, and repair verification outcomes.

Statuses:

- `PASS`: no blocking or unresolved risk was supplied.
- `FAIL`: critical failures or failed repairs were detected.
- `ABSTAIN`: risk evidence exists but a definitive release decision requires
  review, such as unavailable oracles, high-severity failures, or flakiness.
- `BLOCKED`: required execution or environment evidence is unavailable.

This is a deterministic policy layer. It does not silently turn abstentions or
blocked evidence into passing results.
