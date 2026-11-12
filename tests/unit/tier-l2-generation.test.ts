import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CandidateWriter,
  LlmAuthor,
  runGenerationAgent,
  validateFullGenerationProposal,
  type FullCodeGenerationProvider,
} from '../../src/index.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeWorkspaceTempDir(prefix: string): Promise<string> {
  const base = path.resolve('tests/fixtures');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('Phase A — Tier-L2 Full-Code Authoring & Transactional CandidateWriter', () => {
  const samplePom = `import type { Page, Locator } from '@playwright/test';

export class TasksBoardPage {
  readonly newTaskInput: Locator;
  readonly createButton: Locator;
  readonly taskRows: Locator;

  constructor(public readonly page: Page) {
    this.newTaskInput = page.getByPlaceholder('Add a New Task');
    this.createButton = page.getByRole('button', { name: 'Create' });
    this.taskRows = page.locator('[data-testid="task-row"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async addTask(title: string): Promise<void> {
    await this.newTaskInput.fill(title);
    await this.createButton.click();
  }
}
`;

  const sampleFixture = `import { test as base } from '@playwright/test';
import { TasksBoardPage } from '../pages/TasksBoardPage.js';

type AppFixtures = {
  tasksBoardPage: TasksBoardPage;
};

export const test = base.extend<AppFixtures>({
  tasksBoardPage: async ({ page }, use) => {
    const tasksBoardPage = new TasksBoardPage(page);
    await tasksBoardPage.goto();
    await use(tasksBoardPage);
  },
});

export { expect } from '@playwright/test';
`;

  const sampleSpec = `import { test, expect } from '../fixtures/app.fixtures.js';

test.describe('Task lifecycle', () => {
  test('creates a task and persists across reload', async ({ tasksBoardPage, page }) => {
    await tasksBoardPage.addTask('Verify Tier-L2');
    await expect(tasksBoardPage.taskRows.filter({ hasText: 'Verify Tier-L2' })).toBeVisible();
    await expect(tasksBoardPage.newTaskInput).toHaveValue('');
    await page.reload();
    await expect(tasksBoardPage.taskRows.filter({ hasText: 'Verify Tier-L2' })).toBeVisible();
  });
});
`;

  it('preserves multi-file LLM output verbatim, compiles with tsc, and discovers tests with Playwright', async () => {
    const workspace = await makeWorkspaceTempDir('tmp-tierl2-');
    await fs.writeFile(path.join(workspace, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/specs' });
`, 'utf8');
    await fs.writeFile(path.join(workspace, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['playwright.config.ts', 'tests/**/*.ts'],
    }, null, 2), 'utf8');

    const provider: FullCodeGenerationProvider = {
      async generate() {
        return JSON.stringify({
          schemaVersion: '1.0',
          status: 'GENERATE',
          summary: 'Generated multi-file behavioral Playwright suite.',
          files: [
            {
              path: 'tests/pages/TasksBoardPage.ts',
              action: 'create',
              content: samplePom,
              rationale: 'Page Object Model wrapping grounded task locators.',
              evidenceReferences: ['ev:dom:input', 'ev:dom:button'],
              scenarioIds: ['sc-create-task'],
            },
            {
              path: 'tests/fixtures/app.fixtures.ts',
              action: 'create',
              content: sampleFixture,
              rationale: 'Reusable custom fixture injecting TasksBoardPage.',
              evidenceReferences: ['ev:dom:input'],
              scenarioIds: ['sc-create-task'],
            },
            {
              path: 'tests/specs/tasks-board.spec.ts',
              action: 'create',
              content: sampleSpec,
              rationale: 'Behavioral tests checking creation, input clear, and reload persistence.',
              evidenceReferences: ['ev:transition:task-created'],
              scenarioIds: ['sc-create-task'],
            },
          ],
          testMatrix: [
            {
              scenarioId: 'sc-create-task',
              title: 'creates a task and persists across reload',
              category: 'happy-path',
              testFile: 'tests/specs/tasks-board.spec.ts',
              coveredAssertions: ['task visible', 'input cleared', 'persists after reload'],
              evidenceReferences: ['ev:transition:task-created'],
            },
          ],
          assumptions: [],
          requiredClarifications: [],
          evidenceReferences: ['ev:dom:input', 'ev:dom:button', 'ev:transition:task-created'],
        });
      },
    };

    const result = await runGenerationAgent({
      workspaceRoot: workspace,
      mode: 'greenfield',
      author: 'llm',
      write: true,
      fullCodeProvider: provider,
      allowedEvidenceIds: ['ev:dom:input', 'ev:dom:button', 'ev:transition:task-created'],
      requirements: [{ id: 'req-tasks', title: 'Task Management', description: 'Create and persist tasks.' }],
    });

    expect(result.status).toBe('WRITTEN');
    expect(result.authorKind).toBe('llm');
    expect(result.scenarios).toHaveLength(1);

    const archFiles = result.scenarios[0]!.architecture.files;
    expect(archFiles.map((f) => f.relativePath)).toEqual([
      'tests/pages/TasksBoardPage.ts',
      'tests/fixtures/app.fixtures.ts',
      'tests/specs/tasks-board.spec.ts',
    ]);

    // Verify exact LLM file content survived orchestration without being overwritten by planArchitecture()
    const writtenSpec = await fs.readFile(path.join(workspace, 'tests/specs/tasks-board.spec.ts'), 'utf8');
    expect(writtenSpec).toBe(sampleSpec);
    expect(writtenSpec).toContain('await page.reload();');

    // Phase A Acceptance Gate: real TypeScript compilation + Playwright test discovery
    const tscBin = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const pwBin = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');

    const { stderr: tscStderr } = await execFileAsync(tscBin, ['-p', path.join(workspace, 'tsconfig.json'), '--noEmit'], {
      cwd: workspace,
      shell: process.platform === 'win32',
    });
    expect(tscStderr).toBe('');

    const { stdout: listStdout } = await execFileAsync(pwBin, ['test', '--list'], {
      cwd: workspace,
      shell: process.platform === 'win32',
    });
    expect(listStdout).toContain('creates a task and persists across reload');
  }, 20_000);

  it('falls back to HybridAuthor when no Tier-L2 provider is configured or provider fails', async () => {
    const authorNoProvider = new LlmAuthor();
    const res1 = await authorNoProvider.propose({
      featureName: 'Login',
      mode: 'greenfield',
      steps: [
        { action: 'fill', role: 'textbox', name: 'Email', value: 'a@b.com' },
        { action: 'click', role: 'button', name: 'Sign In' },
        { action: 'assert-visible', role: 'heading', name: 'Dashboard' },
      ],
    });
    expect(res1.authorKind).toBe('llm');
    expect(res1.usedFallback).toBe(true);
    expect(res1.fullCodeAuthoring).toBe(false);
    expect(res1.files.length).toBeGreaterThan(0);

    const failingAuthor = new LlmAuthor({
      provider: {
        async generate() {
          throw new Error('upstream 503');
        },
      },
    });
    const res2 = await failingAuthor.propose({
      featureName: 'Login',
      mode: 'greenfield',
      steps: [
        { action: 'fill', role: 'textbox', name: 'Email', value: 'a@b.com' },
        { action: 'click', role: 'button', name: 'Sign In' },
        { action: 'assert-visible', role: 'heading', name: 'Dashboard' },
      ],
    });
    expect(res2.usedFallback).toBe(true);
    expect(res2.validationErrors?.[0]).toContain('upstream 503');
  });

  it('rejects invalid JSON, constant assertions, waitForTimeout, test.skip, and unknown evidence refs', () => {
    expect(validateFullGenerationProposal('not json').isValid).toBe(false);

    const badPatterns = validateFullGenerationProposal({
      schemaVersion: '1.0',
      status: 'GENERATE',
      summary: 'Bad tests',
      files: [
        {
          path: 'tests/bad.spec.ts',
          action: 'create',
          content: `import { test, expect } from '@playwright/test';
test('bad', async ({ page }) => {
  await page.waitForTimeout(1000);
  expect(true).toBe(true);
});`,
          rationale: 'invalid',
          evidenceReferences: ['ev:fake'],
          scenarioIds: ['sc-1'],
        },
      ],
    }, { allowedEvidenceIds: new Set(['ev:real']) });

    expect(badPatterns.isValid).toBe(false);
    expect(badPatterns.errors.some((e) => e.includes('CONSTANT_ASSERTION'))).toBe(true);
    expect(badPatterns.errors.some((e) => e.includes('ARBITRARY_SLEEP'))).toBe(true);
    expect(badPatterns.errors.some((e) => e.includes('UNKNOWN_EVIDENCE_REFERENCE'))).toBe(true);

    const skippedSpec = validateFullGenerationProposal({
      schemaVersion: '1.0',
      status: 'GENERATE',
      summary: 'Skipped spec',
      files: [
        {
          path: 'tests/skip.spec.ts',
          action: 'create',
          content: `import { test, expect } from '@playwright/test';
test.skip('todo', async () => { expect(1).toBe(2); });`,
          rationale: 'skip',
        },
      ],
    });
    expect(skippedSpec.isValid).toBe(false);
    expect(skippedSpec.errors.some((e) => e.includes('PLACEHOLDER_TEST'))).toBe(true);
  });

  it('enforces CandidateWriter path safety, protected paths, CREATE/MODIFY semantics, and rollback', async () => {
    const workspace = await makeTempDir('pie-writer-');
    await fs.writeFile(path.join(workspace, 'package.json'), '{"name":"app"}\n', 'utf8');
    await fs.mkdir(path.join(workspace, 'tests'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'tests/existing.spec.ts'), 'original content\n', 'utf8');

    // Traversal rejected
    const traversal = await CandidateWriter.apply(workspace, {
      files: [{ relativePath: '../escape.ts', content: 'x', action: 'CREATE' }],
    });
    expect(traversal.success).toBe(false);
    expect(traversal.errors[0]).toContain('Unsafe candidate path');

    // Protected path rejected
    const protectedRes = await CandidateWriter.apply(workspace, {
      files: [{ relativePath: 'package.json', content: '{}', action: 'MODIFY' }],
    });
    expect(protectedRes.success).toBe(false);
    expect(protectedRes.errors[0]).toContain('Protected path');

    // MODIFY non-existent rejected
    const missingModify = await CandidateWriter.apply(workspace, {
      files: [{ relativePath: 'tests/missing.spec.ts', content: 'x', action: 'MODIFY' }],
    });
    expect(missingModify.success).toBe(false);
    expect(missingModify.errors[0]).toContain('non-existent');

    // Valid CREATE + MODIFY + Rollback
    const applied = await CandidateWriter.apply(workspace, {
      files: [
        { relativePath: 'tests/existing.spec.ts', content: 'updated content\n', action: 'MODIFY' },
        { relativePath: 'tests/new.spec.ts', content: 'new file\n', action: 'CREATE' },
      ],
    });
    expect(applied.success).toBe(true);
    expect(applied.modified).toEqual(['tests/existing.spec.ts']);
    expect(applied.written).toEqual(['tests/new.spec.ts']);
    expect(await fs.readFile(path.join(workspace, 'tests/existing.spec.ts'), 'utf8')).toBe('updated content\n');

    await CandidateWriter.rollback(workspace, applied.snapshots);
    expect(await fs.readFile(path.join(workspace, 'tests/existing.spec.ts'), 'utf8')).toBe('original content\n');
    await expect(fs.access(path.join(workspace, 'tests/new.spec.ts'))).rejects.toThrow();
  });

  it('preserves NEEDS_INPUT when LlmAuthor requests clarification instead of inventing tests', async () => {
    const result = await runGenerationAgent({
      mode: 'greenfield',
      author: 'llm',
      fullCodeProvider: {
        async generate() {
          return {
            schemaVersion: '1.0',
            status: 'NEEDS_INPUT',
            summary: 'Need test user credentials and coupon rules.',
            files: [],
            requiredClarifications: ['What test account credentials should be used?', 'What are valid coupon codes?'],
          };
        },
      },
      requirements: [{ id: 'req-1', title: 'Coupon Checkout' }],
    });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.errors).toContain('What test account credentials should be used?');
  });
});
