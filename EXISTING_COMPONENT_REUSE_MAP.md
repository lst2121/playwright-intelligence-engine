# Existing Component Reuse Map

**Branch:** `feature/evidence-driven-generation` (branched from `pie-v3.3-frames-drift` @ `b8e7ef2`)  
**Audit Date:** 2026-11-12

This document maps existing PIE modules to their target responsibilities in the evidence-driven generation architecture so no duplicate collectors, evidence frameworks, or browser drivers are introduced.

---

## 1. Existing Collectors & Perception (Reuse & Extend)

| Existing File | Current Role & Verified Symbols | Target Reuse / Extension |
|---|---|---|
| `src/collectors/static-ast-collector.ts` | `StaticAstCollector` using `ts-morph` (`Project`, `SyntaxKind`) to extract imports, classes, locators, actions, and assertions into `UnifiedEvidenceRecord[]`. | Extend for monorepo application source discovery (routes, JSX/TSX forms, inputs, validation schemas, API calls) and brownfield fixture/POM symbol inspection without adding another parser. |
| `src/collectors/git-diff-collector.ts` | `GitDiffCollector` executing `git log -n 5` and `git diff --name-only` with `EvidenceRedactor`. | Feed changed files, commits, and diff context directly into Phase 1 workflow/scenario planning so vague tickets still produce grounded scenarios. |
| `src/collectors/network-collector.ts` | `NetworkCollector` normalizing `RawNetworkEvent[]` with header/URL/postData redaction and HTTP error flagging (`status >= 400`). | Connect directly to Playwright `page.on('request'/'response')` in Phase 2 `InteractiveWorkflowRunner` to record API evidence (`PASS`/`FAIL`/`NOT_VERIFIED`). |
| `src/perception/app-model.ts` | `AppElementSchema`, `AppRouteSchema`, `AppModelSchema` (Zod v4). | Keep backward compatible for Tier-L1; feed observed elements into the unified exploration bundle. |
| `src/perception/crawler.ts` | `AppCrawler` launching Chromium (with optional `storageState`), extracting elements/frames/links and caching per baseURL+fingerprint. | Reuse frame extraction (`extractFrameSelector`), cache keying (`computeCacheKey`), and Playwright dynamic resolution as foundation for stateful exploration. |

---

## 2. Existing Browser Execution & Safe Operation Primitives (Reuse & Extend)

| Existing File | Current Role & Verified Symbols | Target Reuse / Extension |
|---|---|---|
| `src/reproduce/direct-browser-investigator.ts` | `DirectBrowserInvestigator` dynamically importing `@playwright/test`, launching headless Chromium, capturing DOM/ARIA snapshots via `LiveBrowserCollector`, verifying locators via `LiveLocatorVerifier`, and executing safe operations. | Reuse browser launch, redaction, DOM/ARIA capture, and locator uniqueness checking patterns inside `InteractiveWorkflowRunner` (single browser session with action checkpoints). |
| `src/repair/browser-operation-executor.ts` | `executeBrowserOperation` enforcing `allowInteraction` and verifying `LocatorPlan` via `LiveLocatorVerifier` before clicking/waiting. | Reuse allowlisted interaction & `LiveLocatorVerifier.verify()` (`count === 1`, `isVisible`, `isEnabled`) during exploratory step verification. |
| `src/selector/live-locator-verifier.ts` | `LiveLocatorVerifier.resolveLocator()` & `verify()` supporting `getByRole`, `getByTestId`, `getByLabel`, `getByPlaceholder`, `getByText`. | Reuse to establish locator uniqueness (`matchCount === 1`) and ground evidence references before code generation. |

---

## 3. Existing Evidence, Intelligence & Naming Infrastructure

| Existing File | Current Role & Verified Symbols | Target Reuse / Extension |
|---|---|---|
| `src/intelligence/evidence-bundle.ts` | `buildEvidenceBundle()` returning strict `EvidenceBundleSchema` (`src/intelligence/llm-proposal.ts`) for redacted diagnostic repair bundles. | Preserve `EvidenceBundleSchema` strict repair contract untouched; add unified Generation Exploration & Context Bundle schemas/helpers in `evidence-bundle.ts` so there is one central evidence owner. |
| `src/intelligence/business-intent.ts` | `extractBusinessIntent()`, `BusinessOracleRegistry`, action/risk heuristics. | Extend into multi-input requirement decomposition & scenario risk tagging without breaking repair `BusinessOracleRegistry`. |
| `src/intelligence/test-intelligence.ts` | `buildTestIntelligencePlan()`, Jaccard similarity coverage & duplicate detection. | Upgrade into capability/action/assertion-aware scenario coverage reconciliation feeding `workflow-plan.json`. |
| `src/intelligence/repository-profile.ts` | `buildRepositoryProfile()`, `extractBaseUrlFromConfigs()`, locator counts, path confidence, up to 2 POM exemplars. | Preserve convention profiling; add Brownfield Repository Graph (exported `base.extend` fixtures, dependencies, barrel re-exports, POM methods, auth projects, `storageState`, `tsconfig` aliases). |
| `src/authoring/naming/naming-linter.ts` | `NamingLinter.lint()` checking casing, reserved words, generic names, duplicate symbols, index-derived identifiers. | Keep enforced across both Tier-L1 `HybridAuthor` and Tier-L2 `LlmAuthor` outputs. |
| `src/generator/assertion-quality-gate.ts` | `AssertionQualityGate.evaluate()` checking assertion count, state matchers, and feature-name heading echoes. | Preserve and expand to catch constant assertions, value-echo assertions, empty/skipped tests, and missing scenario assertions. |

---

## 4. Protected Repair, AST, Worktree & Transport Modules (Preserve Untouched Core)

| Module / Directory | Preserved Responsibility |
|---|---|
| `src/diagnostics/` (`failure-classifier.ts`, `evidence-correlator.ts`, `diagnostic-report.ts`) | Preserved untouched (`14/14` testbed families, `1.0` accuracy); called during Stage 2 execution-failure diagnosis. |
| `src/repair/` (`ast-patcher.ts`, `intent-validator.ts`, `assertion-hasher.ts`, `diff-allowlist.ts`, `repair-planner.ts`, `repair-workflow.ts`) | Preserved untouched; used as the bounded repair engine for Stage 2 automation fixes while keeping assertions immutable. |
| `src/sandbox/` (`worktree-manager.ts`, `execution-runner.ts`, `dependency-strategy.ts`) | Preserved untouched; runs isolated worktree static validation, Playwright execution, repair, and mutation falsification. |
| `src/authoring/hybrid-author.ts` & `src/authoring/template-author.ts` | Preserved as deterministic Tier-L1 fallback when no LLM provider is configured or Tier-L1 is requested. |
| `src/generator/architecture-generator.ts` | Preserved for deterministic Tier-L1 planning/rendering & helper functions (`toSlug`, `toClassName`, `renderLocator`), decoupled from overwriting Tier-L2 `LlmAuthor` files. |
| `src/mcp/server.ts` & `src/cli/index.ts` | Preserved existing tools/commands; extend non-breakingly with workflow planning, exploration, Tier-L2 generation, QA report, and zero-MCP operation. |
