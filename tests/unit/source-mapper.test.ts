import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverRepairSourceMapping } from '../../src/repair/source-mapper.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('repair source mapper', () => {
  it('discovers a unique Page Object locator from failed trace evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-source-map-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    await fs.writeFile(path.join(root, 'tests', 'login.spec.ts'), "test('login', async ({ page }) => {});", 'utf8');
    await fs.writeFile(path.join(root, 'pages', 'login.page.ts'), `export class LoginPage {\n  signIn = this.page.getByRole('button', { name: 'Sign in' });\n  constructor(private page: any) {}\n}`, 'utf8');

    const mapping = await discoverRepairSourceMapping({
      workspaceRoot: root,
      failedAction: {
        callId: 'call-1',
        action: 'click',
        selector: "getByRole('button', { name: 'Sign in' })",
        sourceFile: path.join(root, 'tests', 'login.spec.ts'),
      },
    });

    expect(mapping?.className).toBe('LoginPage');
    expect(mapping?.memberName).toBe('signIn');
    expect(mapping?.pomFilePath).toBe(path.join(root, 'pages', 'login.page.ts'));
    expect(mapping?.confidence).toBe(1);
  });

  it('abstains when the same selector is mapped by multiple Page Objects', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-source-map-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'pages', 'a'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages', 'b'), { recursive: true });
    const source = `export class Page {\n  submit = this.page.getByRole('button', { name: 'Submit' });\n  constructor(private page: any) {}\n}`;
    await fs.writeFile(path.join(root, 'pages', 'a', 'a.page.ts'), source, 'utf8');
    await fs.writeFile(path.join(root, 'pages', 'b', 'b.page.ts'), source, 'utf8');

    const mapping = await discoverRepairSourceMapping({
      workspaceRoot: root,
      failedAction: { callId: 'call-2', action: 'click', selector: "getByRole('button', { name: 'Submit' })" },
    });
    expect(mapping).toBeUndefined();
  });

  it('remaps a disposable trace source path to a unique active-repository test file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-source-map-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    const testPath = path.join(root, 'tests', 'checkout.spec.ts');
    const pomPath = path.join(root, 'pages', 'checkout.page.ts');
    await fs.writeFile(testPath, "test('checkout', async ({ page }) => {});", 'utf8');
    await fs.writeFile(pomPath, `export class CheckoutPage {
  submit = this.page.getByRole('button', { name: 'Submit' });
  constructor(private page: any) {}
}`, 'utf8');

    const mapping = await discoverRepairSourceMapping({
      workspaceRoot: root,
      failedAction: {
        callId: 'call-3',
        action: 'click',
        selector: "getByRole('button', { name: 'Submit' })",
        sourceFile: 'D:/temporary-disposable-checkout/tests/checkout.spec.ts',
      },
    });

    expect(mapping?.testFilePath).toBe(testPath);
    expect(mapping?.evidence).toContain('Trace source path remapped to the unique active-repository source file');
  });
});
