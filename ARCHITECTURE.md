# System Architecture: Playwright Intelligence Engine (v2.3 As-Built)

**Architecture Paradigm:** Native Typed TypeScript Deterministic Controller & Verification Engine  
**Language & Runtime:** TypeScript / Node.js 20+ (ESM, strict NodeNext)  
**Core Motto:** "Verification-First Reliability: Diagnosing root causes and proving intent preservation before modifying code."  
**Verification Status:** Production Implemented & Benchmarked against 6 Live Target Web Applications (November 2026)

---

## 1. Core Principles & Architectural Guardrails

1. **Deterministic Controller Over Free-Form Agents:** The execution flow, failure diagnosis, repair planning, and verification state machine are deterministic TypeScript code. The LLM does NOT control execution flow or code modifications; it only provides semantic ranking within strict bounded contracts.
2. **Normalized Diagnostic Model:** The diagnostic engine never exposes raw trace serialization or unstable Playwright internal formats to callers. A version-aware adapter normalizes raw JSONL streams into a typed `DiagnosticContext`.
3. **Abstention as a First-Class Output:** If evidence is ambiguous, if an independent oracle is unavailable, or if the failure is infrastructure/auth related (HTTP 401, 500, network offline), the engine **strictly abstains** from patching and produces a diagnostic explanation with zero attempted code modifications.
4. **Isolated Worktree Verification:** Candidate code modifications occur strictly inside temporary detached Git worktrees with unique IDs (`.pw-intelligence/worktrees/repair-xxx`). The active developer working branch is never touched.
5. **Zero-Install NTFS Directory Junctions:** On Windows, detached worktrees share the root `node_modules` via NTFS Directory Junctions (`symlink(..., 'junction')`), eliminating 30–90 second `npm install` delays without requiring elevated administrator privileges.
6. **Cryptographic Assertion Immutability:** Pre-patch and post-patch assertion ASTs are hashed using a canonical, formatting-insensitive SHA-256 fingerprint. Automated repairs are mathematically prohibited from modifying, weakening, or deleting test assertions (`expect()`).
7. **Evidence Provenance Contract:** Every proposed patch produces an immutable, auditable `RepairEvidence` record tracking the failure event, original selector, candidate selector, AST node location, assertion fingerprint, and worktree verification status.

---

## 2. As-Built Subsystems & File Layout

```
playwright-intelligence-engine/
├── src/
│   ├── core/
│   │   ├── types/
│   │   │   ├── diagnostic-context.ts # Normalized DiagnosticContext, NetworkEvent, ConsoleEvent, FailedAction
│   │   │   └── repair-evidence.ts    # Immutable RepairEvidence provenance contract, SourceLocation
│   │   └── errors/
│   │       └── engine-errors.ts      # Typed errors: ZipSlipSecurityError, AbstentionError, AssertionTamperedError
│   │
│   ├── trace/
│   │   ├── archive-reader.ts        # Zip-Slip path-traversal protection, Zip-Bomb limits, findTraceFileEntries
│   │   ├── version-detector.ts      # Version-aware detector supporting Playwright trace formats v5 through v10
│   │   ├── trace-parser.ts          # Parses paired before/after & action JSONL events into DiagnosticContext
│   │   └── snapshot-resolver.ts     # Resolves array-based NodeSnapshot tuples into interactive DOM elements
│   │
│   ├── diagnostics/
│   │   ├── failure-classifier.ts    # Grounded classifier: LOCATOR_DRIFT, AUTH_EXPIRED, BACKEND_500, TIMING_RACE
│   │   ├── evidence-correlator.ts   # Correlates callId with 4xx/5xx network anomalies and console errors
│   │   └── diagnostic-report.ts     # Colorized terminal report generator with complete evidence provenance
│   │
│   ├── selector/
│   │   ├── candidate-extractor.ts   # Filters DOM snapshot elements matching action semantics (click/fill)
│   │   ├── selector-scorer.ts       # Multi-factor score S(L) = w1*U + w2*I + w3*M + w4*A + w5*H - w6*D
│   │   └── abstention-policy.ts     # Enforces safety threshold (>=0.70) and ambiguity delta threshold (>=0.08)
│   │
│   ├── repair/
│   │   ├── ast-patcher.ts           # ts-morph AST surgeon for Constructor, Property, and Getter POM patterns
│   │   ├── assertion-hasher.ts      # Canonical whitespace/formatting-insensitive SHA-256 assertion fingerprinter
│   │   ├── intent-validator.ts      # Enforces Target Identity (U&E&C), Action Semantics, and Immutability
│   │   └── repair-planner.ts        # Synthesizes user-centric ARIA locators (getByRole, getByTestId) & logs evidence
│   │
│   ├── sandbox/
│   │   ├── worktree-manager.ts      # Manages detached Git worktrees, NTFS junctions, pre-unlink safety, retry backoff
│   │   └── execution-runner.ts      # Child process runner with argument arrays and cmd.exe bridging (zero shell injection)
│   │
│   ├── memory/
│   │   └── stability-ledger.ts      # Time-decayed selector reliability tracking in .pw-intelligence/stability-ledger.json
│   │
│   ├── generator/
│   │   └── test-generator.ts        # Generates enterprise TypeScript Page Objects and specs with web-first assertions
│   │
│   ├── framework/
│   │   └── config-adapter.ts        # Static AST parser for playwright.config.ts and verification override generator
│   │
│   ├── mcp/
│   │   └── server.ts                # Model Context Protocol (MCP) JSON-RPC 2.0 stdio server for Cursor / Claude
│   │
│   ├── cli/
│   │   └── index.ts                 # CLI router for pw-intel diagnose, mcp, generate, --help
│   │
│   └── index.ts                     # Public TypeScript library API exporting all core modules
│
├── bin/
│   └── pw-intel.js                  # Global executable binary entrypoint
│
├── benchmarks/
│   ├── playwright.config.ts         # Benchmark runner configuration (workers: 1, retries: 0, trace: retain-on-failure)
│   ├── page-objects/                # Page Object Models for the 6 live target applications
│   │   ├── PlaygroundPage.ts        # Target 1: UI Testing Playground
│   │   ├── SauceDemoPage.ts         # Target 2: SauceDemo E-Commerce
│   │   ├── TheInternetPage.ts       # Target 3: The Internet Dynamic Controls & Status Codes
│   │   ├── LetCodePage.ts           # Target 4: LetCode Practice Automation
│   │   ├── OrangeHRMPage.ts         # Target 5: OrangeHRM Enterprise Portal
│   │   └── AutomationExercisePage.ts# Target 6: Automation Exercise E-Commerce
│   ├── tests/                       # Live Playwright test specs for the 6 targets
│   └── runner/
│       └── benchmark-harness.ts     # 4-Part adversarial benchmark runner (Baseline, Drift, Mutation, Abstention)
│
├── docs/
│   ├── MARKET_AND_TECHNICAL_RESEARCH.md # 15-section competitive, academic, and feasibility research report
│   └── BENCHMARK_REPORT.md              # Empirical benchmark validation report across all 6 live targets
│
├── tests/unit/                      # 29 Vitest unit tests across 9 test suites
├── tsconfig.json                    # Strict ES2022 / NodeNext TypeScript configuration
└── package.json                     # Native ESM package definition with tsup bundling and tsc d.ts emission
```

---

## 3. The Normalized Diagnostic Model & Zod Schemas

To prevent runtime coupling to internal Playwright trace formats, the engine ingests raw `.zip` archives and validates them against strict Zod schemas:

```typescript
export interface DiagnosticContext {
  playwrightVersion: string;         // e.g. "1.64.1"
  traceFormatVersion: number;        // Supported: 5, 6, 7, 8, 9, 10
  failedAction: {
    callId: string;                  // e.g. "peah@57"
    action: string;                  // e.g. "locator.click", "page.fill"
    selector?: string;               // Failed locator expression
    sourceFile?: string;             // Resolved spec / POM file path
    line?: number;
    column?: number;
    errorMessage?: string;
    errorStack?: string;
    durationMs?: number;
  };
  snapshots: {
    before?: string;                 // Resolved DOM before action
    action?: string;                 // Snapshot at moment of attempt
    after?: string;                  // Snapshot on timeout/failure
  };
  networkEvents: NetworkEvent[];     // HTTP requests, responses, status codes
  consoleEvents: ConsoleEvent[];     // Console errors and unhandled rejections
  evidenceCompleteness: {
    domAvailable: boolean;
    networkAvailable: boolean;
    sourceAvailable: boolean;
  };
}
```

---

## 4. Multi-Factor Selector Scoring & Abstention Mechanics

### 4.1 Calibrated Scoring Formula
$$S(L) = w_1 U + w_2 I + w_3 M + w_4 A + w_5 H - w_6 D$$

* $U$ (**Uniqueness**, $w_1 = 0.25$): Evaluates candidate uniqueness within the resolved DOM scope ($1.0$ if single match, $0.5$ if duplicate, $0.2$ if $>2$).
* $I$ (**Identity Match**, $w_2 = 0.25$): Compares accessible name, text, and container tokens against the original intent.
* $M$ (**Semantic Match**, $w_3 = 0.20$): Prioritizes modern accessibility ARIA roles (`getByRole` = $1.0$, `getByTestId` = $0.9$, `getByPlaceholder` = $0.85$, raw CSS = $0.4$).
* $A$ (**Actionability**, $w_4 = 0.15$): Validates that the element is enabled, visible, and unoccluded in the snapshot.
* $H$ (**Historical Reliability**, $w_5 = 0.10$): Time-decayed reliability score queried from `StabilityLedger` ($\frac{\text{successes}}{\text{successes} + 2 \times \text{failures}}$).
* $D$ (**Volatile Implementation Dependence**, $w_6 = 0.20$): Penalizes dynamic hex IDs (`/^[0-9a-f]{8,}$/i`) by $0.5$ and CSS-in-JS hashed classes (`css-*`, `sc-*`) by $0.4$.

### 4.2 Abstention Policy Guardrails
1. **Safety Threshold:** Candidate is rejected if $S(L) < 0.70$.
2. **Ambiguity Delta:** If the score difference between the top candidate and the runner-up is $< 0.08$, the engine strictly abstains to prevent guessing.
3. **Strict Uniqueness:** If $U < 0.5$, the engine abstains to avoid introducing Playwright strict mode violations.
4. **Negative Controls:** If network logs contain HTTP 401/403 or HTTP 500–504 during or immediately preceding the failure, the engine flags `AUTH_EXPIRED` or `BACKEND_500` and enforces **100% strict abstention** with zero attempted code mutations.

---

## 5. Surgical AST Refactoring & Invariant Enforcement

### 5.1 Supported Page Object Model Patterns
`ts-morph` AST modifications are strictly restricted to 3 unambiguous enterprise patterns:
1. **Property Initializer:**
   ```typescript
   readonly checkoutBtn = this.page.locator('.btn-checkout');
   // Surgically refactored to:
   readonly checkoutBtn = this.page.getByRole('button', { name: 'Checkout' });
   ```
2. **Getter Method:**
   ```typescript
   get submitBtn(): Locator { return this.page.locator('.submit'); }
   // Surgically refactored to:
   get submitBtn(): Locator { return this.page.getByRole('button', { name: 'Submit' }); }
   ```
3. **Constructor Assignment:**
   ```typescript
   constructor(page: Page) {
     this.page = page;
     this.loginBtn = page.locator('.btn-login');
     // Surgically refactored to:
     this.loginBtn = page.getByRole('button', { name: 'Login' });
   }
   ```

**Abstention Boundary:** Dynamic helper methods accepting parameters (e.g. `row(id: string)`) trigger `AbstentionError('AST_PARAMETERIZED_LOCATOR')` with human diagnostic suggestions rather than arbitrary code modifications.

### 5.2 Cryptographic Assertion Immutability
Before any AST modification is applied:
1. `AssertionHasher` traverses the test spec AST, extracts all `expect()` call expressions, strips trivia/whitespace, sorts keys canonically, and calculates a SHA-256 fingerprint:
   $$\text{Fingerprint} = \text{SHA-256}(\text{CanonicalAST}(\text{expect}(\dots)))$$
2. Following candidate repair, the fingerprint is recomputed. If $\text{Fingerprint}_{\text{post}} \neq \text{Fingerprint}_{\text{pre}}$, the transaction aborts with `AssertionTamperedError` and the worktree is rolled back.

---

## 6. Windows NTFS Worktree Sandbox Mechanics

1. **NTFS Directory Junctions:** Detached worktrees are created via `git worktree add -b pw-repair/<id> <path> HEAD`. Rather than running `npm install` inside each worktree (adding 30–90 seconds of latency), `WorktreeManager` creates an NTFS directory junction linking the root `node_modules`:
   ```typescript
   const linkType = process.platform === 'win32' ? 'junction' : 'dir';
   await fs.symlink(sourceNodeModules, targetNodeModules, linkType);
   ```
2. **Pre-Unlink Safety Guardrail:** To prevent recursive deletion from traversing into and wiping the root repository's dependencies, the junction is explicitly unlinked via `fs.unlink()` *before* directory cleanup.
3. **Windows Defender File Lock Mitigation:** Implements retry-backed directory removal with exponential backoff and random jitter (100ms, 200ms, 400ms, 800ms) to bypass transient `EBUSY` / `EPERM` locks held by `MsMpEng.exe` or `SearchIndexer.exe`.
4. **Crash Recovery Ledger:** Maintains `.pw-intelligence/worktrees/registry.json` tracking active worktree PIDs and creation timestamps. Stale worktrees from dead processes are automatically pruned on startup.

---

## 7. Model Context Protocol (MCP) & Developer Tooling

The engine provides dual developer interfaces:
1. **Native MCP Server (`src/mcp/server.ts`):** Exposes standard JSON-RPC 2.0 stdio protocol compatible with Cursor, Claude Desktop, and Antigravity.
   - `diagnose_trace`: Ingests a `trace.zip` path and returns root-cause diagnosis.
   - `repair_page_object`: Applies surgical AST repairs while verifying assertion immutability.
   - `generate_playwright_test`: Scaffolds verified Page Objects and specs.
2. **Interactive CLI (`bin/pw-intel.js`):**
   - `pw-intel diagnose <trace.zip>`: Analyzes trace archives and outputs formatted evidence reports.
   - `pw-intel mcp`: Launches the JSON-RPC stdio daemon.
   - `pw-intel generate <featureName>`: Generates modern Page Objects and specs.
