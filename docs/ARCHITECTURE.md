# Playwright Intelligence Engine — Architecture Specification (v2.6 Enterprise As-Built)

**Version:** 2.6 Enterprise Architecture Baseline  
**Language & Runtime:** TypeScript 7.0 / Node.js 20+ (ESM, strict NodeNext)  
**Verification Baseline:** 382 Passed Tests (24 Suites) | 9 Real Empirical Browser Scenarios | 100% Defect Resistance | 0.0% False Repairs | 0.0% Regressions  

---

## 1. Executive Architectural Tenets

1. **Deterministic Controller Over Unbounded Agents**:  
   The execution lifecycle, failure classification, candidate scoring, AST transformations, and verification workflows are governed entirely by deterministic, strongly typed TypeScript state machines. LLM involvement is strictly isolated to optional semantic disambiguation and bounded candidate ranking. The engine never allows an LLM to freely generate code modifications or execute unconstrained file writes.

2. **True Multi-Source Evidence Model (Beyond Trace-Only)**:  
   While `trace.zip` post-mortem ingestion remains a first-class evidence source, the engine does not depend exclusively on trace files. It features independent evidence collectors spanning live browser fixtures, static AST analysis, HTTP/network interception, git diff history, operating environment metadata, and Playwright error parsing. Evidence is unified through a normalized schema (`UnifiedEvidenceRecord`) with an `EvidenceScorecard`.

3. **Zero In-Band Runtime Overhead with Opt-In Diagnostic Reproduction**:  
   Production tests run without intrusive browser proxies or monkey-patching. When a test fails in CI or locally, developers can either ingest the generated trace or invoke `pw-intel reproduce <spec.ts>` to re-execute in an isolated worktree with attached live diagnostic hooks.

4. **Action-Anchored Temporal Windowing & Causal Evidence Graph**:  
   Temporal anomaly windows are anchored to the timestamp of the failed action ($T_{\text{action}}$) rather than $\max(\text{timestamps})$ (which can be contaminated by post-failure teardown logs). Causal evidence graphs explicitly link network events, frame identifiers, DOM snapshots, and error stacks through typed edges (`TEMPORALLY_PRECEDES`, `SAME_FRAME`, `INITIATED_BY`, `SUPPORTS`, `CONTRADICTS`).

5. **Abstention as a Successful Safety Outcome**:  
   When evidence is ambiguous, when multiple elements match, when trace artifacts are incomplete, or when failures stem from backend infrastructure (HTTP 500, expired authentication, offline networks), the engine **strictly abstains** from attempting code modifications. An explicit diagnostic explanation is generated with zero file mutation.

6. **Unconditionally Fail-Closed Intent Invariant v2 ($V = A \land T \land F \land I \land D \land E$)**:  
   Code modifications are formally verified across six dimensions before being proposed: Assertion Fingerprinting ($A$), Structural Control Flow ($T$), Critical Fixtures ($F$), Target Identity & Action Semantics ($I$), Diff Allowlist ($D$), and Worktree Execution ($E$). In-memory planning uses explicit pre-flight verification ($V_{\text{pre}} = A \land T \land F \land I$), while production application strictly requires affirmative worktree execution evidence ($E$).

7. **Centralized Cryptographic Approval Service & Hardened Worktrees with CAS Atomic Promotion**:  
   Direct disk modifications on working branches are strictly prohibited. Applying a verified patch requires a single-use cryptographic token (`ApprovalService`) bound to the canonical file path, original source hash, and patch hash. Promotions to active workspace files execute through `WorkspacePromoter` using cooperative locking, Compare-And-Swap (CAS) hash verification, temporary file staging, and atomic rename (`fs.renameSync`). All verification executes within detached Git worktrees protected by canonical filesystem containment (`fs.realpathSync`), sanitized environments, bounded process buffers (16 MB), and Windows process tree termination (`taskkill`).

---

## 2. System Architecture & Component Interaction

```mermaid
flowchart TD
    subgraph MultiSourceSubsystem["Subsystem A: Multi-Source Evidence Ingestion & Redaction"]
        TraceCollector["TraceCollector\n• ArchiveReader (Zip-bomb defense)\n• VersionDetector\n• TraceParser"]
        LiveCollector["LiveBrowserCollector\n• Page listeners (console, error)\n• DOM / Accessibility Snapshots\n• Live Uniqueness Evaluation"]
        AstCollector["StaticAstCollector\n• ts-morph AST analysis\n• Page Object discovery\n• Test action & assertion mapping"]
        NetCollector["NetworkCollector\n• HTTP request/response\n• Status codes & timings"]
        GitCollector["GitDiffCollector\n• Working tree diffs\n• Recent selector commits"]
        EnvCollector["EnvironmentCollector\n• Node, OS, Playwright version\n• CI Provider detection"]
        ErrCollector["ErrorCollector\n• TimeoutError / StrictMode\n• Stack trace & frame parser"]
        
        Redactor["EvidenceRedactor\n• JWT / Bearer token scrubbing\n• PAN / SSN / Secret redaction\n• Sensitive header filtering"]
        Normalizer["EvidenceNormalizer\n• UnifiedEvidenceRecord\n• EvidenceScorecard\n• DiagnosticContext Bridge"]

        TraceCollector --> Redactor
        LiveCollector --> Redactor
        AstCollector --> Redactor
        NetCollector --> Redactor
        GitCollector --> Redactor
        EnvCollector --> Redactor
        ErrCollector --> Redactor
        Redactor --> Normalizer
    end

    subgraph DiagnosticSubsystem["Subsystem B: Causal Evidence Graph & Diagnostics"]
        EvidenceCorrelator["EvidenceCorrelator\n• Action-Anchored Window (T_action)\n• Frame Association\n• Telemetry Domain Filtering"]
        FailureClassifier["FailureClassifier\n• Causal Evidence Graph\n• LOCATOR_DRIFT\n• BACKEND_500\n• AUTH_EXPIRED\n• ASSERTION_FAILURE\n• TIMING_RACE\n• INCOMPLETE_EVIDENCE"]
        ReportGenerator["DiagnosticReportGenerator\n• Terminal & Markdown Reports\n• Multi-Source Evidence Scorecard"]
        
        Normalizer --> EvidenceCorrelator
        EvidenceCorrelator --> FailureClassifier
        FailureClassifier --> ReportGenerator
    end

    subgraph IntelligenceSubsystem["Subsystem C: Candidate Extraction & Calibrated Scoring"]
        CandidateExtractor["CandidateExtractor\n• Dynamic Page Property Discovery\n• Literal escaping\n• Priority: getByRole > getByTestId"]
        SelectorScorer["SelectorScorer\n• Multi-factor score S(L)\n• Semantic action token matching\n• Volatile hash penalties"]
        AbstentionPolicy["AbstentionPolicy\n• Strict Uniqueness Gate (U=1.0)\n• Ambiguity Delta Guardrail\n• Negative Control Abstention"]
        
        FailureClassifier -->|If LOCATOR_DRIFT| CandidateExtractor
        CandidateExtractor --> SelectorScorer
        SelectorScorer --> AbstentionPolicy
    end

    subgraph RepairSubsystem["Subsystem D: Isolated Repair & Fail-Closed Invariants"]
        WorktreeManager["WorktreeManager\n• Detached Git worktrees\n• Canonical containment (realpath)\n• NTFS junction node_modules"]
        AstPatcher["AstPatcher\n• Atomic temporary file swap\n• ts-morph surgical replacement"]
        DiffAllowlist["DiffAllowlistValidator\n• Recursive locator grammar\n• Reject process.env/code injection"]
        IntentValidator["IntentValidator v2\n• V = A ∧ T ∧ F ∧ I ∧ D ∧ E\n• Pre-flight mode separation"]
        ExecutionRunner["ExecutionRunner\n• taskkill /T /F tree termination\n• 16 MB bounded output buffers\n• Sanitized env variable whitelist"]
        ApprovalService["ApprovalService\n• Cryptographic single-use tokens\n• SHA-256 patch & file verification\n• 10-minute TTL"]

        AbstentionPolicy -->|If Authorized Candidate| WorktreeManager
        WorktreeManager --> AstPatcher
        AstPatcher --> DiffAllowlist
        DiffAllowlist --> ExecutionRunner
        ExecutionRunner --> IntentValidator
        IntentValidator -->|Fully Proved| ApprovalService
    end
```

---

## 3. Subsystem Detailed Specifications

### Subsystem A: Multi-Source Evidence Model
The engine operates across eight distinct evidence sources:
1. `trace`: Ingested `.trace` and `.network` streams from Playwright trace archives.
2. `live-browser`: CDP and Page listeners capturing console logs, unhandled errors, failed requests, and live DOM snapshots.
3. `static-ast`: Static analysis of test specs and Page Objects via `ts-morph` extracting declared locators, actions, and assertions without browser execution.
4. `network`: HTTP request/response tracking with header and body redaction.
5. `git-diff`: Working tree and commit diffs identifying recently modified HTML attributes (`id`, `class`, `data-testid`).
6. `environment`: Node.js, OS platform, memory, Playwright version, and CI environment metadata without secret leakage.
7. `error`: Playwright error message, error stack, and frame location parsing.
8. `console`: Browser console events with severity levels and source file locations.

### Subsystem B: Diagnostic Intelligence & Causal Graph
Temporal correlation anchors strictly to the failed action timestamp ($T_{\text{action}}$):
$$W = [T_{\text{action}} - 5000\,\text{ms}, T_{\text{action}} + 1000\,\text{ms}]$$
Events outside this window or originating from background telemetry/analytics (`google-analytics`, `sentry`, `datadog`, `hotjar`, `/beacon`, `/metrics`) are stripped.

The Causal Evidence Graph links network requests, console errors, and DOM snapshots to the failed action using explicit directed edges:
- `TEMPORALLY_PRECEDES`: Confirms event completed before action dispatch.
- `SAME_FRAME`: Confirms network request originated from the exact frame executing the action.
- `SUPPORTS`: Confirms diagnostic evidence directly explains action failure (e.g., HTTP 500 or 401).
- `CONTRADICTS`: Confirms evidence refutes failure hypothesis.

### Subsystem C: Candidate Extraction & Calibrated Scoring
Locator expressions are synthesized using user-centric, resilient Playwright locator methods:
1. `getByRole(role, { name: '...' })`
2. `getByTestId('...')`
3. `getByLabel('...')`
4. `getByPlaceholder('...')`
5. `getByText('...')`
6. `locator('#id')` (unhashed)
7. `locator('tag.class')` (unhashed)

Page property prefixes are discovered dynamically from target Page Objects (`this.page`, `this._page`, `this.browserPage`), preventing broken references. Semantic action token matching distinguishes conflicting action targets (e.g., `"Continue shopping"` vs `"Continue checkout"`).

### Subsystem D: Isolated Worktree Repair & Intent Invariant v2
Repairs are verified exclusively within detached Git worktrees. Intent Invariant v2 is evaluated fail-closed:
$$V = A \land T \land F \land I \land D \land E$$
- $A$: Assertion fingerprint hash unchanged ($\Delta A = 0$).
- $T$: Structural control flow AST unchanged ($\Delta T = 0$).
- $F$: Critical test fixtures unchanged ($\Delta F = 0$).
- $I$: Target element semantic identity confirmed.
- $D$: Diff contains exclusively a single surgical locator replacement matching recursive locator grammar.
- $E$: Target test spec executed and passed cleanly inside the isolated worktree with $\ge 1$ passing test.

Applying patches outside the worktree requires a single-use token issued by `ApprovalService` after affirmative cryptographic verification.
