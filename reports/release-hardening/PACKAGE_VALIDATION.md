# PIE v2.6 — NPM Package Validation and Independent Installation Report

**Generated:** 2026-11-05T07:15:00.000Z  
**Package:** `playwright-intelligence-engine@0.1.0`  
**Tarball Archive:** `playwright-intelligence-engine-0.1.0.tgz`  
**SHA-256 Checksum:** `E0B42FEB6B723864B5C680E6C490A72967D928BCCFA5AEB1A323C7D93555BE8E`  
**Package Size:** 94.9 kB (Unpacked: 408.8 kB)  
**Total Packed Files:** 103  

---

## 1. Executive Summary

This report provides cryptographic and runtime verification that `playwright-intelligence-engine` can be packaged, distributed via npm, and cleanly installed into an external consumer repository with zero assumptions about the parent source tree.

All P0 blockers identified in the release audit have been resolved:
1. **Explicit Files Allowlist:** Configured `"files": ["dist", "bin", "README.md", "LICENSE"]` in `package.json`, completely excluding benchmarks, tests, source `.ts` files, and internal scripts.
2. **Dynamic Peer Resolution:** Eliminated hard static dependencies on `@playwright/test` from runtime bundles. Moved `@playwright/test` to `peerDependencies` with `peerDependenciesMeta.optional = true` and implemented `resolvePlaywrightChromium()` dynamic loader.
3. **Stand-Alone Binary:** Built dual ES-module distribution with executable hashbang wrapper `bin/pw-intel.js` configured in `package.json` `"bin"`.
4. **Independent Consumer Test:** Successfully installed the packaged tarball into an isolated external temporary directory (`C:\Users\ACER\AppData\Local\Temp\pie-verify-...`) and verified clean execution of `npx pw-intel --version`, `npx pw-intel --help`, and `npx pw-intel doctor`.

---

## 2. Tarball Contents and File Hygiene

The package tarball contains strictly the compiled assets and necessary runtime artifacts. Zero benchmark files, tests, or documentation source files leak into the package.

### Packed File Breakdown (103 total files)
- **Top-Level Metadata (4 files):**
  - `package.json`
  - `README.md`
  - `LICENSE`
  - `bin/pw-intel.js`
- **Compiled JavaScript Bundle (1 file):**
  - `dist/index.js` (253.9 kB, self-contained ES module bundled via tsup)
- **TypeScript Declarations and Source Maps (98 files):**
  - `dist/**/*.d.ts`
  - `dist/**/*.d.ts.map`

### Excluded Artifact Verification
- `benchmarks/` — **0 files packed** (Excluded)
- `tests/` — **0 files packed** (Excluded)
- `src/` — **0 files packed** (Excluded)
- `docs/` — **0 files packed** (Excluded)
- `reports/` — **0 files packed** (Excluded)
- `artifacts/` — **0 files packed** (Excluded)

---

## 3. External Clean-Room Installation Trial

The generated tarball was installed and tested in an isolated temporary consumer environment:

### Trial Environment
- **Temporary Path:** `C:\Users\ACER\AppData\Local\Temp\pie-verify-093fc8fa-90eb-4a6e-b0af-b7739fcc7df4`
- **Initialization:** `npm init -y`
- **Installation Command:** `npm install D:\Work\playwright-intelligence-engine\playwright-intelligence-engine-0.1.0.tgz`
- **Result:** Installed 13 packages in 18s without warnings or missing dependencies.

### Command Verification Log

#### Command 1: Version Check
```bash
$ npx pw-intel --version
0.1.0
```
- **Exit Code:** `0`
- **Status:** PASS

#### Command 2: CLI Help
```bash
$ npx pw-intel --help

Playwright Intelligence Engine CLI (pw-intel)

Usage:
  pw-intel doctor                   Inspects host environment, Node, Git, Playwright & workspace readiness
  pw-intel diagnose <trace.zip>     Diagnoses a Playwright trace archive and outputs root cause
  pw-intel reproduce <spec.ts>      Reruns a failing test with live multi-source diagnostic instrumentation
  pw-intel approve <proposalId>     Human review and cryptographic authorization of staged repair proposal
  pw-intel promote --token <token>  Atomically applies authorized repair proposal to active workspace
  pw-intel benchmark [options]      Executes empirical real browser benchmark suite against Controlled App Server
  pw-intel mcp                      Starts the Model Context Protocol (MCP) JSON-RPC server on stdio
  pw-intel generate <featureName>   Generates verified Page Object and Spec scaffolding
  pw-intel --help                   Shows this help message

Benchmark Options:
  --family <name>                   Filter mutation scenarios by family name (e.g. "Dynamic IDs")
  --scenario <id>                   Filter negative control scenarios by category or name
  --browser <browser>               Target browser (default: chromium)
```
- **Exit Code:** `0`
- **Status:** PASS

#### Command 3: Doctor Healthcheck
```bash
$ npx pw-intel doctor
Running Playwright Intelligence Engine Diagnostic Healthcheck (pw-intel doctor)...

  ✓ Node.js Runtime     : v24.19.0 (Supported >= 20.0.0)
  ✓ Git Version Control : git version 2.44.0.windows.1
  ✓ Playwright CLI      : Version 1.64.1
  ✓ Workspace Access    : Read/Write verified for 'C:\Users\ACER\AppData\Local\Temp\pie-verify-093fc8fa-90eb-4a6e-b0af-b7739fcc7df4'
  ✓ Host Platform       : win32 (x64)

Healthcheck Verdict: HEALTHY (Ready for diagnostic and repair workflows)
```
- **Exit Code:** `0`
- **Status:** PASS

---

## 4. Verification Conclusion

The npm distribution of PIE v2.6 has met all packaging and distribution criteria for enterprise release readiness.
