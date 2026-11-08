# PIE Product Baseline

This is the canonical baseline for the current repository state. Historical audit
documents may describe earlier milestones and are not authoritative for current
counts or commands.

## Identity

- Package version: `1.0.0`
- Engineering milestone: `3.0.0-rc1`
- Runtime: Node.js 20+
- Primary framework: Microsoft Playwright

## Current capability boundary

PIE currently provides deterministic, local-first workflows for:

- Playwright trace archive parsing;
- action-anchored failure classification;
- DOM and accessibility evidence analysis;
- live browser reproduction;
- Playwright trace compatibility for formats 4 through 10;
- locator candidate extraction and live uniqueness verification;
- constrained TypeScript Page Object AST patching;
- isolated worktree execution;
- intent and diff validation;
- approval-gated workspace promotion;
- trace-to-repair proposal workflow through CLI and MCP;
- allowlisted frame/Shadow locator operation proposals;
- live browser verification for typed locator/frame/Shadow operations;
- live verification for a constrained state-wait operation vocabulary;
- repository-aware changed-file impact analysis;
- SARIF CI output and local team dashboard aggregation;
- CLI, MCP, and test-generation entry points;
- decoupled Author / Gate architecture with 3-tier capability ladder (L0: Template, L1: Hybrid, L2: LLM);
- semantic NamePlan symbol table and NamingLinter with 0 index-derived identifiers;
- runtime convention discovery (.pie/conventions.json) and exemplar extraction;
- bounded generation agent loop (max 3 steps, max 120s) with AGENT_NO_PROGRESS transition detection.

PIE does not currently provide a managed model service, unrestricted code
generation, or general multi-step workflow repair. An optional OpenAI-compatible
provider workflow exists, requires a caller-supplied endpoint, receives only a
redaction-attested diagnostic bundle, and remains behind deterministic gates.

## Current verification baseline

The repository baseline is verified with:

```bash
npm run verify:baseline
```

This runs typecheck, the automated test suite, and the production build.

The current automated suite contains 531 passing tests across 53 test files.

The current controlled browser artifact contains 125 scenarios:

- 5 clean baselines;
- 60 positive mutation scenarios;
- 60 negative-control scenarios;
- reported Tier 2 repair precision: 96.7%;
- reported Tier 2 repair recall: 96.7%;
- reported safe abstention: 100%;
- reported false-repair rate: 0%.

These results describe the controlled benchmark only. They are not a claim of
universal production reliability and must be supplemented by the external
repository testbed.

## MCP surface

The current MCP server registers:

- `diagnose_trace`;
- `repair_trace`;
- `repair_page_object`;
- `generate_playwright_test`;
- `get_product_status`.

The documented surface must be updated whenever the registered tools change.

