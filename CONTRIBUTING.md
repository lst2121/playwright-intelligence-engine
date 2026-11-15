# Contributing to Playwright Intelligence Engine (`pie`)

Thank you for your interest in contributing to **Playwright Intelligence Engine**!

PIE is an open-source, verification-first platform designed to solve Playwright flakiness, provide autonomous self-healing, and scaffold production-grade test suites with Page Object Model architectures.

---

## 1. Core Engineering Principles

When contributing code to PIE, keep these foundational invariants in mind:

1. **Verification-First Proof:**
   No repair or generated code is ever promoted to the user's workspace without empirical verification in an isolated headless Git worktree sandbox.
2. **Assertion Invariance:**
   PIE strictly prohibits mutating, weakening, or deleting test assertions (`expect(...)`). Locators and interactions may be repaired, but test intent and verification standards are immutable.
3. **Fail-Closed Negative Controls:**
   If a test failed due to environment issues (network disconnection, DNS resolution failure, backend HTTP 4xx/5xx responses), the engine must abstain from mutating UI locators.
4. **Deterministic Fast-Path First:**
   Always prioritize zero-token, zero-cost AST transformations (Tier 1) before falling back to semantic LLMs (Tier 2).

---

## 2. Development Setup

### Prerequisites
* **Node.js:** `>= 20.0.0` (Tested on Node 20, 22, 24)
* **npm:** `>= 10.0.0`
* **Git:** Installed and available in your `PATH`

### Getting Started

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/lst2121/playwright-intelligence-engine.git
   cd playwright-intelligence-engine
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the TypeScript source:**
   ```bash
   npm run build
   ```

4. **Run the test suite:**
   ```bash
   npm test
   # or run unit tests in watch mode:
   npx vitest
   ```

5. **Run typechecks:**
   ```bash
   npm run typecheck
   ```

---

## 3. Repository Architecture

```text
src/
├── authoring/       # Greenfield & brownfield test generation, naming planners, scaffolds
├── cli/             # Command-line interface definitions and workflow dispatchers
├── collectors/      # Evidence collection (network, live browser, git diff, error)
├── diagnostics/     # Causal evidence graph, failure classification, diagnostic reports
├── mcp/             # Model Context Protocol (MCP) JSON-RPC server and tool handlers
├── repair/          # Hybrid repair orchestrator, worktree promoter, AST patcher
├── sandbox/         # Isolated Git worktree execution manager and runner
├── selector/        # AST candidate extraction, multi-stage ranking, and abstention policies
└── trace/           # Playwright trace zip extraction, snapshot resolvers, adapters
```

---

## 4. How Can You Contribute?

### A. Enhancing Trace Ingestion & Resolvers
Support new Playwright features, trace version formats, or complex DOM snapshot edge cases in `src/trace/`.

### B. Expanding Locator Heuristics & Scorer Rules
Improve the deterministic selector scorer and ranker in `src/selector/` to discover more resilient accessible locators (e.g. ARIA roles, test IDs, Select2 triggers).

### C. Adding Benchmark Scenarios
Contribute real-world failure patterns and mutation cases to our empirical testbed to continuously evaluate healing accuracy and negative control precision.

### D. Documentation & Guides
Improve README clarity, write integration guides for various CI providers (GitHub Actions, GitLab CI, Jenkins), or improve IDE integration recipes (Cursor, Claude Code).

---

## 5. Pull Request Checklist

Before submitting your pull request, please verify:

- [ ] Code compiles without errors (`npm run build`).
- [ ] TypeScript typecheck passes cleanly with 0 errors (`npm run typecheck`).
- [ ] All unit and integration tests pass (`npm test`).
- [ ] New features or bug fixes include corresponding unit tests under `tests/unit/`.
- [ ] Commit messages follow standard conventional commits (e.g., `feat:`, `fix:`, `docs:`, `test:`).

Thank you for helping make Playwright test automation reliable and self-healing!
