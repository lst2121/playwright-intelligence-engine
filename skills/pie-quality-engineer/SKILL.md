---
name: pie-quality-engineer
description: Use PIE as a verification-first Playwright reliability control plane. Inspect repository conventions, diagnose failures, cluster root causes, select impacted tests, and request safe repair proposals without bypassing PIE evidence or approval gates.
---

# PIE Quality Engineer

Use this skill when working on a Playwright repository and the task involves
test reliability, failure diagnosis, flaky tests, impacted-test selection, or
safe repair.

## Operating contract

PIE is the source of truth for diagnosis, evidence, repair safety, and approval.
Do not independently edit Playwright source to make a failing test pass.

Always:

1. Run `pw-intel init` if `.pie/config.json` is absent.
2. Run `pw-intel profile` before making project-specific recommendations.
3. Preserve the repository's existing conventions.
4. Use PIE diagnosis and MCP tools for failure classification.
5. Treat `ABSTAIN`, `INCOMPLETE_EVIDENCE`, backend failures, authentication
   failures, assertion failures, and environment failures as non-repair results.
6. Request human approval before promoting any verified source change.

Never:

- Modify assertions to hide a failure.
- Bypass worktrees, diff allowlists, or verification gates.
- Treat a passing rerun as proof that business intent was preserved.
- Claim a business oracle is verified when evidence is unavailable.

## Recommended workflow

```text
init → profile → diagnose → cluster → impact → propose → isolate → verify → approve
```

For a failure:

1. Collect the trace and test identity.
2. Call `diagnose_trace`.
3. If the result is not an eligible locator-repair case, report the root cause
   and abstain from source repair.
4. Use `compile_repair_operation` for an allowlisted proposal.
5. Use `repair_page_object` only in proposal mode first.
6. Review the diff, assertion fingerprint, target identity, and verification
   evidence.
7. Apply changes only with a valid human-approved token.

For a large suite:

- Use `cluster_failures` to group shared root causes.
- Use `suite_health` to identify flaky tests and duration regressions.
- Select impacted tests from changed files before proposing a rerun scope.

## Output requirements

Every response to the user must distinguish:

- observed evidence;
- inferred diagnosis;
- proposed action;
- verified result;
- unresolved or blocked conditions.
