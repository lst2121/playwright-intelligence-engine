# PIE v3.0 Architecture: The Decoupled "Author / Gate" Engine

## 1. Architectural Philosophy

Prior versions of PIE coupled code authoring with deterministic verification inside a single monolithic generator. While the deterministic verification was mathematically sound ($V = A \land T \land F \land I \land D \land E$), string templates lacked semantic intelligence, causing defects such as index-derived identifiers (`actionButton1`, `fill2`) and rigid scenario-derived class names (`UserLoginWithValidCredentialsPage`).

In PIE v3.0, we establish a clean separation of concerns:
> **The Author creates candidates with full semantic intelligence.**  
> **The Gate independently proves safety, quality, and business invariant preservation.**

```
┌────────────────────────────────────────────────────────┐
│                      AUTHOR LAYER                      │
│  L0: TemplateAuthor (deterministic symbol mapper)      │
│  L1: HybridAuthor   (LLM symbol planner + compiler)   │
│  L2: LlmAuthor      (full generative file synthesis)   │
└──────────────────────────┬─────────────────────────────┘
                           │ CandidateChange { files, symbols }
                           ▼
┌────────────────────────────────────────────────────────┐
│                       GATE LAYER                       │
│  ├── SafetyGate  : V = A ∧ T ∧ F ∧ I ∧ D ∧ E          │
│  │   • Zero assertion weakening (expect hash SHA-256)   │
│  │   • Real child-process execution proof              │
│  │   • Sandboxed Git worktree isolation                │
│  ├── QualityGate : Deterministic Code Quality          │
│  │   • NamingLinter (0 index-derived names)            │
│  │   • Duplicate selector detection                    │
│  │   • Locator policy conformance                      │
│  │   • Diff minimality & assertion strength            │
│  └── OracleGate  : Business Intent Verification        │
│      • Independent business intent oracles             │
│      • Missing evidence = UNAVAILABLE, never verified  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Capability Ladder (L0 – L2)

PIE provides a 3-tier authoring capability ladder:

| Tier | Author | Intelligence Mechanism | Safety & Compilation Guarantee |
| :---: | :--- | :--- | :--- |
| **L0** | `TemplateAuthor` | Pure deterministic AST compiler using heuristic `NamePlanner`. | 100% Guaranteed. Zero external network/API dependencies. |
| **L1** | `HybridAuthor` *(Default)* | Model plans semantic `NamePlan` symbol table guided by repository exemplars; symbols compile through deterministic AST template. | 100% Guaranteed. If model is unavailable or lint fails, falls back cleanly to L0. |
| **L2** | `LlmAuthor` | Neural full-file generation evaluated in disposable Git worktrees with `QualityGate` and `SafetyGate`. | Bounded corrective loop (max 3 steps, max 120s). Strict fail-closed on invariant violations. |

---

## 3. Discovered Data vs. Prompt Instructions

A core architectural principle of PIE v3.0 is:
> **Conventions are runtime facts, not prompt instructions.**  
> **Facts must be discovered dynamically and enforced by a validator, never by prompt wishful thinking.**

### Why Prompt-Encoded Conventions Fail
1. **Repository Drift:** Team conventions evolve across branches and repositories; static prompts become stale immediately.
2. **Hallucination:** Language models routinely violate negative prompt instructions ("do not use CSS", "use camelCase") under high context load.
3. **Token Inefficiency:** Injecting 500 lines of convention instructions into every generation turn wastes token budgets.

### The PIE v3.0 Runtime Discovery Model
1. During `pw-intel profile <dir>`, the engine inspects up to 5 existing Page Objects and test files using `ts-morph` AST traversal.
2. It extracts:
   - Preferred locator strategy (`getByRole > getByLabel > getByTestId > locator`)
   - Property suffix conventions (`Button`, `Input`, `Dialog`, `Heading`)
   - Class naming patterns and page injection styles
   - 2–3 truncated exemplars ($\le 120$ lines each)
3. It writes `.pie/conventions.json` to the target repository.
4. When generating or repairing code, authors read `.pie/conventions.json`, and `QualityGate` validates the output against the discovered schema.

---

## 4. Skills vs. Conventions Boundary

| Customization Type | File Location | Responsibility | Rule |
| :--- | :--- | :--- | :--- |
| **Skill** | `skills/<skill-name>/SKILL.md` | Human/agent workflows, operational runbooks, and CLI procedures. | **Never encode repository facts or coding rules in skills.** |
| **Convention** | `.pie/conventions.json` | Project-specific facts discovered at runtime (paths, locator priorities, naming suffixes). | Discovered dynamically by `RepositoryProfiler`. |
| **Gate Invariant** | `src/gate/` | Hard mathematical and safety constraints ($V = A \land T \land F \land I \land D \land E$). | Enforced programmatically. Fail-closed. |

---

## 5. Bounded Generation Agent Loop

To prevent runaway loops or infinite token consumption, `runGenerationAgent` executes a state machine bounded by:
- **Maximum Steps:** 3 iterations
- **Maximum Duration:** 120 seconds
- **Transition Detection:** `AGENT_NO_PROGRESS` transition triggers when an author produces an identical proposal signature without resolving QualityGate violations.

