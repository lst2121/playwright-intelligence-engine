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

The server exposes three strongly typed production tools:

### Tool 1: `diagnose_trace`
Ingests a Playwright trace archive and returns failure classification, causal graph analysis, and diagnostic provenance.
- **Parameters**:
  - `tracePath` (string, required): Workspace-relative or absolute path to `trace.zip`.
- **Output Schema**:
  ```json
  {
    "content": [{ "type": "text", "text": "Diagnostic Report..." }],
    "classification": {
      "category": "LOCATOR_DRIFT",
      "confidence": 0.95,
      "reason": "Locator timed out...",
      "shouldAbstain": false
    },
    "causalGraph": {
      "nodes": [...],
      "edges": [...]
    }
  }
  ```

---

### Tool 2: `repair_page_object`
Safely refactors a Playwright Page Object file using `ts-morph` AST within the authorized workspace, with strict locator grammar and assertion immutability validation ($V = A \land T \land F \land I \land D \land E$).

**Two-Stage Workflow**:
1. **Proposal Mode (without `approvalToken`)**:
   Stages the proposal in `ApprovalService` in-memory. Returns `proposalId`, proposed unified diff, and staging metadata without modifying disk and without leaking auto-usable bearer tokens.
2. **Apply Mode (with `approvalToken`)**:
   Validates the token's cryptographic binding (target path, AST hash, diff hash, TTL) and promotes the patch atomically to the workspace using `WorkspacePromoter` (cooperative file lock, CAS source hash verification, and atomic `fs.renameSync`).

- **Parameters**:
  - `pomPath` (string, required): Path to Page Object file within workspace.
  - `testPath` (string, required): Path to test spec file within workspace.
  - `className` (string, required): Page Object class name.
  - `memberName` (string, required): Target locator member name.
  - `replacementSelector` (string, required): Replacement locator expression (e.g. `this.page.getByRole('button', { name: 'Submit' })`).
  - `approvalToken` (string, optional): Cryptographic single-use approval token required to apply changes to workspace.
- **Output Schema**:
  ```json
  {
    "status": "PROPOSED",
    "proposalId": "prop-1730761200000-a8f9",
    "diff": "--- a/src/pages/login.page.ts\n+++ b/src/pages/login.page.ts...",
    "preflightPassed": true,
    "instructions": "To apply this verified repair to the workspace, request human authorization and provide approvalToken."
  }
  ```

---

### Tool 3: `generate_playwright_test`
Generates enterprise-grade TypeScript Playwright Page Object and spec code with web-first assertions.
- **Parameters**:
  - `featureName` (string, required): Name of the feature or page (e.g. `"UserCheckout"`).
  - `baseUrl` (string, optional): Target application URL.
  - `steps` (array of objects, required): Array of interaction steps (`action`, `name`, `role`, `value`).
- **Output Schema**:
  ```json
  {
    "pageObjectName": "UserCheckoutPage",
    "pageObjectCode": "export class UserCheckoutPage { ... }",
    "specCode": "import { test, expect } from '@playwright/test'; ..."
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

