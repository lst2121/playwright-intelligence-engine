# PIE Generation Guide — Requirements, Gherkin & Authoring

This guide covers requirement intake, workflow planning, human-in-the-loop Gherkin editing, Tier-L2 LLM full-code authoring, Tier-L1 fallback, and brownfield repository conventions.

---

## 1. Quickstart: CLI Execution (`pw-intel qa`)

The unified `pw-intel qa` command drives the full four-phase workflow (plan, explore, generate, verify, and falsify):

```bash
# Greenfield example using Markdown requirements and live browser exploration
pw-intel qa "Todo Task Management" \
  --workspace ./my-app \
  --url http://127.0.0.1:5173/todo-app/ \
  --markdown ./requirements.md \
  --author llm \
  --out ./artifacts/qa-report.json
```

### Supported CLI Flags
| Flag | Description | Default |
|---|---|---|
| `<featureName>` | Human-readable name of the target workflow | Inferred if omitted |
| `--workspace <dir>` | Path to target test or monorepo root | `process.cwd()` |
| `--url <baseUrl>` | Live URL for Phase 2 browser exploration | Static-only if omitted |
| `--requirements <path>` | `.json`, `.feature`, or `.md` requirements file | — |
| `--markdown <path>` | Markdown specification document | — |
| `--gherkin <path>` | Existing `.feature` file to import directly | — |
| `--prompt <text>` | Inline requirement string | — |
| `--diff` | Enrich planning using `GitDiffCollector` | `false` |
| `--author template\|hybrid\|llm` | Authoring tier selection | `hybrid` |
| `--out-dir <dir>` | Output artifact folder for plans/evidence | `.pie/` |
| `--storage-state <path>` | Pre-authenticated Playwright `storageState.json` | — |
| `--allow-mutating` | Permit create/submit form exploration actions | `true` on localhost |
| `--no-write` | Dry-run (plans & reports only, skips writing tests) | `false` |
| `--no-verify` | Skip execution, trace repair & mutation stages | `false` |
| `--no-mutate` | Skip Stage 3 mutation falsification | `false` |

---

## 2. Requirement Intake Formats

`buildWorkflowPlan()` in [src/intelligence/workflow-planner.ts](file:///D:/Work/playwright-intelligence-engine/src/intelligence/workflow-planner.ts) normalizes five distinct intake formats into one canonical representation (`workflow-plan.json`):

1. **Markdown (`markdown`):** Extracts `# Heading` as feature title and bullet points (`- User can...`) into structured requirements with risk levels and acceptance criteria.
2. **JSON (`jsonRequirements`):** Consumes structured requirement arrays (`[{ id, title, description, acceptanceCriteria, risk }]`).
3. **Plain Prompt (`prompt` / `text`):** Parses unstructured descriptions without inventing unsupported outcomes.
4. **Jira / Issue Objects (`jiraIssue`):** Optional adapter mapping (`summary`, `description`, `acceptanceCriteria`)—never mandatory.
5. **Git Diff Enrichment (`--diff`):** `GitDiffCollector.extractDiffHints()` inspects changed routes (`/products`, `/checkout`), changed functions/classes, API paths (`/api/*`), and validation patterns (`.min()`, `.required`) to tag high-risk regression scenarios as `diff-derived`.

---

## 3. Gherkin Review & Round-Trip Editing

1. PIE writes canonical [workflow-plan.json](file:///D:/Work/playwright-intelligence-engine/samples/evidence-driven-qa/workflow-plan.json) and exports human-readable `.feature` files (e.g., [todo-task-management.feature](file:///D:/Work/playwright-intelligence-engine/samples/evidence-driven-qa/todo-task-management.feature)).
2. A QA engineer can edit scenarios, add custom `@priority-P1` tags, refine steps, or remove inapplicable cases.
3. Passing the edited `.feature` file via `editedFeatureText` or `--gherkin`:
   - `isStaleWorkflowPlan()` detects changes via hash comparison.
   - `importGherkinToWorkflowPlan()` maps edits back into the canonical plan, reporting any syntax errors cleanly rather than silently regenerating from stale requirements.

---

## 4. Authoring Modes: Tier-L2 vs. Tier-L1 Fallback

### Tier-L2 Full-Code LLM Author (`--author llm`)
- Implemented by `LlmAuthor` and `OpenAiCompatibleFullCodeProvider` ([src/authoring/llm-author.ts](file:///D:/Work/playwright-intelligence-engine/src/authoring/llm-author.ts)).
- Configured via environment variables:
  ```powershell
  $env:PIE_LLM_API_KEY="sk-..."
  $env:PIE_LLM_ENDPOINT="https://api.deepseek.com/chat/completions" # or any OpenAI-compatible endpoint
  $env:PIE_LLM_MODEL="deepseek-chat"
  ```
- Note: In Vitest runs, network LLM calls are isolated offline by default (`!process.env.VITEST || process.env.PIE_LIVE_LLM_TESTS === '1'`).
- The LLM emits a strict `FullGenerationProposal` JSON contract (`schemaVersion: "1.0"`) containing full TypeScript Page Objects, fixtures, helpers, and multi-assertion specs with explicit `evidenceReferences` and `scenarioIds`.
- Proposals violating constraints (arbitrary `waitForTimeout()`, hardcoded tokens, unknown evidence IDs, duplicate `playwright.config.ts`) are blocked before disk write.

### Tier-L1 Deterministic Fallback (`--author hybrid` or fallback)
- If no LLM key is present, the endpoint fails, or Tier-L2 is omitted, `runEvidenceDrivenGeneration()` synthesizes an **exploration-grounded deterministic POM & spec suite** directly from verified locators inside `ExplorationContextBundle`, or falls back to `HybridAuthor` / `architecture-generator.ts`.

---

## 5. Brownfield vs. Greenfield Behavior

`buildBrownfieldRepositoryGraph()` ([src/intelligence/repository-profile.ts](file:///D:/Work/playwright-intelligence-engine/src/intelligence/repository-profile.ts)) scans the workspace before generation:
- **Greenfield Mode (`configPaths.length === 0`):** Generates a clean `playwright.config.ts`, composable feature fixture (`tests/fixtures/app.fixtures.ts`), POM class, and spec suite.
- **Brownfield Mode (existing Playwright infrastructure):** Discovers `playwright.config.ts`, `base.extend` fixture files (`tests/fixtures/index.ts`), existing POMs (`LoginPage`, `ProductPage`), `tsconfig.json` path aliases, and `NodeNext`/ESM `.js` relative import requirements. PIE injects the existing custom fixtures into new specs and skips emitting duplicate configs or auth scaffolding.

---

## 6. Known Generation Limitations

1. **Multi-step authenticated exploration:** Complex multi-page checkout flows requiring authenticated cookies benefit from `--storage-state` or an explicit `loginConfig`; anonymous exploration of multi-page apps resets shared guest carts unless isolated per test via `beforeEach`.
2. **ESM `NodeNext` strictness:** Generated `.ts` imports must keep explicit `.js` suffixes for strict `tsconfig` compliance (enforced in the Tier-L2 prompt contract and verified by Stage 1 `tsc`).
3. **Abstention on ungrounded controls:** When exploration cannot verify target locators (e.g., behind unconfigured login walls), compliant Tier-L2 models intentionally return `NEEDS_INPUT` or `ABSTAIN` rather than guessing selectors.
