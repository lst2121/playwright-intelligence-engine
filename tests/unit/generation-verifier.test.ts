import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import {
  assertionsPreserved,
  buildWorkflowPlan,
  exportWorkflowToGherkin,
  runEvidenceDrivenGeneration,
} from '../../src/index.js';
import { runCli } from '../../src/cli/index.js';
import { McpServer } from '../../src/mcp/server.js';

function startControlledTodoServer() {
  let failApi = false;
  const tasks: string[] = ['Initial seeded task'];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/tasks')) {
      if (failApi) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Injected server 500' }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            if (parsed.title) tasks.push(String(parsed.title));
          } catch {
            // ignore malformed
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tasks }));
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>PIE Controlled Tasks</title></head>
<body>
  <main>
    <h1>Controlled Task Tracker</h1>
    <form id="task-form">
      <label for="task-input">New task</label>
      <input id="task-input" placeholder="Enter a new task" />
      <button type="submit">Add Task</button>
    </form>
    <ul id="task-list" role="list"></ul>
    <p id="status-msg"></p>
  </main>
  <script>
    const list = document.getElementById('task-list');
    const input = document.getElementById('task-input');
    const status = document.getElementById('status-msg');
    async function load() {
      const r = await fetch('/api/tasks');
      if (!r.ok) { status.textContent = 'API Error ' + r.status; return; }
      const d = await r.json();
      list.innerHTML = '';
      for (const t of d.tasks) {
        const li = document.createElement('li');
        li.textContent = t;
        list.appendChild(li);
      }
    }
    document.getElementById('task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: val }),
      });
      input.value = '';
      await load();
    });
    load();
  </script>
</body>
</html>`);
  });

  return {
    server,
    setFailApi: (flag: boolean) => {
      failApi = flag;
    },
    resetTasks: () => {
      tasks.splice(0, tasks.length, 'Initial seeded task');
    },
  };
}

async function setupPlaywrightTempWorkspace(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'pie-phase-d-fixture', version: '1.0.0', private: true }, null, 2),
    'utf8',
  );
  await fsp.writeFile(
    path.join(dir, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  use: { headless: true, trace: 'on' },
});
`,
    'utf8',
  );
  const repoNodeModules = path.join(process.cwd(), 'node_modules');
  const linkPath = path.join(dir, 'node_modules');
  if (!fsSync.existsSync(linkPath)) {
    fsSync.symlinkSync(repoNodeModules, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return dir;
}

describe('Phase D — Integrated Verification, Repair Preservation, Falsification & QA Report', () => {
  const ctrl = startControlledTodoServer();
  let baseUrl = '';
  const createdDirs: string[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      ctrl.server.listen(0, '127.0.0.1', () => {
        const addr = ctrl.server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ctrl.server.close(() => resolve()));
    for (const dir of createdDirs) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('enforces assertion preservation invariant strictly', () => {
    const original = `
      await expect(page.getByText('Initial seeded task')).toBeVisible();
      await expect(page.locator('#task-list li')).toHaveCount(2);
    `;
    const validLocatorOnlyFix = `
      await expect(page.getByText('Initial seeded task')).toBeVisible();
      await expect(page.getByRole('listitem')).toHaveCount(2);
    `;
    const weakenedRemoved = `
      await expect(page.locator('body')).toBeVisible();
    `;
    const weakenedConstant = `
      await expect(page.getByText('Initial seeded task')).toBeVisible();
      expect(true).toBe(true);
    `;

    expect(assertionsPreserved(original, validLocatorOnlyFix)).toBe(true);
    expect(assertionsPreserved(original, weakenedRemoved)).toBe(false);
    expect(assertionsPreserved(original, weakenedConstant)).toBe(false);
  });

  it('executes full 4-phase flow with edited Gherkin, trace repair, mutation kills, and QA artifacts', { timeout: 120_000 }, async () => {
    ctrl.setFailApi(false);
    ctrl.resetTasks();
    const workspaceRoot = await setupPlaywrightTempWorkspace('pie-phase-d-e2e-');
    createdDirs.push(workspaceRoot);

    const initialPlan = buildWorkflowPlan({
      featureName: 'Task Creation',
      markdown: `# Task Creation\n- User enters a task title and submits to see the task persisted in the list.\n`,
      baseUrl,
    });
    const baseGherkin = exportWorkflowToGherkin(initialPlan);
    const editedFeatureText = `${baseGherkin}\n  @priority-P1 @added-by-qa\n  Scenario: Reload preserves seeded task\n    Given user opens "${baseUrl}"\n    Then "Initial seeded task" remains visible\n`;

    let repairCalled = 0;
    const result = await runEvidenceDrivenGeneration({
      workspaceRoot,
      featureName: 'Task Creation',
      markdown: `# Task Creation\n- User enters a task title and submits to see the task persisted in the list.\n`,
      baseUrl,
      editedFeatureText,
      author: 'llm',
      fullCodeProvider: {
        generate: async () => ({
          schemaVersion: '1.0',
          status: 'GENERATE',
          summary: 'Intentional wrong locator on first pass to exercise trace diagnosis and bounded repair',
          assumptions: [],
          requiredClarifications: [],
          evidenceReferences: [],
          testMatrix: [],
          files: [
            {
              path: 'tests/task-creation.spec.ts',
              action: 'create',
              rationale: 'Verify task creation end-to-end with UI and API response',
              evidenceReferences: [],
              scenarioIds: [],
              content: `import { test, expect } from '@playwright/test';

test.describe('Task Creation', () => {
  test('adds task via API and verifies list', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'networkidle' });
    await expect(page.getByText('Initial seeded task')).toBeVisible();
    await page.locator('#non-existent-input-id').fill('Verify PIE Phase D', { timeout: 1500 });
    await page.getByRole('button', { name: 'Add Task' }).click();
    await expect(page.getByText('Verify PIE Phase D')).toBeVisible();
  });
});
`,
            },
          ],
        }),
      },
      repairCallback: async ({ specFiles }) => {
        repairCalled += 1;
        return specFiles.map((f) => ({
          ...f,
          content: f.content.replace('#non-existent-input-id', '#task-input'),
        }));
      },
      write: true,
      verify: true,
      runMutations: true,
    });

    expect(repairCalled).toBe(1);
    expect(result.workflowPlan.scenarios.some((s) => s.title === 'Reload preserves seeded task')).toBe(true);
    expect(result.qaReport.intentInvariantPreserved).toBe(true);
    expect(result.qaReport.execution.executed).toBe(true);
    expect(result.qaReport.execution.passed).toBe(true);
    expect(result.qaReport.repairAttempts).toHaveLength(1);
    expect(result.qaReport.repairAttempts[0]?.succeeded).toBe(true);
    expect(result.qaReport.mutationResults.executed).toBe(true);
    expect(result.qaReport.mutationResults.killed).toBeGreaterThanOrEqual(2);
    expect(result.qaReport.mutationResults.entries.some((e) => e.level === 'LEVEL_B_API_FAULT' && e.status === 'KILLED')).toBe(true);
    expect(['VERIFIED', 'VERIFIED_WITH_WARNINGS']).toContain(result.qaReport.status);
    expect(fsSync.existsSync(result.qaReport.artifacts.qaReportJsonPath!)).toBe(true);
    expect(fsSync.existsSync(result.qaReport.artifacts.qaReportMarkdownPath!)).toBe(true);
    const mdText = fs.readFileSync(result.qaReport.artifacts.qaReportMarkdownPath!, 'utf8');
    expect(mdText).toContain('PIE QA Verification Report');
    expect(mdText).toContain('Mutation Falsification');
  });

  it('rejects any repair patch that weakens or removes original business assertions', { timeout: 90_000 }, async () => {
    ctrl.setFailApi(false);
    ctrl.resetTasks();
    const workspaceRoot = await setupPlaywrightTempWorkspace('pie-phase-d-reject-');
    createdDirs.push(workspaceRoot);

    const result = await runEvidenceDrivenGeneration({
      workspaceRoot,
      featureName: 'Assertion Preservation Reject',
      prompt: 'Submit a task and verify it renders',
      baseUrl,
      author: 'llm',
      fullCodeProvider: {
        generate: async () => ({
          schemaVersion: '1.0',
          status: 'GENERATE',
          summary: 'Failing locator test',
          assumptions: [],
          requiredClarifications: [],
          evidenceReferences: [],
          testMatrix: [],
          files: [
            {
              path: 'tests/assertion-reject.spec.ts',
              action: 'create',
              rationale: 'Exercise assertion preservation rejection during repair',
              evidenceReferences: [],
              scenarioIds: [],
              content: `import { test, expect } from '@playwright/test';

test.describe('Assertion Reject', () => {
  test('fails on missing locator', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'networkidle' });
    await page.locator('#missing-selector').click({ timeout: 1000 });
    await expect(page.getByText('Initial seeded task')).toBeVisible();
  });
});
`,
            },
          ],
        }),
      },
      repairCallback: async ({ specFiles }) =>
        specFiles.map((f) => ({
          ...f,
          content: `import { test, expect } from '@playwright/test';

test.describe('Assertion Reject', () => {
  test('cheating repair weakens assertion', async ({ page }) => {
    await page.goto('${baseUrl}');
    await expect(page.locator('body')).toBeVisible();
  });
});
`,
        })),
      write: true,
      verify: true,
      runMutations: false,
    });

    expect(result.qaReport.intentInvariantPreserved).toBe(false);
    expect(result.qaReport.repairAttempts[0]?.action).toBe('rejected-assertion-weakening');
    expect(result.qaReport.repairAttempts[0]?.assertionsPreserved).toBe(false);
    expect(result.qaReport.status).toBe('VERIFICATION_FAILED');
  });

  it('classifies HTTP 500 backend errors as application defects and halts repair', { timeout: 90_000 }, async () => {
    ctrl.setFailApi(true);
    const workspaceRoot = await setupPlaywrightTempWorkspace('pie-phase-d-500-');
    createdDirs.push(workspaceRoot);

    let repairCalled = 0;
    const result = await runEvidenceDrivenGeneration({
      workspaceRoot,
      featureName: 'Backend 500 Detection',
      prompt: 'Load tasks from /api/tasks',
      baseUrl,
      author: 'llm',
      fullCodeProvider: {
        generate: async () => ({
          schemaVersion: '1.0',
          status: 'GENERATE',
          summary: 'Spec expecting API list item while backend fails 500',
          assumptions: [],
          requiredClarifications: [],
          evidenceReferences: [],
          testMatrix: [],
          files: [
            {
              path: 'tests/backend-500.spec.ts',
              action: 'create',
              rationale: 'Verify HTTP 500 failure is attributed to application defect and stops repair',
              evidenceReferences: [],
              scenarioIds: [],
              content: `import { test, expect } from '@playwright/test';

test.describe('Backend 500', () => {
  test('shows seeded task', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'networkidle' });
    await expect(page.getByText('Initial seeded task')).toBeVisible({ timeout: 1500 });
  });
});
`,
            },
          ],
        }),
      },
      repairCallback: async () => {
        repairCalled += 1;
        return undefined;
      },
      write: true,
      verify: true,
      runMutations: false,
    });

    ctrl.setFailApi(false);
    expect(result.qaReport.execution.executed).toBe(true);
    expect(result.qaReport.execution.passed).toBe(false);
    expect(result.qaReport.failureClassifications.some((c) => c.defectOwner === 'application' && c.category === 'BACKEND_500')).toBe(true);
    expect(repairCalled).toBe(0);
  });

  it('exposes run_qa_pipeline via MCP server and pw-intel qa via CLI', async () => {
    ctrl.setFailApi(false);
    ctrl.resetTasks();
    const workspaceRoot = await setupPlaywrightTempWorkspace('pie-phase-d-cli-mcp-');
    createdDirs.push(workspaceRoot);

    const server = new McpServer(workspaceRoot);
    const listResp = await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const toolNames = (listResp.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).toContain('run_qa_pipeline');

    const callResp = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'run_qa_pipeline',
        arguments: {
          featureName: 'MCP Task Check',
          prompt: 'Verify task tracker renders tasks',
          baseUrl,
          workspaceRoot,
          write: true,
          verify: false,
          runMutations: false,
        },
      },
    });
    expect(callResp.error).toBeUndefined();
    expect(callResp.result?.qaReport?.featureName).toBe('MCP Task Check');

    const cliOut = path.join(workspaceRoot, '.pie', 'cli-qa-report.json');
    await runCli([
      'node',
      'pw-intel',
      'qa',
      'CLI Task Check',
      '--workspace',
      workspaceRoot,
      '--url',
      baseUrl,
      '--prompt',
      'Add task flow',
      '--no-verify',
      '--out',
      cliOut,
    ]);
    expect(fsSync.existsSync(cliOut)).toBe(true);
    const parsedOut = JSON.parse(await fsp.readFile(cliOut, 'utf8'));
    expect(parsedOut.featureName).toBe('CLI Task Check');
  });
});
