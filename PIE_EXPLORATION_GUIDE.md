# PIE Exploration Guide — Stateful Live Verification & Evidence

This guide details Phase 2 of the pipeline (`InteractiveWorkflowRunner` and `ExplorationContextBundle`), explaining how PIE inspects live applications before writing automation.

---

## 1. Philosophy: Explore First, Automate Second

Automated test generators fail when they guess selectors, DOM nesting, and API routes from source text alone. `InteractiveWorkflowRunner` ([src/reproduce/interactive-workflow-runner.ts](file:///D:/Work/playwright-intelligence-engine/src/reproduce/interactive-workflow-runner.ts)) launches a single native Chromium session via Playwright, executes planned scenarios interactively, captures telemetry across four verification layers, and records only observed facts into `.pie/exploration-evidence.json`.

---

## 2. Single-Session Exploration & Route Sweep

1. **Multi-Route Discovery Sweep:** Starting from `--url`, the runner waits for network stabilization (`networkidle`), extracts same-origin `<a href>` links and `repoGraph.sourceHints.routes` (filtering out destructive routes like `/logout` or `/delete`), and visits up to 5 internal pages in the same authenticated session.
2. **Live Locator Verification:** On each route, `collectInteractiveControls()` inspects visible inputs, textboxes, checkboxes, comboboxes, buttons, links, alerts, and headings. Each control passes through `LiveLocatorVerifier.verify()` to measure `matchCount`, `visible`, `enabled`, and compute uniqueness confidence (`0.95` unique vs `0.5` ambiguous).
3. **Action Checkpoints:** After each planned scenario action (typing, submitting, reloading), the runner writes a JSON checkpoint (`exploration-evidence.json`). If a later action crashes or the process is interrupted, `InteractiveWorkflowRunner.resumeFromCheckpoint()` preserves prior verified evidence.

---

## 3. Four-Layer Verification Model

| Verification Layer | Evidence Mechanism | Possible Statuses |
|---|---|---|
| **UI** | Live DOM visibility, `innerText` diff before vs. after action, visible alerts/errors | `PASS`, `FAIL`, `NOT_VERIFIED`, `NOT_APPLICABLE` |
| **API** | Native `page.on('response')` & `NetworkCollector` capturing status codes (`2xx`, `4xx`, `5xx`), methods, URLs | `PASS`, `FAIL`, `NOT_VERIFIED`, `NOT_APPLICABLE` |
| **CLIENT_RELOAD** | Explicit `page.reload()` after stateful mutations to verify `localStorage` or session-backed UI state | `PASS`, `FAIL`, `NOT_VERIFIED`, `NOT_APPLICABLE` |
| **DB** | Optional read-only `dbVerifier` adapter hook (no mandatory PostgreSQL MCP required) | `PASS`, `FAIL`, `NOT_VERIFIED`, `NOT_APPLICABLE` |

> **Important Distinction:** `CLIENT_RELOAD: PASS` proves browser persistence (`localStorage`, session cookies, or API re-fetch). It never falsifies `DB: PASS` unless an independent read-only DB verifier confirms persistence.

---

## 4. Handling Authentication & Secrets Safely

1. **`storageState` Support:** Pass `--storage-state ./auth.json` via CLI or `storageStatePath` programmatically to explore behind authenticated sessions.
2. **Controlled Login (`loginConfig`):** Supply `{ loginUrl, usernameSelector, passwordSelector, submitSelector }` programmatically. Credentials are filled in memory only and **never** written to `exploration-evidence.json` or LLM context packets.
3. **URL & Token Redaction:** `sanitizeUrlSecrets()` and `EvidenceRedactor.redactText()` strip sensitive query strings (`?token=`, `?secret=`, `?api_key=`, `Bearer ...`) before persisting evidence.
4. **Destructive Action Policy:** Clicking actions containing `delete`, `destroy`, or `remove` outside localhost or without `allowDestructiveActions: true` in an explicitly `designatedTestEnvironment` is blocked and logged.

---

## 5. Exploration Context Bundle (`exploration-evidence.json`)

See a real captured bundle at [exploration-evidence.json](file:///D:/Work/playwright-intelligence-engine/samples/evidence-driven-qa/exploration-evidence.json). Top-level fields include:
- `topology`: `'monorepo' | 'standalone' | 'source-only'`
- `runtimeVerified`: boolean indicating whether live Playwright exploration succeeded
- `routes`: discovered pathnames, titles, and mapped locator IDs
- `locators`: indexed `loc-1..loc-N` entries with Playwright expressions and match counts
- `actions`: indexed `act-1..act-N` transitions with DOM diffs and reload outcomes
- `network`: sanitized request/response entries (`net-1..net-N`)
- `findings`: classified into `SPEC_VIOLATION`, `RUNTIME_ERROR` (e.g., HTTP `500`), `AUTOMATION_GAP`, `OBSERVED_BEHAVIOR`, or `NOT_VERIFIED`.
