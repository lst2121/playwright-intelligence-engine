---
title: "Building a Safer Repair Loop for Playwright"
subtitle: "A verification-first workflow for diagnosing broken UI tests, repairing locator drift, and preserving the signal of real regressions."
author: "[EDITORIAL INSERT: author name]"
status: "First editorial draft — review all [EDITORIAL INSERT] markers before publishing"
recommended_read_time: "7–9 minutes"
---

# Building a Safer Repair Loop for Playwright

*A verification-first workflow for diagnosing broken UI tests, repairing locator drift, and preserving the signal of real regressions.*

> **[EDITORIAL INSERT — cover image]**
>
> Use a clean, product-led image: a Playwright trace flowing into a decision gate and then into either “repair” or “investigate application.” Avoid robots, glowing brains, generic “AI” art, dashboards, or terminal collages.

At 2:14 AM, a Playwright job fails in CI.

The message is familiar:

```text
locator.click: Test timeout exceeded
waiting for locator('#login-button-old')
```

The usual workflow is familiar too. Someone opens the trace, looks at the page, finds the renamed button, changes a locator, pushes a commit, and waits for CI to run again.

Sometimes that is exactly the right fix.

But a missing button can also be the visible consequence of a backend failure, an expired session, a broken fixture, a stale database, a page that never reached the expected state, or a test that was wrong before the application changed. In those cases, changing the locator does not repair the test. It removes evidence.

That distinction is the reason we built **PIE — the Playwright Intelligence Engine**.

PIE is a command-line tool for Playwright teams that starts from a failed trace and asks a deliberately conservative question:

> Is there enough evidence that this is a test-level failure to propose a repair — and can that repair prove itself before it reaches the working tree?

This is not a story about making every failed test disappear. It is about building a safer repair loop: one that can repair a common UI drift, stop when the application is unhealthy, and reject a patch that merely looks plausible.

## The hidden work behind a one-line fix

The code change behind a locator repair may be one line. The engineering judgment behind it is not.

Consider a test that cannot find a “Login” button. Before editing the test, a careful engineer may need to answer all of these questions:

- Did the accessible name change, or is the page in the wrong state?
- Did the application return an error while the page loaded or submitted?
- Is the test running with the expected authentication state and data?
- Is there one matching element, or several?
- Does the replacement preserve the original test intent?
- Does the replacement work when the test runs again from a clean state?

The expensive part of test maintenance is rarely typing a new selector. It is reconstructing the cause of the failure with enough confidence to change code safely.

Playwright already gives teams unusually rich evidence through traces: action history, screenshots, DOM snapshots, console output, and network activity. PIE is designed to use that evidence as a repair boundary rather than treating a timeout message as a free invitation to rewrite a test.

## A different repair loop

The workflow PIE is built around is intentionally small:

```text
Failed Playwright trace
          |
          v
Was an application or environment failure observed?
          |
     +----+----+
     |         |
    yes       no
     |         |
     v         v
Report the    Propose a targeted locator repair
application                |
failure                    v
                     Verify in an isolated worktree
                              |
                         +----+----+
                         |         |
                       pass      fail
                         |         |
                         v         v
                    Apply or    Reject the candidate
                    stage fix   and leave source untouched
```

There are three ideas worth understanding.

### 1. Diagnose before repairing

PIE reads the trace before it proposes a code change. If the evidence includes an application-level failure — for example, an HTTP 500 during the action under test — PIE can classify that failure and abstain from locator repair.

That matters because a broken application and a broken locator deserve different next actions. One belongs in an application investigation; the other may be repairable in the test code.

### 2. Prefer deterministic evidence first

For straightforward locator drift, PIE attempts a deterministic, local repair path before requesting a semantic model. This is useful for simple changes such as an obsolete selector where trace evidence identifies a stable role, label, test id, or other supported locator.

When the local evidence is not enough, PIE can use a semantic fallback. That fallback is not a license to edit broadly: the candidate still has to preserve the test’s assertions and pass verification.

### 3. Verify the candidate away from the active workspace

The most important step is not generating a replacement locator. It is proving that the replacement works.

PIE uses an isolated Git worktree for verification. The candidate patch is exercised outside the active checkout. If verification fails, the candidate is rejected rather than quietly promoted as a “likely fix.”

This is a practical distinction:

> A patch that looks correct from a trace is not automatically a patch that is correct in a running suite.

## What using PIE looks like

PIE is meant to sit beside an existing Playwright project. It does not require teams to replace their test runner, Page Object Model, fixtures, or CI provider.

Start by checking the local environment:

```bash
npx pie doctor
```

Then initialize project-local configuration if needed:

```bash
npx pie init
```

For repair work, make sure Playwright retains a trace for failures. For example:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

Run the affected test with tracing enabled:

```bash
npx playwright test tests/login.spec.ts --trace=on
```

If the run produces a failing `trace.zip`, PIE can first diagnose it without changing code:

```bash
npx pie diagnose test-results/<failed-test>/trace.zip
```

For a repair run across the traces in `test-results`, use dry-run mode first:

```bash
npx pie repair
```

When the output and proposed diff are acceptable, apply only verified repairs:

```bash
npx pie repair --apply --verbose
```

For a single trace in a review-oriented workflow, use the targeted command:

```bash
npx pw-intel repair test-results/<failed-test>/trace.zip --execute
```

> **[EDITORIAL INSERT — product screenshot]**
>
> Insert a real screenshot of `npx pie repair --apply --verbose` here. Redact paths, API keys, user names, and proprietary test titles. Use captured terminal output, not recreated output.

## How to read the terminal output

The terminal result is deliberately more important than a green “fixed” message. It tells the developer which decision PIE made and why.

### `REPAIRED_AND_VERIFIED`

This means PIE found a candidate, verified it in isolation, and — only when `--apply` was supplied — promoted the verified edit.

The output should be read as a review item, not a reason to skip review. Look for:

- **Target file:** which spec or Page Object will change.
- **Diff:** the exact locator replacement.
- **Tier:** whether deterministic matching or the semantic fallback was used.
- **Reason/evidence:** why the new locator was selected.
- **Verification result:** confirmation that isolated execution completed successfully.
- **Telemetry:** token and cost information when a semantic model was used.

An example of the *shape* of a successful result is:

```json
{
  "status": "REPAIRED_AND_VERIFIED",
  "tier": "tier1_deterministic",
  "targetFilePath": "pages/LoginPage.ts",
  "healedLocator": "page.getByRole('button', { name: 'Login' })",
  "reason": "The failed selector was obsolete; the trace identified a matching Login button.",
  "promotedFiles": ["pages/LoginPage.ts"]
}
```

The field names and surrounding output can differ by mode and version. The important part is the decision: candidate, evidence, isolated verification, then promotion.

### `ABSTAINED`

This is not an error outcome. It is the correct outcome when PIE sees evidence that the application or environment failed during the test.

For example:

```text
status: ABSTAINED
tier: negative_control
reason: Backend server failure (HTTP 500) observed during the login request.
promotedFiles: []
```

In that case, the useful next action is to investigate the service failure, not to search for another UI locator. PIE also provides a `report-defect` command for turning an appropriate trace into an issue-oriented diagnostic artifact:

```bash
npx pw-intel report-defect test-results/<failed-test>/trace.zip
```

### `VERIFICATION_FAILED` or `REJECTED`

These results mean PIE could formulate a candidate but could not prove that it worked. This is valuable information. It can indicate an ambiguous locator, missing test state, framework timing, an unrelated failure, or a candidate that simply was not good enough.

The correct response is not to count that case as repaired. Review the trace, inspect the candidate diff, and investigate the failing verification run.

### `INPUT_REQUIRED`

PIE can refuse to guess when it cannot map the trace to a unique test or Page Object location safely. Supply the requested context or use the targeted command with the relevant test and Page Object details.

## A concrete example: repairing locator drift

Imagine a login test that was written against an older selector:

```ts
await page.locator('#doLogin_outdated_v2').click();
```

The application still exposes a Login button, but the old identifier no longer exists. The trace contains the failed action and the page state at the failure.

After diagnosis, a conservative repair may replace the stale selector with an accessible locator:

```diff
- await page.locator('#doLogin_outdated_v2').click();
+ await page.getByRole('button', { name: 'Login' }).click();
```

The important point is not that role locators are always better than CSS. The important point is that the replacement is grounded in trace evidence and must survive isolated execution before it is applied.

> **[EDITORIAL INSERT — before/after visual]**
>
> Use a two-panel visual: left side shows the failed action in the Playwright trace; right side shows the compact code diff. Do not show internal implementation code.

## The safety case: when a repair would be the wrong response

Now consider a login flow that submits correctly but receives an HTTP 500 from its authentication endpoint.

The user-facing symptom may still look like a failed assertion or a missing post-login element. A repair system that changes the test’s expected page, selector, or assertion could turn an application regression into a passing test.

PIE’s intended behavior is to stop:

```text
Application failure detected during the tested action.
Repair skipped.
No source files promoted.
```

That is the central product principle behind PIE. The tool should help distinguish “the test drifted” from “the application needs attention,” not blur the two.

## Where PIE is today

PIE has been exercised on controlled locator-drift and application-failure scenarios. Those exercises demonstrated verified repairs in multiple cases, a correct backend-failure abstention, and at least one candidate that was rejected because verification did not pass.

That last category is important. Verification-first repair is useful precisely because it gives the system permission to say: *this candidate may be reasonable, but the evidence is not yet sufficient to apply it.*

PIE should be evaluated like any engineering tool: on representative traces, with source review, and with a clear boundary between demonstrated behavior and future capability.

The current focus is:

- trace-driven diagnosis of failed Playwright tests;
- conservative locator repair;
- isolated verification before code promotion;
- application-failure abstention;
- repository-aware planning and generation workflows that remain subject to review.

## A better next step after a failing test

When the next Playwright failure lands in CI, the question does not have to be “which selector should we try?”

It can be:

> What does the trace prove, and what is the safest next action?

Sometimes that action is a verified locator repair. Sometimes it is an application issue. Sometimes it is a test-data or environment problem. And sometimes it is a candidate that should be rejected until there is better evidence.

That is the repair loop PIE is built to support.

---

## Publication checklist

- [ ] Replace author name and cover image placeholder.
- [ ] Confirm npm package name and version: `playwright-intelligence-engine`.
- [ ] Insert the real GitHub URL: `https://github.com/lst2121/playwright-intelligence-engine`.
- [ ] Add one real terminal screenshot and one real trace/diff visual.
- [ ] Confirm every terminal field shown matches the version being published.
- [ ] Link to the DEV Community tutorial after it is published.
- [ ] Add relevant Medium tags: `Playwright`, `Testing`, `Developer Tools`, `Quality Engineering`, `TypeScript`.
- [ ] Read once aloud and remove any sentence that sounds like a guarantee.

## Optional closing links

- GitHub: [EDITORIAL INSERT: repository URL]
- npm: [EDITORIAL INSERT: package URL]
- DEV tutorial: [EDITORIAL INSERT: article URL]
- Issue tracker: [EDITORIAL INSERT: issue URL]
