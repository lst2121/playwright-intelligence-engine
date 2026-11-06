# Greenfield and Brownfield Test Architecture Generation

PIE now exposes an architecture-generation layer for teams that need more than an isolated test snippet.

## What it does

`planArchitecture` produces a reviewable plan containing:

- the proposed test, Page Object, fixture, configuration, and CI files;
- deterministic file contents;
- detected or assumed repository conventions;
- assumptions and warnings that require human review;
- create-only actions so existing files are never silently replaced.

Greenfield mode creates a minimal Playwright structure: a config, a feature Page Object, a workflow spec, a fixture entry point, and an optional GitHub Actions workflow.

Brownfield mode consumes the repository profile. It follows the detected test, Page Object, and fixture directories, preserves the existing Playwright configuration, and adds only the feature assets that are missing. If the repository has no profile, the result is marked `PARTIAL` and uses conservative defaults.

## CLI

```text
pw-intel architect "Checkout Flow" --mode greenfield --requirements requirements.json
pw-intel architect "Order Review" --mode brownfield --write
```

`--write` is explicit. Writes are create-only and refuse path traversal. Use `--out report.json` to retain the plan and write result as evidence.

The requirements JSON may contain `baseUrl`, `requirements`, `steps`, and `includeCi`. Generated workflows and assertions are scaffolding: the owner must review business outcomes, authentication, test data, and environment setup before execution.

## MCP

The `plan_test_architecture` tool returns the same plan. Its `write` argument defaults to false; setting it to true creates only missing files under the MCP workspace boundary.

This layer deliberately does not claim that generated tests are correct merely because they compile. A future generation phase should add application-aware requirement extraction, data contracts, live verification, and approval-backed promotion of reviewed generated changes.

Architecture planning and any create-only write are recorded in the tamper-evident `.pw-intelligence/audit.log` with the mode, status, and file counts. The audit record does not include generated source contents.
