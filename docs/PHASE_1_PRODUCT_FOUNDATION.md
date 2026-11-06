# Phase 1 Evidence — Product Foundation and Repository Profile

## Implemented

- Added project-local PIE initialization through `pw-intel init`.
- Added versioned `.pie/config.json` with fail-closed diagnostic defaults.
- Added package-manager and test-command detection for npm, pnpm, and yarn projects.
- Added repository convention profiling through `pw-intel profile`.
- Added persisted `.pie/repository-profile.json` output.
- Added structural, locator, fixture, authentication, API-helper, tag, assertion,
  and domain-term observations for future intelligence features.

## Verification

- Typecheck passed.
- Focused configuration and profile tests passed: 3 tests.
- Full regression suite passed: 401 tests across 28 test files.
- Production build passed.

## CLI examples

```text
pw-intel init .
pw-intel init . --json
pw-intel profile .
pw-intel profile . --json
pw-intel profile . --out .pie/repository-profile.json
```

## Product impact

PIE now has a project-local contract that future repository memory, adaptive
ranking, CI integrations, agent skills, and greenfield/brownfield generation can
consume. The profile is intentionally observational; it does not mutate source
files or claim business intent that has not been evidenced.

## Deferred work

- Connect profile observations to selector scoring and repair ranking.
- Add repository-profile diffs across commits.
- Add confidence and human correction for inferred conventions.
- Add business requirement and application-source intelligence.
