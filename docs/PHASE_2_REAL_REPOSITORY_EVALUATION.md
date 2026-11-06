# Phase 2 Evidence — Real Repository Evaluation Boundary

## Implemented in PIE

- Added repository inspection APIs in `src/evaluation/repository-inspector.ts`.
- Added nested-package discovery for monorepos such as Hi.Events.
- Added package-manager, Playwright-version, config, test, Page Object, fixture,
  Docker, and local-server metadata extraction.
- Added CLI command:

```bash
node bin/pw-intel.js inspect-testbed D:\\Work\\pie-real-repository-testbed --json --out D:\\Work\\pie-real-repository-testbed\\manifests\\pie-inspection-manifest.json
```

- Added a bounded repository runner with package-manager allowlisting, restricted
  platform-shim handling, timeout enforcement, output limits, and
  PASS/FAIL/TIMEOUT/BLOCKED result states.
- Added CLI command:

```bash
node bin/pw-intel.js run-testbed D:\\Work\\pie-real-repository-testbed --repository playwright-examples --timeout 5000 --out D:\\Work\\pie-real-repository-testbed\\results\\playwright-examples-baseline.json
```

- Fixed Windows timeout cleanup so a timed-out repository run returns a result
  and terminates its spawned Playwright process tree.

## Current external evidence

The inspector ran successfully against:

`D:\\Work\\pie-real-repository-testbed`

Current manifest:

`D:\\Work\\pie-real-repository-testbed\\manifests\\pie-inspection-manifest.json`

The manifest currently discovers five repositories:

- ERPNext Playwright framework — 10 test files;
- Hi.Events nested E2E project — 203 test files;
- Next.js Playwright testing — 2 test files;
- Restful Booker Playwright framework — 5 test files;
- Microsoft Playwright examples — 4 test files.

## Execution evidence

The first bounded baseline attempt against `playwright-examples` produced:

`D:\\Work\\pie-real-repository-testbed\\results\\playwright-examples-baseline.json`

- status: `TIMEOUT`;
- duration: approximately 5.2 seconds;
- Playwright discovered 45 tests and emitted partial progress before the
  configured timeout;
- no repository-runner or Playwright child processes remained afterward.

This proves the runner's bounded execution and cleanup behavior. It does not
prove that the external repository suite passes.

## Not yet proven

- Mutation execution results are not present.
- Full baseline execution results for all five repositories are not present;
  the one exercised suite timed out under the bounded smoke run.
- One requested repository, `agentic-playwright-framework`, is not currently
  present in the cloned repository directory.
- License metadata is still unknown for some repositories.

Therefore this phase is **discovery-verified but execution-incomplete**. The
manifest is evidence of repository structure, not evidence that all suites pass
or that PIE has repaired them.

