# PIE Capabilities and Future Roadmap

## Document purpose

This document describes what the Playwright Intelligence Engine (PIE) can do
today, how its current architecture works, where its boundaries are, and what
it should become through the next development stages.

The goal is to keep the product direction honest: deterministic capabilities
must be distinguished from optional LLM capabilities, implemented workflows
must be distinguished from planned workflows, and proposed repairs must remain
separate from verified changes.

This document reflects the architecture at commit `89c0594`:

```text
fix(llm): normalize envelopes and stop stalled agent loops
```

PIE is currently a release-candidate system for deterministic diagnosis and
safe repair validation. It is not yet a fully autonomous test-generation
platform.

## 1. Product definition

PIE is a Playwright reliability and test-intelligence engine that:

1. Ingests Playwright traces and test reports.
2. Builds structured diagnostic evidence.
3. Classifies the most likely failure cause.
4. Abstains when evidence does not support a safe action.
5. Produces deterministic or LLM-assisted repair proposals.
6. Verifies repairs in isolated worktrees.
7. Generates project-aware Playwright scaffolding.
8. Produces CI, audit, and evaluation evidence.

The intended product direction is:

> A repository-aware QA generation agent that plans, writes, executes,
> diagnoses, repairs, and reports while keeping deterministic verification and
> human approval around high-risk actions.

PIE is not intended to be a blind self-healing system that changes assertions
or modifies production repositories whenever a test can be made to pass.

## 2. Current architecture

### 2.1 End-to-end current flow

```text
Playwright trace/report
        |
        v
Trace parsing and version detection
        |
        v
Evidence correlation and causal classification
        |
        +--> hard abstention for environment, backend, auth, assertion,
        |    ambiguity, and unsupported-evidence cases
        |
        v
Repository profile and project intelligence
        |
        v
Redacted EvidenceBundle
        |
        +--> deterministic proposal path
        |
        +--> optional provider proposal path
        |
        +--> optional bounded LLM agent loop
        |
        v
Strict protocol and semantic validation
        |
        v
Deterministic repair workflow
        |
        v
Isolated execution, verification, approval, and promotion
```

### 2.2 Trace and evidence layer

PIE can read Playwright trace archives, discover trace and network entries,
detect supported Playwright trace formats, and assemble diagnostic context from
events such as:

- failed actions;
- selectors and action parameters;
- source locations;
- DOM and accessibility snapshots;
- network events;
- console events;
- frames and frame transitions;
- timing information;
- Playwright error messages and stacks.

Evidence is correlated causally rather than treated as an undifferentiated
error log. Background telemetry and unrelated network errors are separated from
requests that are causally related to the failed action.

### 2.3 Deterministic diagnosis

The deterministic classifier runs before the LLM. It currently recognizes or
handles categories including:

- `LOCATOR_DRIFT`;
- `AMBIGUOUS_MATCH`;
- `OBSTRUCTED_ELEMENT`;
- `DISABLED_ELEMENT`;
- `FRAME_OR_IFRAME`;
- `HYDRATION_OR_TIMING`;
- `TIMING_RACE`;
- `AUTH_EXPIRED`;
- `BACKEND_500`;
- `NETWORK_OFFLINE`;
- `ENVIRONMENT_FAILURE`;
- `ASSERTION_FAILURE`;
- `UNSUPPORTED_TRACE_FORMAT`;
- `INCOMPLETE_EVIDENCE`;
- `UNKNOWN_ERROR`.

Failure aliases from external reports and model responses are normalized to
canonical categories before comparison and scoring.

### 2.4 Safety and abstention

PIE fails closed when it cannot prove a safe action. In particular, it can
stop before a model call for cases such as:

- backend or environment outages;
- expired authentication;
- assertion mismatches;
- missing or incomplete evidence;
- unsupported trace versions;
- ambiguous locator matches;
- non-repairable application failures.

The model is not treated as an authority over deterministic evidence. A model
proposal that conflicts with the deterministic classification or targets the
wrong failed selector is rejected.

### 2.5 Repository and project intelligence

PIE profiles repositories without requiring an LLM. The profile can identify:

- Playwright configuration;
- test directories;
- Page Object directories;
- fixture directories;
- test files;
- Page Objects;
- custom fixtures;
- storage state and authentication patterns;
- package managers and scripts;
- locator conventions;
- domain vocabulary;
- repository structure and confidence levels.

The profile is stored in `.pie/repository-profile.json` and is rebuilt when
the repository fingerprint changes.

### 2.6 EvidenceBundle and provider boundary

Only a redaction-attested `EvidenceBundle` may cross into a model provider.
The bundle can include:

- the failed action;
- failure category;
- redacted error message and stack;
- redacted DOM/accessibility snapshots;
- bounded network and console evidence;
- source snippets and source mappings;
- project conventions;
- historical selector reliability;
- artifact references and limitations.

Secrets, credentials, tokens, and sensitive DOM values are redacted before
provider invocation. Evidence is clipped for follow-up agent steps.

The provider boundary is provider-neutral. PIE supports compatible HTTP
protocols rather than hard-coding a model-specific SDK or adapter for every
vendor.

### 2.7 Current LLM use

The LLM is currently an optional semantic reasoning layer for diagnosis and
repair. It is not yet the primary test-generation engine.

PIE supports two LLM paths:

#### Single-shot path

High-confidence locator drift with a deterministic replacement candidate uses a
single proposal call:

```text
Deterministic diagnosis
        |
        v
Unique candidate discovered
        |
        v
LLM returns structured proposal
        |
        v
PIE validates category, target, operation, and locator
```

#### Bounded agent path

Complex cases can use a bounded reasoning-and-action loop:

```text
STEP: inspect evidence
        |
        v
PIE action handler returns observation
        |
        v
STEP: inspect source, browser state, or candidates
        |
        v
PIE action handler returns observation
        |
        v
FINAL: proposal, abstention, blocked, or rejection
```

The current agent:

- uses a strict `STEP`/`FINAL` protocol;
- supports allowlisted actions;
- has a maximum step count;
- has an elapsed-time safety budget;
- detects repeated actions and unchanged observations;
- normalizes explicitly recognized response-envelope metadata;
- rejects unknown protocol fields;
- validates final proposals against deterministic evidence;
- never directly edits files or approves its own repair.

Its allowlisted tool surface now includes repository profile inspection,
workspace-contained source reads, bounded repository search, ranked locator
candidate inspection, optional browser navigation on explicitly allowed hosts,
and optional targeted Playwright execution. A verified repair can be promoted
only when an explicit auto-promotion policy is supplied; the default remains
approval-gated.

This is a bounded tool-using agent, not an unrestricted autonomous coding
agent.

### 2.8 Current repair boundary

The LLM can propose a repair operation, but the proposal is not a successful
repair by itself. The verified repair workflow remains responsible for:

- operation validation;
- AST-safe patching;
- assertion fingerprint preservation;
- fixture and control-flow checks;
- diff allowlisting;
- isolated worktree execution;
- regression execution;
- business-oracle checks where available;
- approval and promotion.

The current LLM repair workflow is strongest for high-confidence locator drift.
Multi-operation execution remains deliberately constrained until combined
convergence and assertion-proof semantics are stronger.

The autonomous orchestration entry point now connects the bounded model loop
to the deterministic verifier. It can produce a validated proposal and, when
explicitly requested, execute that proposal only in a disposable worktree.
Backend, authentication, assertion, environment, corrupted-trace, and
unsupported-trace failures remain hard-blocked from model repair. Locator
ambiguity and incomplete locator evidence may be escalated to the model when a
DOM snapshot and failed selector are available.

### 2.9 Current generation

PIE currently provides deterministic Page Object and Playwright spec
scaffolding, plus an optional structured generation-agent path. The generation
agent returns scenario plans rather than arbitrary source code; PIE validates
requirement references and locator/assertion targets before deterministic
rendering.

For one feature invocation, current generation normally produces:

#### Greenfield mode

- one Page Object;
- one spec containing one workflow test;
- a Playwright configuration;
- a fixture entry point;
- an optional CI workflow.

#### Brownfield mode

- one Page Object;
- one spec containing one workflow test;
- an optional fixture file when the profile identifies custom fixtures.

Brownfield generation uses repository paths, locator conventions, fixture
signals, and storage-state signals where detected. Existing files are
create-only and are not overwritten automatically.

The current generator supports actions and basic assertions such as:

- click;
- fill;
- navigation;
- visibility checks;
- text checks;
- URL checks in the broader intent model.

Generated assertions are currently scaffolding-level assertions. They are not
yet complete business-domain specifications.

Generation can be run in planned, written, or verified modes. Verification
requires explicit writing and runs each generated spec through Playwright;
failed execution is reported as verification failure rather than being
reported as generated success.

### 2.10 Current business-intelligence layer

PIE can extract conservative intent from requirements and existing tests,
including:

- actions;
- entities;
- expected outcomes;
- existing assertions;
- risk signals;
- fixture and Page Object hints;
- covered, partial, and missing scenarios;
- duplicate-test candidates.

Built-in oracles currently include execution success and assertion preservation.
The architecture supports additional domain-specific business oracles, but the
repository-specific oracle library is not yet complete.

### 2.11 Current learning over time

PIE has project-scoped feedback memory without model training or a vector
database.

The stability ledger at `.pw-intelligence/stability-ledger.json` records:

- selector failures;
- failure categories;
- verified semantic successes;
- accepted repairs;
- rejected repairs and false-repair incidents;
- selector reliability scores;
- time-decayed reliability.

Future proposals can receive this historical reliability as project context.
This is feedback-driven adaptation, not fine-tuning. Current learning is
primarily triggered by explicit diagnosis, verification, and repair-feedback
events; ordinary passing-test ingestion should become more automatic in a
future phase.

### 2.12 Current integrations

PIE currently exposes or supports:

- CLI workflows;
- MCP JSON-RPC server workflows;
- trace diagnosis;
- repair proposal and approval flow;
- Playwright JSON report ingestion;
- CI summaries and annotations;
- repository inspection;
- bounded repository test execution;
- greenfield/brownfield architecture planning;
- test-intelligence coverage planning;
- audit and stability records.

Direct Jira, GitHub Issues, Linear, and other ticket-system adapters are not
yet complete.

## 3. Current limitations

PIE should not currently be described as a universal autonomous QA agent.

Important limitations are:

1. LLM generation of complete test suites is not yet the primary generation
   path.
2. One architecture-generation invocation generally creates one workflow test,
   not a complete scenario matrix.
3. Ticket systems are not directly ingested by a native connector.
4. Business assertions are conservative and often require human refinement.
5. The current locator-ranking observation does not yet expose a rich verified
   candidate table for every ambiguous locator case.
6. Complex variable-built locators, custom wrappers, generated code, and
   unusual monorepo structures may require abstention or project-specific
   adapters.
7. Ordinary passing-test history is not yet ingested as comprehensively as
   explicit repair feedback.
8. Domain-specific business oracles require project configuration or custom
   implementation.
9. Real-application validation of generation and repair remains necessary on
   representative greenfield and brownfield repositories.

## 4. Future product vision

The future PIE generation agent should support this workflow:

```text
Jira issue, GitHub issue, Linear issue, or acceptance criteria
        |
        v
Requirement normalization
        |
        v
Repository discovery and business map
        |
        v
Existing coverage and duplicate analysis
        |
        v
LLM-assisted test-plan proposal
        |
        v
Fixture, Page Object, API, and data-helper mapping
        |
        v
LLM-assisted scenario and assertion proposal
        |
        v
Deterministic code generation in a disposable worktree
        |
        v
Typecheck, lint, and Playwright execution
        |
        v
Trace diagnosis and bounded repair agent
        |
        v
Verified patch, CI evidence, and ticket traceability
        |
        v
Human approval and promotion
```

## 5. Future architecture upgrades

### 5.1 Requirement and ticket ingestion

Add adapters for:

- Jira;
- GitHub Issues and pull requests;
- GitLab issues;
- Linear;
- Markdown and repository requirements;
- JSON acceptance-criteria documents;
- MCP-provided requirements.

All inputs should normalize into a common requirement contract that preserves
source IDs, acceptance criteria, links, actors, preconditions, outcomes,
priority, and traceability.

The LLM should clarify and structure requirements, but must not silently invent
acceptance criteria. Ambiguous requirements should become explicit questions or
reviewable assumptions.

### 5.2 Repository knowledge graph

Extend repository intelligence into a searchable project graph containing:

- source files and symbols;
- routes and pages;
- test files and test titles;
- Page Objects and locator members;
- fixtures and fixture dependencies;
- authentication and storage state;
- API clients and endpoint helpers;
- database and test-data utilities;
- roles and permission helpers;
- assertion patterns;
- CI commands;
- domain entities and vocabulary;
- source-to-test relationships.

This need not begin as a vector database. A deterministic index with symbol,
path, test, fixture, and domain relationships will provide more reliable
retrieval for code generation than unconstrained semantic search.

Embeddings or vector search can be added later as a secondary recall mechanism,
but all retrieved context must retain source provenance.

### 5.3 Multi-scenario test planning

The LLM should produce structured scenarios before code generation:

- happy paths;
- validation failures;
- permission boundaries;
- empty states;
- error states;
- retry and recovery paths;
- browser and viewport variations;
- API and UI consistency checks;
- high-risk business workflows;
- duplicate or already-covered scenarios.

PIE should classify each scenario as:

- covered;
- partially covered;
- missing;
- duplicate;
- blocked by missing evidence;
- requiring human clarification.

### 5.4 Rich locator candidate reasoning

Add read-only candidate enumeration that returns structured information such as:

- candidate ID;
- generated locator expression;
- role;
- accessible name;
- label;
- test ID;
- CSS attributes;
- parent/container context;
- frame context;
- match count;
- visibility and enabled state;
- source or DOM provenance.

The LLM should select a candidate ID, not invent an arbitrary selector. PIE
must re-verify the candidate in the DOM and source before generating a repair.

### 5.5 Business-aware assertion proposals

Introduce a typed assertion proposal model:

```ts
interface AssertionProposal {
  id: string;
  requirementId: string;
  kind: 'visibility' | 'text' | 'url' | 'attribute' | 'api' | 'database' | 'permission' | 'invariant';
  target: string;
  expected: string;
  rationale: string;
  evidenceReferences: string[];
  confidence: number;
  businessOracle?: string;
}
```

The model may propose assertions, but PIE must validate:

- the target exists;
- the assertion is syntactically valid;
- the requirement supports the assertion;
- the assertion does not weaken an existing test;
- expected data is deterministic or properly generated;
- the assertion can be verified by an available oracle.

### 5.6 Business oracle registry

Expand the oracle registry with project-scoped adapters for:

- order creation;
- payment state;
- inventory state;
- email delivery;
- permission boundaries;
- API response contracts;
- database state;
- event publication;
- audit-log creation;
- workflow transitions.

An oracle should return evidence and a status such as:

- verified;
- contradicted;
- unavailable;
- not applicable.

The LLM can recommend an oracle, but only the oracle implementation can claim
that a business condition was verified.

### 5.7 Generation agent and disposable worktrees

The generation agent should have controlled tools for:

#### Read-only tools

- search repository;
- read source files;
- inspect routes and APIs;
- inspect fixtures and Page Objects;
- inspect existing assertions;
- inspect test data and authentication;
- enumerate DOM candidates;
- inspect generated reports and traces.

#### Execution tools

- typecheck;
- lint;
- run one test;
- run one test file;
- run a bounded project command;
- capture trace and report;
- run a business oracle.

#### Write tools

- create files in a disposable worktree;
- modify allowlisted files;
- produce a diff;
- run verification before promotion.

The model should never receive unrestricted production-repository write access.
The generation agent should be allowed to write new tests and proposed
assertions in a disposable worktree because that is required for generation,
but the resulting patch must pass deterministic gates and human review.

### 5.8 Complete generation loop

The target loop is:

```text
Plan
  -> generate
  -> compile
  -> execute
  -> inspect report
  -> diagnose
  -> repair or abstain
  -> execute again
  -> compare assertions and diff
  -> publish evidence
```

The agent should stop with explicit states such as:

- `GENERATED_AND_PASSING`;
- `REPAIRED_AND_VERIFIED`;
- `SAFE_ABSTENTION`;
- `BLOCKED_MISSING_REQUIREMENT`;
- `BLOCKED_MISSING_BUSINESS_ORACLE`;
- `BLOCKED_AMBIGUOUS_LOCATOR`;
- `BLOCKED_COMPILE_FAILURE`;
- `BLOCKED_POLICY_RESTRICTION`.

## 6. LLM responsibility model

### The LLM should handle

- requirement interpretation;
- ambiguity detection;
- scenario expansion;
- existing-test reuse decisions;
- fixture and Page Object selection;
- locator candidate selection;
- business assertion proposals;
- repair hypotheses;
- concise explanations and prioritization.

### PIE should handle deterministically

- trace parsing;
- failure classification;
- candidate extraction and uniqueness checks;
- source mapping;
- file and symbol validation;
- schema validation;
- AST transformations;
- typechecking;
- test execution;
- diff allowlisting;
- assertion preservation;
- worktree isolation;
- business-oracle execution;
- approval and promotion;
- audit records.

This split allows PIE to gain the practical repository reasoning of coding
agents while preserving a verifiable safety boundary.

## 7. Learning and feedback roadmap

PIE should improve over time through verified project feedback:

```text
Run test suite
        |
        v
Record passing and failing selectors
        |
        v
Record repair verification outcomes
        |
        v
Record operator approval or rejection
        |
        v
Update project reliability and conventions
        |
        v
Improve future ranking and generation decisions
```

Future feedback sources should include:

- normal Playwright CI reports;
- flaky-test history;
- repair verification outcomes;
- code-review acceptance or rejection;
- reverted repairs;
- failed generated tests;
- assertion review feedback;
- business-oracle results;
- project convention changes.

This is bounded, repository-scoped learning. It should not silently transfer
assumptions from one repository to another.

## 8. Development roadmap

### Stage A — Release-candidate reliability

- Complete final deterministic and LLM evaluations.
- Run the Juice Shop greenfield workflow.
- Run the Twenty CRM brownfield workflow.
- Verify generated code compilation and execution.
- Verify repairable and non-repairable mutations.
- Confirm zero false repairs.
- Confirm assertion preservation.
- Confirm worktree and provenance integrity.

Release decision: PIE may be released as a deterministic reliability and
repair-candidate product only when these gates pass.

### Stage B — Generation contracts

- Add requirement, scenario, assertion, and generation-plan schemas.
- Connect test-intelligence planning to multi-file generation.
- Generate a scenario matrix instead of one default workflow.
- Add explicit reuse, extend, create, and skip decisions.
- Add traceability from ticket criterion to test and assertion.

### Stage C — Repository knowledge graph

- Index symbols, tests, fixtures, Page Objects, routes, APIs, and helpers.
- Add provenance-preserving repository search tools.
- Add authentication and test-data discovery.
- Add duplicate and coverage analysis across multiple test projects.

### Stage D — LLM generation agent

- Add requirement-to-scenario reasoning.
- Add fixture and Page Object selection.
- Add structured assertion proposals.
- Add candidate locator enumeration.
- Add critique and revision steps.
- Add provider-neutral structured responses.

### Stage E — Safe generation and execution

- Add disposable-worktree writing tools.
- Add generated-code compilation gates.
- Add targeted execution tools.
- Add browser evidence tools with host policy.
- Add automatic repair-and-rerun loop.
- Add business-oracle execution.

### Stage F — Ticket and CI integration

- Add Jira/GitHub/GitLab/Linear adapters.
- Link generated tests to ticket criteria.
- Post CI evidence and repair proposals to review systems.
- Create reviewable patches and pull requests only after policy approval.

### Stage G — Continuous learning and enterprise governance

- Ingest ordinary CI feedback automatically.
- Track flaky tests and repair history.
- Add team dashboards and quality trends.
- Add policy enforcement and approval roles.
- Add model routing, cost controls, privacy controls, and retention policies.
- Add self-hosted and managed deployment options.

## 9. Release gates

PIE should not be declared production-ready until the following are true:

1. Deterministic hard-abstention cases never reach an unauthorized repair path.
2. False-repair count is zero on the validated evaluation suite.
3. Generated TypeScript compiles.
4. Generated tests execute against real applications.
5. Repairable locator mutations are fixed only when evidence proves the target.
6. Ambiguous locator cases abstain or require review.
7. Assertions remain unchanged during locator repair.
8. No unrelated files are changed.
9. Repeated runs are reproducible within declared variance.
10. LLM protocol failures are captured and do not bypass validation.
11. Every result has commit, runtime, repository, and artifact provenance.
12. The final report separates diagnosis accuracy, generation quality, repair
    success, abstention, latency, and model usage.

## 10. Final direction

PIE should evolve in layers:

```text
Deterministic diagnosis
        ↓
Safe repair proposal
        ↓
Repository-aware generation
        ↓
Business-aware assertions
        ↓
Requirement-to-test planning
        ↓
Bounded generation and repair agent
        ↓
Continuous verified feedback
        ↓
Team and enterprise QA platform
```

The existing deterministic engine is the safety foundation. The next major
investment is not unrestricted model access; it is richer repository evidence,
structured business requirements, verified candidate enumeration, assertion
proposals, disposable-worktree execution, and a complete generate-run-diagnose-
repair loop.

