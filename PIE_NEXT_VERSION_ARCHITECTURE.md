# PIE Next-Generation Architecture Specification

**Status:** IMPLEMENTED & EMPIRICALLY VALIDATED  
**Engine Repository:** `D:\Work\playwright-intelligence-engine`  
**Target Milestone:** PIE Tier-L2 Evidence-Driven Generation & Verification Platform  
**Runtime Compatibility:** Node `>=20` (`v24.19.0` verified), TypeScript `5.x`, Playwright `^1.64.1`  
**Primary Interfaces:** CLI (`pw-intel qa`), MCP Server (`run_qa_pipeline`), Native TypeScript SDK (`runEvidenceDrivenGeneration`)

---

## 1. Architectural Philosophy & Executive Overview

Prior to this version, PIE excelled at **post-facto diagnosis and AST-based locator repair** across 14 failure families with 100% precision on structural DOM mutations. However, code generation was bounded by a deterministic template engine (`HybridAuthor` / `architecture-generator.ts`) that produced scaffolding from static prompts without prior runtime exploration. Furthermore, candidate proposal files were discarded in favor of re-running the deterministic planner.

The next-generation PIE architecture evolves into an **evidence-driven, four-phase, three-persisted-artifact QA intelligence platform**. It establishes a strict engineering contract:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PIE DUAL-RESPONSIBILITY PRINCIPLE                    │
├───────────────────────────────────┬────────────────────────────────────┤
│           PROBABILISTIC           │           DETERMINISTIC            │
│            LLM AUTHOR             │        ENGINEERING AUTHORITY       │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Senior Playwright SDET role     │ • Strict JSON contract validation  │
│ • Full TypeScript multi-file code │ • Naming linter & Quality gates    │
│ • POM design & domain logic       │ • Transactional CandidateWriter    │
│ • Explicit assumptions & matrix   │ • Native Chromium exploration      │
│ • Zero ungrounded speculation     │ • Isolated worktree execution      │
│                                   │ • Trace-guided bounded repair      │
│                                   │ • Mutation falsification (Level C) │
│                                   │ • Strict assertion preservation    │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 2. The Four-Phase Execution Pipeline

```
                               Requirement Intake
    (Plain Text | Markdown | JSON | Jira Adaptor | Git Diff | Commit History)
                                       │
                                       ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 1: REQUIREMENT UNDERSTANDING & WORKFLOW PLANNING                │
  │ • extractBusinessIntent() + GitDiffCollector.extractDiffHints()       │
  │ • Category tagging (happy-path, validation, persistence, auth)         │
  │ • Artifact 1A: workflow-plan.json (Canonical Plan + PlanHash)          │
  │ • Artifact 1B: <feature>.feature (Reviewable Gherkin)                  │
  │ • Stale detection & human round-trip edit importer                     │
  └────────────────────────────────────┬───────────────────────────────────┘
                                       │
                                       ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 2: STATEFUL LIVE EXPLORATION & VERIFICATION                     │
  │ • InteractiveWorkflowRunner (Native Playwright single-session)         │
  │ • Multi-route discovery sweep & interactive control indexing           │
  │ • LiveLocatorVerifier (role, label, placeholder, testId uniqueness)    │
  │ • NetworkCollector & console telemetry (URL secrets redacted)          │
  │ • 4-Layer verification: UI | API | CLIENT_RELOAD | DB                  │
  │ • Artifact 2: exploration-evidence.json (ExplorationContextBundle)     │
  └────────────────────────────────────┬───────────────────────────────────┘
                                       │
                                       ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 3: EVIDENCE-GROUNDED FULL-CODE GENERATION                       │
  │ • Tier-L2: LlmAuthor (OpenAiCompatibleFullCodeProvider / FullProposal) │
  │ • Tier-L1 Fallback: Exploration-grounded deterministic synthesis       │
  │ • CandidateWriter.apply(): symlink, traversal, CREATE/MODIFY checks    │
  │ • Zero duplicate configs, zero hardcoded credentials, zero sleeps      │
  └────────────────────────────────────┬───────────────────────────────────┘
                                       │
                                       ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 4: THREE-STAGE VERIFICATION & QA REPORTING                       │
  │ • Stage 1: Static validation (tsc --noEmit, Playwright discovery)      │
  │ • Stage 2: Isolated Execution, Trace Diagnosis & Bounded Repair        │
  │            (Enforces assertionsPreserved() invariant)                  │
  │ • Stage 3: Mutation Falsification (Level C Assertions + Level B Fault) │
  │ • Artifact 3A: qa-report.json                                          │
  │ • Artifact 3B: qa-report.md                                            │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Three Core Persisted Artifacts

### Artifact 1: Workflow Plan & Gherkin (`workflow-plan.json` & `.feature`)
- **JSON Schema:** `GenerationWorkflowPlanSchema`
- **Purpose:** Machine-readable requirement breakdown with stable scenario IDs (`sc-req-1-happy-path`), precondition lists, ordered steps, expected outcomes, and SHA-256 `planHash`.
- **Review Layer:** Human-reviewable standard Gherkin. When a QA engineer modifies the `.feature` file, `importGherkinToWorkflowPlan()` validates edits, detects structural changes, and regenerates the canonical plan without losing requirement traceability.

### Artifact 2: Exploration Context Bundle (`exploration-evidence.json`)
- **JSON Schema:** `ExplorationContextBundleSchema`
- **Purpose:** The empirical source of truth. Contains verified locator candidates (`strategy`, `expression`, `matchCount`, `confidence`), routes visited, network traffic (`method`, `status`, `resourceType`), console errors, multi-layer verification statuses, and observed passive findings (`OBSERVED_BEHAVIOR`, `SPEC_VIOLATION`, `RUNTIME_ERROR`).
- **Privacy & Redaction:** Sensitive query parameters (`token=`, `key=`, `secret=`) and authorization headers are sanitized via `sanitizeUrlSecrets()` and `EvidenceRedactor.redactText()`.

### Artifact 3: Final QA Verification Suite & Report (`qa-report.json` & `qa-report.md`)
- **JSON Schema:** `QaReportSchema`
- **Purpose:** Comprehensive verification audit. Contains static compiler checks, test execution status, trace failure classifications, repair audit logs (with proof of assertion preservation), mutation falsification scorecard (`killed`, `survived`, `mutationScore`), layer summaries, and findings.

---

## 4. Key Subsystems & Source Components

| Subsystem | Source Path | Key Classes & Functions | Responsibility |
|---|---|---|---|
| **Authoring Contract** | `src/authoring/generation-contract.ts` | `FullGenerationProposalSchema`, `validateFullGenerationProposal`, `buildTierL2SystemPrompt` | Validates multi-file proposals, forbids sleeps/constant assertions. |
| **Tier-L2 Author** | `src/authoring/llm-author.ts` | `LlmAuthor`, `OpenAiCompatibleFullCodeProvider` | Full-code TypeScript authoring with automatic `HybridAuthor` fallback. |
| **Candidate Writer** | `src/generator/candidate-writer.ts` | `CandidateWriter.apply()`, `CandidateWriter.rollback()` | Transactional disk modification with snapshots, symlink & import checks. |
| **Workflow Planner** | `src/intelligence/workflow-planner.ts` | `buildWorkflowPlan()`, `exportWorkflowToGherkin()`, `importGherkinToWorkflowPlan()` | Ingests text/markdown/JSON/diff hints; handles Gherkin round-trip. |
| **Brownfield Graph** | `src/intelligence/repository-profile.ts` | `buildBrownfieldRepositoryGraph()` | Discovers fixtures, POMs, aliases, configs, and prevents duplicate fixtures. |
| **Interactive Runner** | `src/reproduce/interactive-workflow-runner.ts` | `InteractiveWorkflowRunner.run()`, `LiveLocatorVerifier` | Native Playwright single-session browser explorer & action checkpointer. |
| **Evidence Bundle** | `src/intelligence/evidence-bundle.ts` | `saveExplorationContextBundle()`, `sanitizeUrlSecrets()` | Serializes and redacts exploration evidence for generation and audit. |
| **Generation Verifier** | `src/intelligence/generation-verifier.ts` | `runEvidenceDrivenGeneration()`, `assertionsPreserved()` | Orchestrates Stages 1–3, repair bounds, mutation testing, and QA reports. |
| **Assertion Gate** | `src/generator/assertion-quality-gate.ts` | `AssertionQualityGate.evaluate()` | Rejects constant, empty, echoed, and placeholder tests. |
| **CLI & MCP** | `src/cli/index.ts`, `src/mcp/server.ts` | `pw-intel qa`, `run_qa_pipeline` tool | Surfaces 4-phase generation pipeline over CLI and Model Context Protocol. |

---

## 5. Security, Invariant Safety & Zero-MCP Model

1. **Zero Mandatory MCP Dependencies:** All browser exploration, DOM analysis, network tracing, and execution runners run on native Node.js and Playwright. No external MCP tools or proprietary cloud dependencies are required.
2. **Assertion Preservation Invariant:** The repair engine checks every candidate repair patch against `assertionsPreserved()`. Any patch that deletes assertions, softens exact text matchers, or substitutes generic `body` checks is immediately rejected with `intentInvariantPreserved: false`.
3. **Application Defect Immunity:** HTTP 500 responses and backend crashes are classified as `application` defect ownership and halt auto-repair immediately, preventing tests from being modified to accommodate server bugs.
4. **Isolated Worktrees & Disposable Workspaces:** Pristine repositories under `repositories/` are read-only. All exploration, compilation, test execution, and mutation testing run strictly in disposable workspaces or isolated Git worktrees.
