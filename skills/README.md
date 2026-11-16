# PIE Agent Skill Pack

First-party Agent Skills for AI coding assistants (Antigravity, Cursor, Claude Code, Cline) integrating with Playwright Intelligence Engine (`playwright-intelligence-engine` / `pw-intel`).

## Core Skills

1. **`pie-setup`**: Automated workspace readiness audit, diagnostic healthcheck (`pw-intel doctor`), PIE configuration initialization (`pw-intel init`), and `playwright.config.ts` trace retention verification.
2. **`pie-self-heal`**: Autonomous end-to-end trace diagnosis and repair pipeline. Respects Gate 0 negative controls (abtains on 500s/network errors), executes isolated Git worktree proofs (`--execute`), and applies verified locator repairs (`--apply`).
3. **`pie-stabilize`**: Flaky test auto-stabilizer. Scans specification files for arbitrary delays (`waitForTimeout`) and refactors them into deterministic event-driven awaits with multi-trial validation.

## Customizing Skills for Your Project

Teams can copy any skill into their workspace's `.agents/skills/` or `.cursor/skills/` directory to tailor behavior:
- **Locator Conventions**: Pin locator preferences (e.g. enforce `getByTestId` vs `getByRole`).
- **Safety Gates**: Customize defect reporting templates for company Jira/GitHub schemas.
- **Verification Flags**: Configure custom test runner commands or project filters (e.g. `--project=chromium`).
