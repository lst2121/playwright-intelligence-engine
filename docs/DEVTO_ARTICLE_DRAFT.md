---
title: "Repair a Broken Playwright Locator from a Trace with PIE"
published: false
description: "A hands-on, verification-first walkthrough for diagnosing a failing Playwright trace, repairing a drifted locator, and recognizing when PIE should abstain."
tags: playwright, testing, typescript, automation
cover_image: "[EDITORIAL INSERT: optional DEV cover image URL]"
canonical_url: "[EDITORIAL INSERT: leave blank or use Medium canonical URL if cross-posting]"
---

# Repair a Broken Playwright Locator from a Trace with PIE

Playwright failures are often easy to describe and hard to classify.

```text
waiting for locator('#checkout-button-old')
```

That could mean the selector is stale. It could also mean the user was redirected to login, the page loaded an error state, a fixture did not create the expected data, or the application returned an HTTP 500.

This tutorial shows a practical workflow with **PIE (Playwright Intelligence Engine)**:

1. capture a real Playwright trace;
2. diagnose the failure before changing code;
3. run a verification-first locator repair;
4. read the terminal result;
5. confirm that PIE abstains when the application itself is failing.

The goal is not to automate away every failed test. The goal is to make the next action more evidence-driven.

> **[EDITORIAL INSERT]**
>
> If the npm package has not been published at the time of publication, change installation commands to the intended package-installation method and set `published: false` until they work from a clean project.

## What PIE does

PIE is a CLI for Playwright projects. Its repair loop is:

```text
trace.zip
  ↓
diagnose the failed action, DOM, network, and console evidence
  ↓
application failure detected? ── yes ──> abstain
  ↓ no
propose a targeted locator repair
  ↓
verify outside the active workspace
  ↓
apply only verified changes
```

In practice, you will use these commands most often:

| Command | When to use it |
| --- | --- |
| `npx pie doctor` | Before the first run; checks local readiness. |
| `npx pie init` | Creates project-local PIE configuration. |
| `npx pie diagnose <trace.zip>` | Understand a trace without changing source. |
| `npx pie repair` | Dry-run repair across discovered failure traces. |
| `npx pie repair --apply --verbose` | Apply only repairs that complete verification. |
| `npx pw-intel repair <trace.zip> --execute` | Target a single trace in a review-oriented workflow. |
| `npx pw-intel report-defect <trace.zip>` | Turn a supported application-failure trace into a defect-oriented report. |

## Prerequisites

- Node.js 20 or later;
- a Git repository — isolated worktree verification relies on Git;
- an existing Playwright project with `@playwright/test` installed;
- a failing Playwright trace, or a safe local/staging environment where you can create one.

Install PIE in the Playwright project:

```bash
npm install --save-dev playwright-intelligence-engine
```

Check the command and the environment:

```bash
npx pie --help
npx pie doctor
```

Initialize PIE once per project if you have not already done so:

```bash
npx pie init
```

### Optional: configure a semantic model

PIE can diagnose traces, apply its negative-control gate, and perform deterministic repair paths locally. More complex semantic repair and generation workflows may require an API key.

Use project-local configuration or environment variables; never paste an API key into a test file or commit it to the repository.

```bash
# Example only — use your own secret management in CI.
export PIE_LLM_API_KEY="[YOUR_KEY]"
export PIE_LLM_MODEL="[YOUR_MODEL]"
```

> **Windows PowerShell**
>
> ```powershell
> $env:PIE_LLM_API_KEY = "[YOUR_KEY]"
> $env:PIE_LLM_MODEL = "[YOUR_MODEL]"
> ```

## Step 1: retain a useful Playwright trace

PIE needs a Playwright `trace.zip`. For local troubleshooting, `retain-on-failure` is usually a good default:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

For a single reproduction, force trace collection:

```bash
npx playwright test tests/login.spec.ts --trace=on
```

After a failure, Playwright writes a trace beneath `test-results/`.

**macOS/Linux:**

```bash
find test-results -name trace.zip
```

**PowerShell:**

```powershell
Get-ChildItem test-results -Recurse -Filter trace.zip | Select-Object -ExpandProperty FullName
```

Copy the path you want to diagnose.

> **[EDITORIAL INSERT — screenshot]**
>
> Add a screenshot of a real Playwright failure showing the trace attachment. Do not use a fabricated timeout, path, or stack trace.

## Step 2: diagnose before attempting repair

Run PIE against one trace:

```bash
npx pie diagnose test-results/<failed-test>/trace.zip
```

PIE inspects trace evidence around the failed action, including available action, network, console, and DOM context. Treat this output as a diagnosis aid, not a substitute for reading the trace.

At this point you are looking for one of three broad outcomes:

| What you see | What it usually means | What to do next |
| --- | --- | --- |
| A stale or missing target with a credible replacement | Likely locator drift | Continue to repair. |
| HTTP 4xx/5xx, disconnect, DNS, or other application/environment signal | The test may not be the defect | Investigate or create a defect report. |
| Missing or ambiguous source mapping | PIE cannot safely locate the edit | Supply explicit context or investigate manually. |

## Step 3: reproduce a small locator-drift case

Use a feature in your own local or staging application where you are allowed to modify the test. Do **not** introduce a mutation into a production branch.

Here is the kind of drift PIE is intended to handle:

```ts
// Original test code — this worked before the UI changed.
await page.locator('#doLogin').click();

// Controlled drift — the old selector no longer exists.
await page.locator('#doLogin_outdated_v2').click();
```

Keep the assertion intact. A repair demonstration is only useful if the test still verifies the original behavior:

```ts
await expect(page.getByRole('link', { name: 'Rooms' })).toBeVisible();
```

Run just that test with tracing:

```bash
npx playwright test tests/login.spec.ts -g "Administrator is able to login" --trace=on --reporter=line
```

The expected controlled failure is specific:

```text
locator.click: Test timeout exceeded
waiting for locator('#doLogin_outdated_v2')
```

If the run fails for a different reason — an unavailable server, expired login, unexpected page, fixture failure, or timeout before the mutated action — stop. The mutation is not eligible for repair scoring until the original baseline passes and the injected change causes the intended failure.

This distinction prevents a testbed problem from being presented as a repair result.

## Step 4: run the repair workflow

### Dry run first

For a project with traces in `test-results/`:

```bash
npx pie repair
```

This is the right first command when you want to inspect the diagnosis and proposed candidate without applying active workspace changes.

### Apply only verified repairs

When you are satisfied with the candidate and want the CLI to promote verified changes:

```bash
npx pie repair --apply --verbose
```

The `--verbose` flag is useful during evaluation because it exposes the repair decision, patch information, and available telemetry.

### Target a particular trace

For a single trace and an isolated verification workflow:

```bash
npx pw-intel repair test-results/<failed-test>/trace.zip --execute
```

If PIE cannot map the trace safely to the source location, it may require explicit test/Page Object context. This is intentional: it is safer to ask for context than edit a file based on a weak match.

## Step 5: read the repair result

Do not reduce the output to “green” or “red.” PIE is making a decision about whether it can safely act.

### Successful repair

An actual successful result includes a decision like:

```json
{
  "status": "REPAIRED_AND_VERIFIED",
  "tier": "tier1_deterministic",
  "targetFilePath": "pages/AdminPage.ts",
  "healedLocator": "page.getByRole('button', { name: 'Login' })",
  "promotedFiles": ["pages/AdminPage.ts"]
}
```

How to interpret it:

- `REPAIRED_AND_VERIFIED` means the candidate completed PIE’s verification path.
- `tier1_deterministic` means a local deterministic repair path was sufficient.
- A semantic tier may include model-token and cost telemetry.
- `targetFilePath` tells you exactly what to review in Git.
- `promotedFiles` should be empty unless you used an apply/promotion flow.

Inspect the source diff immediately:

```bash
git diff -- pages/AdminPage.ts
```

For the controlled stale-selector example, a reviewable diff may look like this:

```diff
- this.loginButton = page.locator('#doLogin_outdated_v2');
+ this.loginButton = page.getByRole('button', { name: 'Login' });
```

Then rerun the exact baseline test yourself:

```bash
npx playwright test tests/login.spec.ts -g "Administrator is able to login" --reporter=line
```

Even after worktree verification, source review and a normal CI run remain good engineering practice.

### Verification failure

You may receive:

```text
status: VERIFICATION_FAILED
```

This does **not** mean that the tool did nothing useful. It means it did not have enough proof to promote the candidate. Inspect the candidate and the isolated test failure, then decide whether the problem is test state, environment, timing, the candidate itself, or an unrelated failure.

Do not report this as a repaired case.

## Step 6: observe an HTTP500 abstention

The safety case is as important as the repair case.

Use a local or disposable environment with an endpoint you have confirmed the test actually calls. The example below is intentionally generic because every application’s authentication route is different:

```ts
test('logs in', async ({ page }) => {
  await page.route('**/api/auth/login', route =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal Server Error' }),
    }),
  );

  await page.goto('/login');
  await page.getByLabel('Username').fill('demo-user');
  await page.getByLabel('Password').fill('demo-password');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
```

Before calling this a valid negative-control test, verify all three conditions:

1. The unmodified test passes.
2. The route pattern matches the real request shown in a trace or network log.
3. The injected 500 produces the expected test failure and a trace.

Then run PIE:

```bash
npx pie repair --apply --verbose
```

The intended outcome is an abstention:

```text
status: ABSTAINED
tier: negative_control
reason: Backend server failure (HTTP 500) observed during the tested action.
promotedFiles: []
```

In a valid HTTP500 exercise, the right result is:

- no locator change;
- no assertion change;
- no promoted source file;
- no semantic-model spend when the negative-control gate can classify the failure locally.

If you want a defect-oriented report for the team that owns the service:

```bash
npx pw-intel report-defect test-results/<failed-test>/trace.zip
```

## Step 7: restore your controlled mutation

Restore the exact original test code after a controlled experiment. Then rerun the original baseline.

```bash
# Review exactly what changed first.
git diff -- tests/login.spec.ts pages/LoginPage.ts

# Restore only the files you intentionally mutated.
git restore -- tests/login.spec.ts pages/LoginPage.ts

# Prove the original case still passes.
npx playwright test tests/login.spec.ts -g "Administrator is able to login" --reporter=line
```

Avoid broad cleanup commands in a shared or dirty repository. Restore only the files you intentionally changed unless you have verified the repository state and explicitly intend to discard all uncommitted work.

## Common outcomes and what to do

| Result | Meaning | Recommended action |
| --- | --- | --- |
| `REPAIRED_AND_VERIFIED` | PIE found and verified a candidate | Review the diff; rerun the targeted test; merge through normal review. |
| `ABSTAINED` | Application/environment evidence took priority | Investigate the service, network, credentials, or environment. |
| `VERIFICATION_FAILED` | Candidate did not prove itself | Review the isolated failure; do not treat as a success. |
| `INPUT_REQUIRED` | Mapping or context is ambiguous | Supply requested source context or investigate manually. |
| No trace found | Playwright did not retain a trace | Run with `--trace=on` or configure `retain-on-failure`. |
| The controlled mutation passes | The mutation did not reach the intended action | Fix the experiment; do not run repair scoring. |

## Where generation fits

PIE also includes evidence-driven QA and test-generation workflows:

```bash
npx pw-intel qa "Checkout Flow" --url http://localhost:3000 --author hybrid --out-dir tests/e2e
```

Generation should be treated as a separate workflow from repair. Review generated Page Objects, fixtures, test data assumptions, and assertions as carefully as application code. A generated test that compiles is not automatically a correct test.

For teams starting with PIE, repair and diagnosis are usually the best first evaluation path because they begin with a real trace and a concrete failure.

## Closing thought

The useful question after a Playwright failure is not always “what selector should replace this one?”

Sometimes the answer is a verified locator repair. Sometimes it is an application bug. Sometimes it is a broken test setup. A repair tool earns trust by distinguishing those outcomes — and by refusing to promote a patch when the evidence is not enough.

> **[EDITORIAL INSERT — links]**
>
> - GitHub: `https://github.com/lst2121/playwright-intelligence-engine`
> - npm: `[INSERT npm package URL]`
> - Medium article: `[INSERT Medium URL]`
> - Issue tracker: `[INSERT issue URL]`

---

## Author publication checklist

- [ ] Replace all `<failed-test>`, route, spec, and Page Object examples with paths from a real clean demo run.
- [ ] Capture actual `doctor`, diagnosis, repair, and abstention output for screenshots.
- [ ] Do not paste secrets, cookies, internal URLs, customer data, or raw production traces.
- [ ] Verify package installation in a fresh sample Playwright repository.
- [ ] Set `published: true` only after every command has been rerun from the final article.
- [ ] Add a canonical URL if this is republished from Medium.
- [ ] Use DEV tags only after verifying their current availability in the editor.
