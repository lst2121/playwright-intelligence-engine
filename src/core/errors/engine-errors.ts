export class PlaywrightIntelligenceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PlaywrightIntelligenceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedTraceVersionError extends PlaywrightIntelligenceError {
  constructor(version: number | string, message?: string) {
    super(
      message ?? `Unsupported Playwright trace version: ${version}`,
      'UNSUPPORTED_TRACE_VERSION'
    );
    this.name = 'UnsupportedTraceVersionError';
  }
}

export class TraceCorruptedError extends PlaywrightIntelligenceError {
  constructor(path: string, reason: string) {
    super(`Trace archive at ${path} is corrupted: ${reason}`, 'TRACE_CORRUPTED');
    this.name = 'TraceCorruptedError';
  }
}

export class ZipSlipSecurityError extends PlaywrightIntelligenceError {
  constructor(entryPath: string) {
    super(
      `Security violation: Zip entry ${entryPath} attempts path traversal outside target directory`,
      'ZIP_SLIP_ATTACK_DETECTED'
    );
    this.name = 'ZipSlipSecurityError';
  }
}

export class AbstentionError extends PlaywrightIntelligenceError {
  constructor(public readonly reason: string, public readonly failureCategory: string) {
    super(`Engine abstains from repair: ${reason} (Category: ${failureCategory})`, 'REPAIR_ABSTAINED');
    this.name = 'AbstentionError';
  }
}

export class AssertionTamperedError extends PlaywrightIntelligenceError {
  constructor(expectedFingerprint: string, actualFingerprint: string) {
    super(
      `Intent violation: Assertion SHA-256 fingerprint changed after patch (expected ${expectedFingerprint}, got ${actualFingerprint})`,
      'ASSERTION_TAMPERED'
    );
    this.name = 'AssertionTamperedError';
  }
}

export class WorktreeOperationError extends PlaywrightIntelligenceError {
  constructor(operation: string, details: string) {
    super(`Worktree operation '${operation}' failed: ${details}`, 'WORKTREE_ERROR');
    this.name = 'WorktreeOperationError';
  }
}

export class UnauthorizedAstModificationError extends PlaywrightIntelligenceError {
  constructor(details: string) {
    super(
      `Diff allowlist violation: Unauthorized AST modification detected (${details}). Only targeted locator declarations may be altered.`,
      'UNAUTHORIZED_AST_MODIFICATION'
    );
    this.name = 'UnauthorizedAstModificationError';
  }
}

export class IntentInvariantViolationError extends PlaywrightIntelligenceError {
  constructor(invariantName: string, details: string) {
    super(
      `Intent Invariant v2 violation [${invariantName}]: ${details}`,
      'INTENT_INVARIANT_VIOLATION'
    );
    this.name = 'IntentInvariantViolationError';
  }
}

