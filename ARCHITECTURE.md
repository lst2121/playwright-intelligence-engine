# System Architecture: Playwright Intelligence Engine (v2.2)

**Architecture Paradigm:** Native Typed TypeScript Deterministic Controller & Verification Engine  
**Language & Runtime:** TypeScript / Node.js 20+ (ESM)  
**Core Motto:** "Verification-First Reliability: Diagnosing root cause and proving intent preservation before modifying code."

---

## 1. Core Principles & Architectural Guardrails

1. **Deterministic Controller Over Free-Form Agents:** The state machine is deterministic TypeScript code. The LLM does NOT control execution flow; it only provides semantic ranking within strict bounded contracts.
2. **Normalized Diagnostic Model:** The diagnostic engine never exposes raw trace serialization to callers. A version-aware adapter normalizes raw JSONL streams into a typed `DiagnosticContext`.
3. **Abstention as a First-Class Output:** If evidence is ambiguous, if an independent oracle is unavailable, or if the failure is infrastructure/auth related, the engine **abstains** from patching and produces a diagnostic explanation.
4. **Isolated Worktree Verification:** Candidate code modifications occur strictly inside temporary detached Git worktrees with unique IDs (`.pw-intelligence/worktrees/repair-xxx`). The active working branch is untouched.
5. **Evidence Provenance:** Every candidate patch must have a complete, auditable evidence trail from original failure event to verified outcome.

---

## 2. System Subsystems & Directory Structure

```
playwright-intelligence-engine/
├── src/
│   ├── core/
│   │   ├── types/               # DiagnosticContext, RepairEvidence, NormalizedTrace
│   │   ├── errors/              # Explicit typed errors (UnsupportedTraceVersionError, etc.)
│   │   └── contracts/           # TraceAdapter, WorktreeManager, AstPatcher interfaces
│   │
│   ├── trace/
│   │   ├── archive-reader.ts    # Safe zip unpacking, path-traversal protection, size checks
│   │   ├── version-detector.ts  # Identifies Playwright trace format version
│   │   ├── trace-parser.ts      # Parses .trace and .network JSONL event streams
│   │   ├── snapshot-resolver.ts # Resolves compact delta snapshots into renderable elements
│   │   └── adapters/            # Version-specific trace adapters (v1.40 - v1.50+)
│   │
│   ├── diagnostics/
│   │   ├── failure-classifier.ts # Categorizes: LOCATOR_DRIFT, AUTH_EXPIRED, TIMING, BACKEND_500
│   │   ├── evidence-correlator.ts# Maps failed action callId to network events and DOM state
│   │   └── diagnostic-report.ts  # Generates human-readable terminal report with evidence
│   │
│   ├── selector/
│   │   ├── candidate-extractor.ts# Extracts candidate elements from resolved snapshot
│   │   ├── selector-scorer.ts    # Multi-factor score S(L) with semantic and identity weights
│   │   └── abstention-policy.ts  # Enforces abstention thresholds and ambiguous candidate rejection
│   │
│   ├── repair/
│   │   ├── repair-planner.ts     # Plans repair transaction with evidence provenance
│   │   ├── intent-validator.ts   # Checks target identity (U & E & C) and assertion immutability
│   │   ├── ast-patcher.ts        # ts-morph AST modifications (constrained to known Page Object patterns)
│   │   └── repair-verifier.ts    # Runs test in worktree and validates seeded defect resistance
│   │
│   ├── sandbox/
│   │   ├── worktree-manager.ts   # Isolated git worktree lifecycle & stale worktree recovery
│   │   └── execution-runner.ts   # Child process runner with argument arrays (no shell injection)
│   │
│   └── index.ts                  # Public library & CLI entry point
│
├── tests/
│   ├── fixtures/
│   │   ├── traces/               # Real Playwright trace archives across versions
│   │   ├── page-objects/         # Standard Page Object patterns (constructor, property, getter)
│   │   └── mutations/            # Seeded locator and application defects
│   ├── unit/
│   └── benchmark/
│
├── PRODUCT_ROADMAP.md
├── ARCHITECTURE.md
└── package.json
```

---

## 3. The Normalized Diagnostic Model

```typescript
export interface DiagnosticContext {
  playwrightVersion: string;
  traceFormatVersion: number;
  failedAction: {
    callId: string;
    action: string;             // e.g. "click", "fill", "waitFor"
    selector?: string;          // original failed locator
    sourceFile?: string;
    line?: number;
    errorStack?: string;
  };
  snapshots: {
    before?: string;            // Resolved DOM representation before action
    action?: string;            // Exact snapshot when action attempted
    after?: string;             // Snapshot on failure
  };
  networkEvents: NetworkEvent[];
  consoleEvents: ConsoleEvent[];
  evidenceCompleteness: {
    domAvailable: boolean;
    networkAvailable: boolean;
    sourceAvailable: boolean;
  };
}
```

---

## 4. Multi-Factor Scoring & Intent Invariant

### 4.1 Scorer Formula
$$S(L) = w_1 U + w_2 I + w_3 M + w_4 A + w_5 H - w_6 D$$
* $U$ (**Uniqueness**): 1 if selector strictly matches 1 element in scope.
* $I$ (**Identity Match**): $U \land E \land C$ (Entity identity and contextual parent match).
* $M$ (**Semantic Match**): `getByRole` / `getByLabel` priority over raw CSS.
* $A$ (**Actionability**): Element is visible and enabled in snapshot.
* $H$ (**Historical Reliability**): Time-decayed reliability ledger score.
* $D$ (**Volatile Implementation Dependence**): Penalizes dynamic classes and deep XPath.

### 4.2 Invariant Verification Levels
* **Level 1: Verified Repair**: Target Identity Preserved ($T$) $\land$ Assertions Untouched ($A$) $\land$ Action Semantics Preserved ($X$) $\land$ Independent Oracle Verification Passed ($O$).
* **Level 2: Conditionally Verified Repair**: Structural and UI checks pass, but independent backend oracle is unavailable. **Reported explicitly as conditional; never claimed as mathematically guaranteed.**

---

## 5. Constrained AST Page Object Patching

`ts-morph` patches are strictly restricted to 3 unambiguous enterprise patterns initially:
1. **Direct constructor locator assignment:** `this.saveBtn = page.locator(...)`
2. **Direct property initializer:** `saveBtn = this.page.locator(...)`
3. **Simple getter returning locator:** `get saveBtn(): Locator { return this.page.locator(...); }`

**Abstention Rule:** Helper methods taking dynamic parameters, chained helper abstractions, and custom fixture locators trigger **Abstention with Diagnostic Suggestion** instead of arbitrary AST mutation.

---

## 6. Evidence Provenance Contract

Every proposed patch produces an immutable audit record:

```typescript
export interface RepairEvidence {
  originalActionId: string;
  originalSelector: string;
  candidateSelector: string;
  sourceLocation: {
    filePath: string;
    className: string;
    memberName: string;
    nodeKind: 'property' | 'constructor-assignment' | 'getter-return';
    line: number;
  };
  targetIdentityEvidence: string[];
  assertionFingerprint: string;    // SHA-256 of AST expect() blocks (must remain identical)
  businessOracleStatus: 'verified' | 'contradicted' | 'unavailable';
  verificationWorktreeId: string;
  repairedTestDurationMs: number;
}
```
