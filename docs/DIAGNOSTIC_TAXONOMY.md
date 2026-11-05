# Diagnostic Taxonomy & Causal Evidence Specification

This document defines the diagnostic taxonomy, root-cause classification rules, and Causal Evidence Graph implemented in **Playwright Intelligence Engine**.

---

## 1. Grounded Diagnostic Taxonomy

The engine classifies every test failure into one of eleven discrete, grounded categories. Only `LOCATOR_DRIFT` is eligible for automated repair. All other categories trigger an immediate, explanatory abstention.

```mermaid
graph TD
    Failure[Test Execution Failure] --> Ingestion[Trace Ingestion & Validation]
    Ingestion --> CausalGraph[Causal Evidence Graph]
    
    CausalGraph -->|Telemetry Excluded| Evaluate[Evaluate Root Cause]
    
    Evaluate -->|Target Missing, API Healthy| DRIFT[LOCATOR_DRIFT\n(Eligible for Repair)]
    Evaluate -->|API 5xx In-Domain| BACKEND[BACKEND_500\n(Abstain: Bug in Backend)]
    Evaluate -->|HTTP 401/403 or Auth Redirect| AUTH[AUTH_EXPIRED\n(Abstain: Session Failure)]
    Evaluate -->|Expectation Failed, Action Passed| ASSERT[ASSERTION_FAILURE\n(Abstain: Business Logic)]
    Evaluate -->|Multiple DOM Matches| AMBIG[AMBIGUOUS_MATCH\n(Abstain: Strict-Mode Violation)]
    Evaluate -->|Action Succeeded on Retry| RACE[TIMING_RACE\n(Abstain: Dynamic Race)]
    Evaluate -->|Network Aborted / DNS Failed| OFFLINE[NETWORK_OFFLINE\n(Abstain: Infrastructure)]
    Evaluate -->|Multiple Competing Causes| MIXED[MIXED_FAILURE\n(Abstain: Indeterminate)]
    Evaluate -->|Snapshots Severed / Incomplete| INCOMP[INCOMPLETE_EVIDENCE\n(Abstain: Missing Data)]
    Evaluate -->|Unsupported Schema Version| FORMAT[UNSUPPORTED_TRACE_FORMAT\n(Abstain: Version Mismatch)]
    Evaluate -->|Unrecognized Failure Pattern| UNKNOWN[UNKNOWN_ERROR\n(Abstain: Unclassified)]
```

### Taxonomy Category Definitions

| Category | Description | Repair Eligibility | Mandatory Engine Action |
| :--- | :--- | :--- | :--- |
| `LOCATOR_DRIFT` | Playwright action timed out because the selector did not resolve in DOM, while backend API requests succeeded ($2xx/3xx$). | **Eligible** | Extract candidates, score locators, evaluate Intent Invariant v2, execute worktree repair. |
| `BACKEND_500` | In-domain application API returned HTTP $500, 502, 503$, or $504$ prior to or during the failing action. | **Ineligible** | Abstain immediately. Flag backend endpoint, method, and HTTP status code in report. |
| `AUTH_EXPIRED` | Request failed with HTTP $401, 403$, or browser was redirected to an unexpected login/sso route. | **Ineligible** | Abstain immediately. Prevent repair loops caused by expired session tokens. |
| `ASSERTION_FAILURE` | All DOM interactions completed successfully, but a Playwright `expect()` assertion failed. | **Ineligible** | Abstain immediately. The test discovered a real application state discrepancy or regression. |
| `AMBIGUOUS_MATCH` | Original or candidate selector resolved to multiple elements in DOM ($matchCount > 1$). | **Ineligible** | Abstain immediately. Protects against Playwright strict-mode errors. |
| `TIMING_RACE` | Element was detached or mutating during click, or appeared after timeout without selector change. | **Ineligible** | Abstain. Diagnose as timing issue; suggest web-first assertion or auto-waiting adjustment. |
| `NETWORK_OFFLINE` | Requests failed with `net::ERR_CONNECTION_REFUSED`, `net::ERR_NAME_NOT_RESOLVED`, or aborted connections. | **Ineligible** | Abstain immediately. Infrastructure offline. |
| `MIXED_FAILURE` | Trace exhibits both locator timeout and valid in-domain API failure concurrently. | **Ineligible** | Abstain. Flag conflicting evidence to developer. |
| `INCOMPLETE_EVIDENCE` | Trace missing before/after snapshots or network logs due to abrupt test termination. | **Ineligible** | Abstain. State is unverifiable. |
| `UNSUPPORTED_TRACE_FORMAT`| Trace version unsupported by registered adapters. | **Ineligible** | Abstain. Safely exit without corrupting source code. |
| `UNKNOWN_ERROR` | Error does not match any recognized Playwright failure signatures. | **Ineligible** | Abstain. Emit raw error stack for developer inspection. |

---

## 2. Causal Evidence Graph & Telemetry Filtering

### The Correlation vs. Causality Problem
In modern single-page applications, web pages emit continuous background network traffic:
- User analytics (Google Analytics, Segment, Amplitude)
- Error reporting (Sentry, Bugsnag, Datadog)
- Performance beacons (`navigator.sendBeacon`, `/metrics`)
- Favicons and third-party widgets

If an analytics beacon fails with HTTP 500 or timeout, a naive correlator matching timestamps will falsely blame the 500 error for a test failure.

### Filtering Rules in `EvidenceCorrelator`
Before evaluating network events for causality, `EvidenceCorrelator` strips all non-causal traffic:
1. **Domain Exclusion List**:
   - `google-analytics.com`, `googletagmanager.com`
   - `sentry.io`, `browser.sentry-cdn.com`
   - `datadoghq.com`, `datadog-logs.com`
   - `segment.io`, `mixpanel.com`, `amplitude.com`
2. **Endpoint Path Exclusion**:
   - Matches: `*/beacon*`, `*/metrics*`, `*/telemetry*`, `*/analytics*`, `*/favicon.ico`
3. **Causal Origin Match**:
   - A network error is only causal if its URL origin matches the application under test (e.g. `window.location.origin` or configured baseURL) or a designated business API route.
4. **Temporal Dependency Window**:
   - The network failure must occur before or within the execution window of the failing Playwright action.

---

## 3. Evidence Provenance & Diagnostic Context Contract

Every diagnostic classification generates a strongly typed `DiagnosticContext`:

```typescript
export interface DiagnosticContext {
  id: string;
  traceVersion: number;
  category: DiagnosticCategory;
  confidence: number;
  failedAction?: {
    callId: string;
    action: string; // e.g. "click"
    selector: string; // e.g. "button#submit"
    startTime: number;
    endTime: number;
    error: string;
  };
  causalEvents: {
    networkErrors: Array<{
      url: string;
      status: number;
      method: string;
      timestamp: number;
      isCausal: boolean;
    }>;
    consoleErrors: Array<{
      text: string;
      location?: string;
      timestamp: number;
    }>;
  };
  snapshotCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  remedyRecommendation: string;
}
```

This contract is consumed by both the CLI terminal reporter and the MCP server.

