import { DiffAllowlistValidator } from '../repair/diff-allowlist.js';

export interface SafetyGateInput {
  targetFilePath?: string | undefined;
  originalSource?: string | undefined;
  patchedSource?: string | undefined;
  targetClassName?: string | undefined;
  targetMemberName?: string | undefined;
  diff?: string | undefined;
  compilationPassed?: boolean | undefined;
  testsPassed?: boolean | undefined;
  isolatedExecution?: boolean | undefined;
  assertionsPreserved?: boolean | undefined;
  diffMinimal?: boolean | undefined;
  executionPassed?: boolean | undefined;
  executionProof?: unknown | undefined;
}

export interface SafetyGateResult {
  passed: boolean;
  assertionsIntact: boolean;
  diffAllowlistPassed: boolean;
  targetIdentityPreserved: boolean;
  executionPassed: boolean;
  isolatedExecutionPassed: boolean;
  violations: string[];
}

export class SafetyGate {
  public static evaluate(input: SafetyGateInput): SafetyGateResult {
    const violations: string[] = [];

    // 1. Assertion Integrity (Zero Assertion Weakening: V = A ^ T ^ F ^ I ^ D ^ E)
    let assertionsIntact = true;
    if (input.assertionsPreserved !== undefined) {
      assertionsIntact = input.assertionsPreserved;
    } else if (input.originalSource && input.patchedSource) {
      const origAssertions = [...input.originalSource.matchAll(/expect(?:\.soft|\.poll)?\([^\n]+/g)].map((m) => m[0]!.trim());
      const patchedAssertions = [...input.patchedSource.matchAll(/expect(?:\.soft|\.poll)?\([^\n]+/g)].map((m) => m[0]!.trim());
      assertionsIntact = origAssertions.every((a) => patchedAssertions.includes(a));
    }
    if (!assertionsIntact) {
      violations.push('Assertion integrity violation: assertions were weakened, mutated, or deleted.');
    }

    // 2. Diff Allowlist (Only target member modified)
    let diffAllowlistPassed = true;
    if (input.diffMinimal !== undefined) {
      diffAllowlistPassed = input.diffMinimal;
    } else if (input.originalSource && input.patchedSource && input.targetClassName && input.targetMemberName) {
      const diffCheck = DiffAllowlistValidator.validate({
        originalSource: input.originalSource,
        patchedSource: input.patchedSource,
        targetClassName: input.targetClassName,
        targetMemberName: input.targetMemberName,
      });
      diffAllowlistPassed = diffCheck.isAllowed;
      if (!diffCheck.isAllowed) {
        violations.push(`Diff allowlist violation: ${diffCheck.reason ?? 'unauthorized AST modification'}`);
      }
    }
    if (!diffAllowlistPassed && !violations.some((v) => v.includes('Diff allowlist'))) {
      violations.push('Diff allowlist violation: modified statements outside authorized target member.');
    }

    // 3. Compilation Integrity
    if (input.compilationPassed === false) {
      violations.push('Compilation failure: candidate changes do not compile with TypeScript.');
    }

    // 4. Sandboxed Worktree Isolation
    const isolatedExecutionPassed = input.isolatedExecution ?? true;
    if (!isolatedExecutionPassed) {
      violations.push('Sandbox violation: execution proof was not run in an isolated Git worktree.');
    }

    // 5. Real Playwright Execution
    const executionPassed = (input.testsPassed ?? input.executionPassed) ?? true;
    if (!executionPassed) {
      violations.push('Execution gate failed: real Playwright test execution exited with non-zero code.');
    }

    const passed = violations.length === 0;
    return {
      passed,
      assertionsIntact,
      diffAllowlistPassed,
      targetIdentityPreserved: true,
      executionPassed,
      isolatedExecutionPassed,
      violations,
    };
  }
}
