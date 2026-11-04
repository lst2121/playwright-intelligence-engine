# Model Context Protocol (MCP) Integration Guide

This document describes how to integrate the **Playwright Intelligence Engine** as a native Model Context Protocol (MCP) server for AI developer tools such as **Cursor**, **Claude Desktop**, and other MCP-compliant IDEs.

---

## 1. Overview of MCP Server Architecture

The engine includes a native JSON-RPC 2.0 stdio server implementation conforming to the official Model Context Protocol specification. It allows AI assistants to query Playwright trace diagnostics, score DOM candidates, and request verified repairs directly within the developer's chat or composer interface.

```mermaid
flowchart LR
    IDE["AI Client\n(Cursor / Claude Desktop)"] <-->|JSON-RPC 2.0 Stdio| MCPServer["PlaywrightIntelligenceMcpServer\n(src/mcp/server.ts)"]
    MCPServer <--> CoreEngine["Deterministic Engine\n(Diagnostics / Scorer / Sandbox)"]
```

---

## 2. Configuration & Setup

### 2.1. Cursor Configuration
In your project or global Cursor settings (`.cursor/settings.json` or global `settings.json`), add the server definition under `mcpServers`:

```json
{
  "mcpServers": {
    "playwright-intelligence": {
      "command": "node",
      "args": [
        "d:/Work/playwright-intelligence-engine/dist/index.js",
        "--mcp"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### 2.2. Claude Desktop Configuration
In Claude Desktop's configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "playwright-intelligence": {
      "command": "node",
      "args": [
        "D:\\Work\\playwright-intelligence-engine\\dist\\index.js",
        "--mcp"
      ]
    }
  }
}
```

---

## 3. Supported MCP Tools Reference

The server exposes four strongly typed tools:

### Tool 1: `diagnose_trace`
Ingests a Playwright trace archive and returns failure classification, causal graph analysis, and diagnostic provenance.
- **Parameters**:
  - `tracePath` (string, required): Absolute or relative path to `trace.zip`.
- **Output Schema**:
  ```json
  {
    "category": "LOCATOR_DRIFT",
    "confidence": 0.95,
    "failedAction": {
      "action": "click",
      "selector": "button#submit-order",
      "callId": "call@12"
    },
    "causalNetworkErrors": [],
    "remedyRecommendation": "Target locator drifted. Eligible for automated repair."
  }
  ```

---

### Tool 2: `score_candidates`
Extracts DOM candidates matching the failed action's required semantics, applies multi-factor scoring, and evaluates abstention policies.
- **Parameters**:
  - `tracePath` (string, required): Path to `trace.zip`.
  - `callId` (string, optional): Specific call ID to analyze (defaults to failed action).
- **Output Schema**:
  ```json
  {
    "candidatesEvaluated": 4,
    "topCandidate": {
      "selector": "getByRole('button', { name: 'Complete Checkout' })",
      "rawScore": 0.88,
      "calibratedProbability": 0.92,
      "strictUniqueness": true,
      "matchCount": 1
    },
    "abstentionDecision": {
      "shouldAbstain": false
    }
  }
  ```

---

### Tool 3: `plan_repair`
Generates an AST modification plan for the target Page Object and evaluates the Intent Invariant v2 without modifying any active files.
- **Parameters**:
  - `tracePath` (string, required): Path to `trace.zip`.
  - `targetPageObject` (string, required): Path to TypeScript Page Object file.
  - `specPath` (string, optional): Path to test spec file for invariant hashing.
- **Output Schema**:
  ```json
  {
    "targetPattern": "CLASS_PROPERTY_INITIALIZER",
    "originalSelector": "button#submit-order",
    "proposedSelector": "this.page.getByRole('button', { name: 'Complete Checkout' })",
    "intentInvariantPassed": true,
    "diffAllowlistPassed": true,
    "unifiedDiff": "--- a/src/pages/checkout.page.ts\n+++ b/src/pages/checkout.page.ts\n@@ -12,1 +12,1 @@\n-  readonly submitBtn = this.page.locator('button#submit-order');\n+  readonly submitBtn = this.page.getByRole('button', { name: 'Complete Checkout' });"
  }
  ```

---

### Tool 4: `execute_isolated_repair`
Executes end-to-end repair inside an isolated Git worktree, runs the test runner, and returns verified execution evidence.
- **Parameters**:
  - `tracePath` (string, required): Path to `trace.zip`.
  - `targetPageObject` (string, required): Path to TypeScript Page Object file.
  - `specPath` (string, required): Path to test spec file.
  - `configPath` (string, optional): Path to `playwright.config.ts`.
- **Output Schema**:
  ```json
  {
    "worktreeId": "repair-1730761200000",
    "executionExitCode": 0,
    "executionOutput": "1 passed (1.2s)",
    "intentInvariantSatisfied": true,
    "repairStatus": "VERIFIED_READY_FOR_APPROVAL"
  }
  ```

---

## 4. Error Handling & Standards Compliance

The server adheres strictly to JSON-RPC 2.0 specifications:
- `Invalid Request` (`-32600`): Returned when incoming payload is not valid JSON-RPC 2.0.
- `Method Not Found` (`-32601`): Returned when unknown RPC methods are invoked.
- `Invalid Params` (`-32602`): Returned when tool arguments fail validation.
- `Internal Error` (`-32603`): Returned on unhandled internal exceptions.
- `Tool Execution Error` (`-32000`): Returned when an engine tool encounters a domain or diagnostic error (e.g. `ZipSlipSecurityError` or `AbstentionError`).
