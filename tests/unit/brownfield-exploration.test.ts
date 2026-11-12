import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  buildBrownfieldRepositoryGraph,
  buildWorkflowPlan,
  InteractiveWorkflowRunner,
} from '../../src/index.js';

const tempDirs: string[] = [];
const activeServers: http.Server[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop()!;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function startInteractiveAppServer(): Promise<string> {
  let storedTasks: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/api/tasks' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.title || !String(parsed.title).trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Title required' }));
            return;
          }
          storedTasks.push(String(parsed.title));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ title: parsed.title, count: storedTasks.length }));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Crash' }));
        }
      });
      return;
    }
    if (url === '/api/broken') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Simulated 500' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html>
<html>
  <head><title>Explorer Test App</title></head>
  <body>
    <h1>Tasks Workspace</h1>
    <form id="task-form">
      <input id="new-task" type="text" placeholder="Add a New Task" />
      <button type="submit">Create</button>
    </form>
    <p id="err" style="color:red"></p>
    <ul id="task-list"></ul>
    <script>
      const KEY = 'explorer_tasks';
      function render() {
        const items = JSON.parse(localStorage.getItem(KEY) || '[]');
        const list = document.getElementById('task-list');
        list.innerHTML = items.map(t => '<li>' + t + '</li>').join('');
      }
      render();
      document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('new-task');
        const val = input.value.trim();
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: val })
        });
        if (!r.ok) {
          document.getElementById('err').textContent = 'Title required';
          return;
        }
        document.getElementById('err').textContent = '';
        const items = JSON.parse(localStorage.getItem(KEY) || '[]');
        items.push(val);
        localStorage.setItem(KEY, JSON.stringify(items));
        input.value = '';
        render();
      });
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  activeServers.push(server);
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}/`;
}

describe('Phase C — Brownfield Repository Graph & Stateful Live Exploration', () => {
  it('extracts brownfield fixtures, dependencies, barrel re-exports, POMs, helpers, auth projects, and monorepo source hints', async () => {
    const root = await makeTempDir('pie-brownfield-');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'storefront-monorepo',
      scripts: { 'test:e2e': 'playwright test' },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        paths: { '@tests/*': ['./tests/*'] },
      },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /auth\\.setup\\.ts/ },
    { name: 'chromium', dependencies: ['setup'], use: { storageState: 'playwright/.auth/user.json' } }
  ]
});
`, 'utf8');

    await fs.mkdir(path.join(root, 'src/app/cart'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/app/cart/page.tsx'), `
import { z } from 'zod';
const QtySchema = z.object({ qty: z.number().min(1).max(10) });
export default function CartPageView() {
  return fetch('/api/cart');
}
`, 'utf8');

    await fs.mkdir(path.join(root, 'tests/fixtures'), { recursive: true });
    await fs.writeFile(path.join(root, 'tests/fixtures/base.ts'), `import { test as base } from '@playwright/test';
export const test = base.extend({
  authenticatedPage: async ({ page }, use) => { await use(page); },
  apiClient: async ({ request }, use) => { await use(request); },
});
export { expect } from '@playwright/test';
`, 'utf8');
    await fs.writeFile(path.join(root, 'tests/fixtures/index.ts'), `export { test, expect } from './base.js';\n`, 'utf8');

    await fs.mkdir(path.join(root, 'tests/pages'), { recursive: true });
    await fs.writeFile(path.join(root, 'tests/pages/CartPage.ts'), `import type { Page } from '@playwright/test';
export class CartPage {
  constructor(readonly page: Page) {}
  async addItem() {}
  async removeItem() {}
}
`, 'utf8');

    await fs.mkdir(path.join(root, 'tests/helpers'), { recursive: true });
    await fs.writeFile(path.join(root, 'tests/helpers/test-data.ts'), `export function seedCartItem() { return { id: 1 }; }\n`, 'utf8');

    const graph = await buildBrownfieldRepositoryGraph(root);
    expect(graph.topology).toBe('monorepo');
    expect(graph.testImport).toBe('tests/fixtures/index.ts');
    expect(graph.fixtureExports.map((f) => f.name)).toEqual(expect.arrayContaining(['authenticatedPage', 'apiClient']));
    expect(graph.fixtureExports.find((f) => f.name === 'authenticatedPage')?.reExportedFrom).toBe('tests/fixtures/index.ts');
    expect(graph.fixtureExports.find((f) => f.name === 'authenticatedPage')?.dependencies).toEqual(['page']);
    expect(graph.pomExports.find((p) => p.className === 'CartPage')?.methods).toEqual(expect.arrayContaining(['addItem', 'removeItem']));
    expect(graph.helperExports.find((h) => h.name === 'seedCartItem')?.category).toBe('test-data-factory');
    expect(graph.storageStatePaths).toContain('playwright/.auth/user.json');
    expect(graph.authProjects.some((p) => p.name === 'chromium' && p.dependencies.includes('setup'))).toBe(true);
    expect(graph.pathAliases['@tests/*']).toEqual(['./tests/*']);
    expect(graph.sourceHints.routes).toContain('/cart');
    expect(graph.sourceHints.apiEndpoints).toContain('/api/cart');
    expect(graph.sourceHints.validationRules).toContain('min(1)');
  });

  it('executes live stateful browser exploration in one session with DOM diffs, network capture, reload checks, and secret redaction', async () => {
    const baseUrl = await startInteractiveAppServer();
    const checkpointDir = await makeTempDir('pie-checkpoint-');
    const checkpointPath = path.join(checkpointDir, 'exploration-evidence.json');

    const plan = buildWorkflowPlan({
      featureName: 'Tasks Workspace',
      baseUrl,
      markdown: `# Tasks Workspace
- Users can create a task
- Empty submissions must be rejected cleanly
- Created tasks persist across page reload
`,
    });

    const bundle = await InteractiveWorkflowRunner.run({
      baseUrl,
      workflowPlan: plan,
      checkpointPath,
      allowMutatingActions: true,
      dbVerifier: async () => ({ status: 'NOT_VERIFIED', summary: 'Read-only DB adapter unavailable' }),
    });

    expect(bundle.runtimeVerified).toBe(true);
    expect(bundle.authentication.secretsExposed).toBe(false);
    expect(bundle.routes.some((r) => r.route === '/')).toBe(true);
    expect(bundle.locators.some((l) => l.placeholder === 'Add a New Task' && l.matchCount === 1)).toBe(true);
    expect(bundle.network.some((n) => n.method === 'POST' && n.url.includes('/api/tasks') && n.status === 201)).toBe(true);
    expect(bundle.actions.some((a) => a.domDiff.some((d) => d.startsWith('+ ')))).toBe(true);

    const persistenceStatus = bundle.scenarioStatuses.find((s) => s.scenarioId.includes('persistence'));
    expect(persistenceStatus?.verificationLayers.CLIENT_RELOAD).toBe('PASS');
    expect(persistenceStatus?.verificationLayers.DB).toBe('NOT_VERIFIED');
    expect(bundle.persistenceObservations[0]?.note).toContain('does not independently prove backend database persistence');

    const resumed = await InteractiveWorkflowRunner.resumeFromCheckpoint(checkpointPath);
    expect(resumed.bundleId).toBe(bundle.bundleId);
  }, 25_000);

  it('preserves completed checkpoint evidence on crash and enforces destructive-action policy', async () => {
    const baseUrl = await startInteractiveAppServer();
    const checkpointDir = await makeTempDir('pie-crash-');
    const checkpointPath = path.join(checkpointDir, 'checkpoint.json');

    const plan = buildWorkflowPlan({
      featureName: 'Account Admin',
      baseUrl,
      markdown: `# Account Admin
- User submits valid task
- User attempts delete account operation
`,
    });

    // 1. Destructive policy blocks destructive scenario without permission while continuing others
    const policyBundle = await InteractiveWorkflowRunner.run({
      baseUrl,
      workflowPlan: plan,
      checkpointPath,
      allowMutatingActions: true,
      allowDestructiveActions: false,
    });
    expect(policyBundle.actions.some((a) => a.status === 'BLOCKED_BY_POLICY')).toBe(true);
    expect(policyBundle.scenarioStatuses.some((s) => s.status === 'BLOCKED')).toBe(true);

    // 2. Crash after scenario 0 retains scenario 0 evidence in checkpoint
    const crashedBundle = await InteractiveWorkflowRunner.run({
      baseUrl,
      workflowPlan: plan,
      checkpointPath,
      allowMutatingActions: true,
      simulateCrashAfterScenarioIndex: 1,
    });
    expect(crashedBundle.scenarioStatuses.length).toBeGreaterThanOrEqual(1);
    expect(crashedBundle.limitations.some((l) => l.includes('Simulated exploration interruption'))).toBe(true);
    const saved = await InteractiveWorkflowRunner.resumeFromCheckpoint(checkpointPath);
    expect(saved.actions.length).toBeGreaterThanOrEqual(1);
  }, 25_000);

  it('runs cleanly in source-only offline mode when no baseUrl is supplied', async () => {
    const plan = buildWorkflowPlan({ featureName: 'Offline Feature', prompt: 'Create item' });
    const bundle = await InteractiveWorkflowRunner.run({
      workflowPlan: plan,
    });
    expect(bundle.topology).toBe('source-only');
    expect(bundle.runtimeVerified).toBe(false);
    expect(bundle.scenarioStatuses.every((s) => s.status === 'NOT_VERIFIED')).toBe(true);
  });

  it('redacts sensitive tokens in bundle and records RUNTIME_ERROR on HTTP 500', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/broken') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Boom' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body>
        <h1>App</h1>
        <form onsubmit="event.preventDefault(); fetch('/api/broken', { method: 'POST', headers: { Authorization: 'Bearer sk-1234567890abcdef' } });">
          <input placeholder="Item" />
          <button type="submit">Go</button>
        </form>
      </body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    activeServers.push(server);
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}/`;

    const plan = buildWorkflowPlan({
      featureName: 'Broken API',
      baseUrl,
      markdown: '# Broken API\n- User creates item and sees UI update\n',
    });

    const bundle = await InteractiveWorkflowRunner.run({
      baseUrl: `${baseUrl}?token=secret-query-token-12345`,
      workflowPlan: plan,
      allowMutatingActions: true,
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('secret-query-token-12345');
    expect(serialized).not.toContain('sk-1234567890abcdef');
    expect(bundle.authentication.secretsExposed).toBe(false);
    expect(bundle.findings.some((f) => f.category === 'RUNTIME_ERROR')).toBe(true);
    expect(bundle.scenarioStatuses.some((s) => s.status === 'DEFECT_DETECTED')).toBe(true);
  }, 20_000);
});
