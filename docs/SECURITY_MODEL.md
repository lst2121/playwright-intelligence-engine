# Enterprise Security Model & Threat Mitigation Specification (v2.5)

This document specifies the threat model, attack vectors, defensive controls, and cryptographic governance enforced across the **Playwright Intelligence Engine**.

---

## 1. Enterprise Threat Model & Defense Matrix

In enterprise environments, test reliability platforms ingest untrusted trace files, process error output from third-party libraries, interact with Git version control, and execute test scripts. The engine mitigates all six primary attack vectors through fail-closed architectural controls:

```mermaid
graph TD
    Attacker[Adversary / Weaponized Input] --> T1[Vector 1: Malicious Trace ZIP]
    Attacker --> T2[Vector 2: Arbitrary Command & Code Injection]
    Attacker --> T3[Vector 3: Prompt & AST Injection via Locators]
    Attacker --> T4[Vector 4: PII, Credential & Header Exfiltration]
    Attacker --> T5[Vector 5: Unauthorized Active-Branch Disk Mutation]
    Attacker --> T6[Vector 6: Subprocess Hang & Zombie Runner Exhaustion]

    T1 --> D1[Zip-Slip Traversal & 10:1 Ratio Zip-Bomb Defense]
    T2 --> D2[execFile Argument Arrays & Sanitized Env Whitelist]
    T3 --> D3[Deep Recursive AST Locator Grammar Validation]
    T4 --> D4[Automated Multi-Channel Redaction & Scrubbing]
    T5 --> D5[Isolated Worktrees & Cryptographic Approval Service]
    T6 --> D6[taskkill /T /F Windows Tree Termination & 16MB Bounded Buffers]
```

---

## 2. Archive Ingestion Security (`ArchiveReader`)

### 2.1. Canonical Zip-Slip Traversal Defense
- **Attack**: Weaponized archive containing paths with relative traversal tokens (`../../../../etc/passwd` or `..\..\..\windows\system32\cmd.exe`) designed to write outside destination directories.
- **Mitigation**:
  Every zip entry path is resolved and validated:
  ```typescript
  const resolved = path.resolve(destDir, entry.entryName);
  if (!resolved.startsWith(destDir + path.sep)) {
    throw new ZipSlipSecurityError(`Path traversal attempt detected: ${entry.entryName}`);
  }
  ```
  Verified across 10 traversal path test variants.

### 2.2. Compression Bomb (Zip-Bomb) Defense
- **Attack**: Micro-sized archives (e.g., 20 KB) expanding into tens of gigabytes, exhausting memory and disk.
- **Mitigation**:
  1. **Maximum Uncompressed Aggregate Size**: Bounded at **100 MB** (`DEFAULT_MAX_SIZE = 100 * 1024 * 1024`).
  2. **Maximum Compression Ratio**: Capped at **10:1** (`MAX_COMPRESSION_RATIO = 10`). Decompression aborts immediately if expansion exceeds this ratio.
  3. **Maximum Single Entry Size**: Capped at **50 MB** (`MAX_SINGLE_ENTRY_SIZE = 50 * 1024 * 1024`).
  4. **Maximum Entry Count**: Hard cap of **10,000 entries**.

### 2.3. Cross-Worker Stream Correlation
- **Attack**: Mismatching `.trace` actions with a different worker's `.network` events in multi-worker runs.
- **Mitigation**: Correlates streams using matching worker/stream ID prefixes (e.g., `0.trace` correlates strictly with `0.network`).

---

## 3. AST Locator Grammar & Injection Defense (`DiffAllowlistValidator`)

- **Attack**: Injecting malicious JavaScript/TypeScript into Page Object replacements (e.g. `process.env.SECRET`, `eval(...)`, `fs.unlinkSync(...)`, or template interpolation `${exploit}`).
- **Mitigation**:
  `DiffAllowlistValidator.validateLocatorGrammar` performs deep recursive AST validation:
  1. **Whitelisted Methods Only**: Only approved Playwright locator methods are allowed (`locator`, `getByRole`, `getByText`, `getByTestId`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle`).
  2. **Whitelisted Root Callers**: Caller must be `this.page`, `this._page`, `this.browserPage`, or `page`.
  3. **Recursive Argument Inspection**:
     - String, numeric, and boolean literals are permitted.
     - Option objects (`{ name, exact, hasText, timeout }`) are validated; any nested `has` or `hasNot` options are recursively checked for locator grammar compliance.
     - Rejects all function calls, arrow functions, identifiers, member accesses, `process.env`, template strings with expressions, and statements.

---

## 4. Subprocess Execution & Process Tree Safety (`ExecutionRunner`)

- **Attack**: Shell injection via arguments, child process hangs holding CI locks, buffer exhaustion, environment secret leakage.
- **Mitigation**:
  1. **Zero Shell Interpolation**: Commands execute via `child_process.spawn` using explicit argument arrays. On Windows, `cmd.exe /d /s /c` is only invoked with pre-tokenized arguments for `.cmd` batch commands.
  2. **Environment Variable Sanitization Whitelist**: Child processes receive ONLY approved system keys (`PATH`, `SYSTEMROOT`, `TEMP`, `NODE_ENV`, etc.). Cloud API keys, AWS credentials, GitHub tokens, and developer secrets are stripped.
  3. **Bounded Buffer Accumulators**: `stdout` and `stderr` streams enforce a strict **16 MB buffer cap**.
  4. **Process Tree Termination**: On timeout, Windows processes and all spawned child processes are terminated using `taskkill /pid <PID> /T /F`.
  5. **Truthful Signal Exit Codes**: Signal-terminated processes are never mapped to 0; they are assigned `128 + signal` or non-zero exit codes.

---

## 5. Worktree Containment & Symlink Traversal Defense (`WorktreeManager`)

- **Attack**: Traversal out of `.pw-intelligence/worktrees/` via invalid IDs, dot-dot paths, or symlink/junction redirection.
- **Mitigation**:
  1. **Strict Identifier Whitelist**: Worktree IDs must match `/^[a-zA-Z0-9_-]{1,64}$/`.
  2. **Canonical Path Containment**: Resolves paths using `fs.realpathSync` to guarantee worktrees and referenced files reside strictly inside the repository boundary.
  3. **Dependency Strategy Validation**: Worktrees link `node_modules` via verified directory junctions; `strategy.validate(worktreePath)` executes after every preparation step.

---

## 6. Centralized Cryptographic Approval Service (`ApprovalService`)

- **Attack**: Automated direct-write bypasses modifying master or feature branches without human review.
- **Mitigation**:
  1. Direct file modifications through MCP tools (`repair_page_object`) or CLI commands require a single-use cryptographic approval token.
  2. Tokens are generated using `crypto.randomBytes(32).toString('hex')` (256-bit entropy).
  3. Tokens bind to:
     - Target canonical file path (`fs.realpathSync`).
     - Original source SHA-256 hash.
     - Patch SHA-256 hash.
     - 10-minute expiration TTL.
  4. Consumption is atomic and one-time: tokens cannot be reused or applied to altered files.
  5. Assertion hashes are validated before and after patch application; if assertions drift, changes are atomically rolled back.

---

## 7. Multi-Channel Evidence Redactor (`EvidenceRedactor`)

- **Attack**: Exposure of PII, passwords, authentication headers, or payment card details in logs and diagnostic reports.
- **Mitigation**:
  1. **Header Scrubbing**: Automatically scrubs `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `Proxy-Authorization`, and custom auth headers (`[REDACTED]`).
  2. **Pattern Scrubbing**:
     - Bearer tokens: `Bearer [REDACTED]`
     - JWT tokens: `[JWT_TOKEN_REDACTED]`
     - Credit card numbers / PANs (13-19 digits): `[CARD_REDACTED]`
     - Social Security Numbers: `[SSN_REDACTED]`
     - Basic Auth credentials in URLs: `https://[USER:PASS_REDACTED]@...`
  3. **Recursive Payload Redaction**: Sanitizes nested JSON objects and arrays before storage or transmission.
