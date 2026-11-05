import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AstPatcher } from '../../src/repair/ast-patcher.js';
import { DiffAllowlistValidator } from '../../src/repair/diff-allowlist.js';
import { IntentValidator } from '../../src/repair/intent-validator.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import {
  AbstentionError,
  UnauthorizedAstModificationError,
  AssertionTamperedError,
  IntentInvariantViolationError,
} from '../../src/core/errors/engine-errors.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('AST Patching and Intent Invariant v2 Suite (45 Tests)', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-ast-invariants');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- Category 1: Surgical AST Patching Patterns (20 tests) ---
  it('AST-P1-01: should patch standard readonly property initializer', async () => {
    const filePath = path.resolve(tmpDir, 'PomP1.ts');
    await fs.writeFile(
      filePath,
      `export class PomP1 {
  readonly submitBtn = this.page.locator('#old');
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomP1',
      memberName: 'submitBtn',
      replacementExpression: "this.page.getByRole('button', { name: 'Submit' })",
    });

    expect(result.pattern).toBe('property-initializer');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("this.page.getByRole('button', { name: 'Submit' })");
  });

  it('AST-P1-02: should patch static property initializer', async () => {
    const filePath = path.resolve(tmpDir, 'PomStatic.ts');
    await fs.writeFile(
      filePath,
      `export class PomStatic {
  static submit = page.locator('#old');
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomStatic',
      memberName: 'submit',
      replacementExpression: "page.getByRole('button', { name: 'New' })",
    });

    expect(result.pattern).toBe('property-initializer');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("page.getByRole('button', { name: 'New' })");
  });

  it('AST-P1-03: should patch private property initializer', async () => {
    const filePath = path.resolve(tmpDir, 'PomPrivate.ts');
    await fs.writeFile(
      filePath,
      `export class PomPrivate {
  private readonly searchInput = this.page.locator('#search');
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomPrivate',
      memberName: 'searchInput',
      replacementExpression: "this.page.getByRole('textbox', { name: 'Search' })",
    });

    expect(result.pattern).toBe('property-initializer');
  });

  it('AST-P2-01: should patch getter return statement', async () => {
    const filePath = path.resolve(tmpDir, 'PomGetter.ts');
    await fs.writeFile(
      filePath,
      `export class PomGetter {
  get loginButton(): Locator {
    return this.page.locator('#old-login');
  }
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomGetter',
      memberName: 'loginButton',
      replacementExpression: "this.page.getByRole('button', { name: 'Log In' })",
    });

    expect(result.pattern).toBe('getter-return');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("this.page.getByRole('button', { name: 'Log In' })");
  });

  it('AST-P3-01: should patch constructor assignment', async () => {
    const filePath = path.resolve(tmpDir, 'PomCtor.ts');
    await fs.writeFile(
      filePath,
      `export class PomCtor {
  readonly submit: Locator;
  constructor(page: Page) {
    this.submit = page.locator('#old-submit');
  }
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomCtor',
      memberName: 'submit',
      replacementExpression: "page.getByRole('button', { name: 'Confirm' })",
    });

    expect(result.pattern).toBe('constructor-assignment');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("page.getByRole('button', { name: 'Confirm' })");
  });

  it('AST-P4-01: should patch parameterless factory method', async () => {
    const filePath = path.resolve(tmpDir, 'PomFactory.ts');
    await fs.writeFile(
      filePath,
      `export class PomFactory {
  submitButton(): Locator {
    return this.page.locator('#factory-old');
  }
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomFactory',
      memberName: 'submitButton',
      replacementExpression: "this.page.getByRole('button', { name: 'Factory Submit' })",
    });

    expect(result.pattern).toBe('parameterless-factory');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("Factory Submit");
  });

  it('AST-P5-01: should patch top-level locator constant', async () => {
    const filePath = path.resolve(tmpDir, 'Constants.ts');
    await fs.writeFile(
      filePath,
      `export const SUBMIT_BTN = '[data-test=old-submit]';`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'Constants', // Non-existent class, falls back to top-level variable
      memberName: 'SUBMIT_BTN',
      replacementExpression: "'[data-test=new-submit]'",
    });

    expect(result.pattern).toBe('locator-constant');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('[data-test=new-submit]');
  });

  it('AST-ABSTAIN-01: should strictly abstain on parameterized dynamic method (row(id: string))', async () => {
    const filePath = path.resolve(tmpDir, 'PomDynamic.ts');
    await fs.writeFile(
      filePath,
      `export class PomDynamic {
  rowDelete(id: string): Locator {
    return this.page.locator('#row-' + id).getByRole('button', { name: 'Delete' });
  }
}`
    );

    const patcher = new AstPatcher();
    await expect(async () => {
      patcher.patchPageObject({
        filePath,
        className: 'PomDynamic',
        memberName: 'rowDelete',
        replacementExpression: "this.page.getByRole('button', { name: 'Delete' })",
      });
    }).rejects.toThrow(AbstentionError);
  });

  it('AST-ABSTAIN-02: should record AST_PARAMETERIZED_LOCATOR in abstention error', async () => {
    const filePath = path.resolve(tmpDir, 'PomParam.ts');
    await fs.writeFile(
      filePath,
      `export class PomParam {
  item(index: number) { return this.page.locator('.item').nth(index); }
}`
    );

    const patcher = new AstPatcher();
    try {
      patcher.patchPageObject({
        filePath,
        className: 'PomParam',
        memberName: 'item',
        replacementExpression: "this.page.locator('.item')",
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.failureCategory).toBe('AST_PARAMETERIZED_LOCATOR');
    }
  });

  it('AST-ABSTAIN-03: should abstain on getter with complex multiple returns', async () => {
    const filePath = path.resolve(tmpDir, 'PomComplexGetter.ts');
    await fs.writeFile(
      filePath,
      `export class PomComplexGetter {
  get dynamicBtn(): Locator {
    if (this.isMobile) return this.page.locator('#m-btn');
    return this.page.locator('#d-btn');
  }
}`
    );

    const patcher = new AstPatcher();
    await expect(async () => {
      patcher.patchPageObject({
        filePath,
        className: 'PomComplexGetter',
        memberName: 'dynamicBtn',
        replacementExpression: "this.page.locator('#new')",
      });
    }).rejects.toThrow(AbstentionError);
  });

  it('AST-ABSTAIN-04: should throw AST_CLASS_NOT_FOUND when class does not exist in file', async () => {
    const filePath = path.resolve(tmpDir, 'PomEmpty.ts');
    await fs.writeFile(filePath, `export class RealClass {}`);

    const patcher = new AstPatcher();
    await expect(async () => {
      patcher.patchPageObject({
        filePath,
        className: 'NonExistentClass',
        memberName: 'btn',
        replacementExpression: "this.page.locator('#btn')",
      });
    }).rejects.toThrow(/AST_CLASS_NOT_FOUND/);
  });

  it('AST-ABSTAIN-05: should throw AST_UNSUPPORTED_PATTERN when member does not exist in class', async () => {
    const filePath = path.resolve(tmpDir, 'PomMissingMember.ts');
    await fs.writeFile(filePath, `export class PomMissingMember { readonly existing = this.page.locator('#ok'); }`);

    const patcher = new AstPatcher();
    await expect(async () => {
      patcher.patchPageObject({
        filePath,
        className: 'PomMissingMember',
        memberName: 'ghostMember',
        replacementExpression: "this.page.locator('#btn')",
      });
    }).rejects.toThrow(/AST_UNSUPPORTED_PATTERN/);
  });

  it('AST-PRESERVE-01: should preserve comments above property initializers', async () => {
    const filePath = path.resolve(tmpDir, 'PomComments.ts');
    await fs.writeFile(
      filePath,
      `export class PomComments {
  /** Critical checkout action button */
  readonly checkoutBtn = this.page.locator('#old');
}`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomComments',
      memberName: 'checkoutBtn',
      replacementExpression: "this.page.getByRole('button', { name: 'Checkout' })",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('/** Critical checkout action button */');
  });

  it('AST-PRESERVE-02: should preserve existing TypeScript types on properties', async () => {
    const filePath = path.resolve(tmpDir, 'PomTypes.ts');
    await fs.writeFile(
      filePath,
      `import { Locator } from '@playwright/test';
export class PomTypes {
  readonly submit: Locator = this.page.locator('#old');
}`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomTypes',
      memberName: 'submit',
      replacementExpression: "this.page.getByRole('button', { name: 'Submit' })",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('readonly submit: Locator =');
  });

  it('AST-PRESERVE-03: should preserve unrelated methods in Page Object', async () => {
    const filePath = path.resolve(tmpDir, 'PomMethods.ts');
    await fs.writeFile(
      filePath,
      `export class PomMethods {
  readonly btn = this.page.locator('#old');
  async submitWorkflow() {
    await this.btn.click();
    return true;
  }
}`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomMethods',
      memberName: 'btn',
      replacementExpression: "this.page.getByRole('button', { name: 'New' })",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('async submitWorkflow() {');
  });

  it('AST-PRESERVE-04: should support multiple classes in single file correctly targeting specified class', async () => {
    const filePath = path.resolve(tmpDir, 'PomMulti.ts');
    await fs.writeFile(
      filePath,
      `export class ClassA { readonly btn = this.page.locator('#a'); }
export class ClassB { readonly btn = this.page.locator('#b'); }`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'ClassB',
      memberName: 'btn',
      replacementExpression: "this.page.locator('#patched-b')",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("ClassA { readonly btn = this.page.locator('#a'); }");
    expect(content).toContain("ClassB { readonly btn = this.page.locator('#patched-b'); }");
  });

  it('AST-P3-02: constructor assignment with multiple assignments should patch target assignment only', async () => {
    const filePath = path.resolve(tmpDir, 'PomMultiAssign.ts');
    await fs.writeFile(
      filePath,
      `export class PomMultiAssign {
  readonly a: Locator;
  readonly b: Locator;
  constructor(page: Page) {
    this.a = page.locator('#a');
    this.b = page.locator('#b');
  }
}`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomMultiAssign',
      memberName: 'b',
      replacementExpression: "page.getByRole('button', { name: 'B' })",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain("this.a = page.locator('#a');");
    expect(content).toContain("this.b = page.getByRole('button', { name: 'B' });");
  });

  it('AST-P1-04: should patch protected property initializer', async () => {
    const filePath = path.resolve(tmpDir, 'PomProtected.ts');
    await fs.writeFile(
      filePath,
      `export class PomProtected {
  protected readonly navBar = this.page.locator('#nav');
}`
    );

    const patcher = new AstPatcher();
    const result = patcher.patchPageObject({
      filePath,
      className: 'PomProtected',
      memberName: 'navBar',
      replacementExpression: "this.page.getByRole('navigation')",
    });

    expect(result.pattern).toBe('property-initializer');
  });

  it('AST-PRESERVE-05: should preserve formatting and indentations in file', async () => {
    const filePath = path.resolve(tmpDir, 'PomIndent.ts');
    const original = `export class PomIndent {
    readonly submit = this.page.locator('#old');
}`;
    await fs.writeFile(filePath, original);

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomIndent',
      memberName: 'submit',
      replacementExpression: "this.page.getByRole('button')",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('    readonly submit = this.page.getByRole(\'button\');');
  });

  it('AST-P2-02: getter return expression should replace expression without altering method signature', async () => {
    const filePath = path.resolve(tmpDir, 'PomSig.ts');
    await fs.writeFile(
      filePath,
      `export class PomSig {
  public get search(): Locator {
    return this.page.locator('#search');
  }
}`
    );

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath,
      className: 'PomSig',
      memberName: 'search',
      replacementExpression: "this.page.getByRole('searchbox')",
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('public get search(): Locator {');
    expect(content).toContain("return this.page.getByRole('searchbox');");
  });

  // --- Category 2: Diff Allowlist Security & Authorization (10 tests) ---
  it('DIFF-ALLOW-01: should allow valid locator modification when only target member is altered', () => {
    const orig = `export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `export class PageObj { readonly btn = this.page.getByRole('button', { name: 'Submit' }); }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(true);
  });

  it('DIFF-ALLOW-02: should reject import modifications', () => {
    const orig = `import { Page } from '@playwright/test';
export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `import { Page } from '@playwright/test';
import malicious from 'malicious-pkg';
export class PageObj { readonly btn = this.page.locator('#old'); }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Import declarations were modified');
  });

  it('DIFF-ALLOW-03: should reject unauthorized property change in same class', () => {
    const orig = `export class PageObj {
  readonly btn = this.page.locator('#old');
  readonly other = this.page.locator('#other');
}`;
    const patched = `export class PageObj {
  readonly btn = this.page.locator('#old');
  readonly other = this.page.locator('#tampered');
}`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain("Unauthorized change to property 'other'");
  });

  it('DIFF-ALLOW-04: should reject unauthorized method change in class', () => {
    const orig = `export class PageObj {
  readonly btn = this.page.locator('#old');
  async doWork() { return 1; }
}`;
    const patched = `export class PageObj {
  readonly btn = this.page.locator('#old');
  async doWork() { return 999; }
}`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain("Unauthorized change to method 'doWork'");
  });

  it('DIFF-ALLOW-05: should reject injection of expect() assertion into locator definition', () => {
    const orig = `export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `export class PageObj { readonly btn = expect(this.page).toBeDefined(); }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Replacement expression contains disallowed statements');
  });

  it('DIFF-ALLOW-06: should reject injection of process.exit into replacement', () => {
    const orig = `export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `export class PageObj { readonly btn = process.exit(0); }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
  });

  it('DIFF-ALLOW-07: should reject class addition or deletion', () => {
    const orig = `export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `export class PageObj { readonly btn = this.page.locator('#old'); }
export class InjectedClass {}`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'PageObj',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Class structure or declarations were altered');
  });

  it('DIFF-ALLOW-08: should throw UnauthorizedAstModificationError on assertAllowed failure', () => {
    const orig = `export class PageObj { readonly btn = this.page.locator('#old'); }`;
    const patched = `import sneaky from 'sneaky';
export class PageObj { readonly btn = this.page.locator('#old'); }`;

    expect(() => {
      DiffAllowlistValidator.assertAllowed({
        originalSource: orig,
        patchedSource: patched,
        targetClassName: 'PageObj',
        targetMemberName: 'btn',
      });
    }).toThrow(UnauthorizedAstModificationError);
  });

  it('DIFF-ALLOW-09: constructor assignment diff allowlist check', () => {
    const orig = `export class Pom {
  readonly btn: Locator;
  constructor(page: Page) { this.btn = page.locator('#old'); }
}`;
    const patched = `export class Pom {
  readonly btn: Locator;
  constructor(page: Page) { this.btn = page.getByRole('button'); }
}`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'Pom',
      targetMemberName: 'btn',
    });
    expect(res.isAllowed).toBe(true);
  });

  it('DIFF-ALLOW-10: getter diff allowlist check', () => {
    const orig = `export class Pom { get btn(): Locator { return this.page.locator('#old'); } }`;
    const patched = `export class Pom { get btn(): Locator { return this.page.getByRole('button'); } }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'Pom',
      targetMemberName: 'btn',
    });
    expect(res.isAllowed).toBe(true);
  });

  // --- Category 3: Intent Invariant v2 Contract (V = A ∧ T ∧ F ∧ I ∧ D ∧ E) (15 tests) ---
  it('INTENT-01: should compute canonical SHA-256 assertion fingerprint', async () => {
    const specPath = path.resolve(tmpDir, 'spec1.ts');
    await fs.writeFile(
      specPath,
      `import { test, expect } from '@playwright/test';
test('sample', async ({ page }) => {
  await expect(page.locator('#title')).toHaveText('Welcome');
});`
    );

    const hash1 = AssertionHasher.computeAssertionFingerprint(specPath);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBe(64); // SHA-256 hex length
  });

  it('INTENT-02: assertion fingerprint should be formatting and whitespace insensitive', async () => {
    const spec1 = path.resolve(tmpDir, 'spec-fmt1.ts');
    const spec2 = path.resolve(tmpDir, 'spec-fmt2.ts');

    await fs.writeFile(
      spec1,
      `test('a', async ({ page }) => { await expect(page.locator('#btn')).toBeVisible(); });`
    );
    await fs.writeFile(
      spec2,
      `test('a', async ({ page }) => {
  await expect(
    page.locator('#btn')
  ).toBeVisible();
});`
    );

    const hash1 = AssertionHasher.computeAssertionFingerprint(spec1);
    const hash2 = AssertionHasher.computeAssertionFingerprint(spec2);
    expect(hash1).toBe(hash2);
  });

  it('INTENT-03: assertion tampering must throw AssertionTamperedError', async () => {
    const specPath = path.resolve(tmpDir, 'tamper-spec.ts');
    await fs.writeFile(
      specPath,
      `test('t', async ({ page }) => { await expect(page.locator('#msg')).toHaveText('Success'); });`
    );

    const origHash = AssertionHasher.computeFingerprint(specPath);

    // Tamper with assertion
    await fs.writeFile(
      specPath,
      `test('t', async ({ page }) => { await expect(page.locator('#msg')).toBeVisible(); });`
    );

    const candidate: ResolvedElement = {
      tag: 'button',
      attributes: {},
      text: 'Submit',
      children: [],
      role: 'button',
      accessibleName: 'Submit',
    };

    expect(() => {
      IntentValidator.validate({
        testFilePath: specPath,
        originalFingerprint: origHash,
        candidateElement: candidate,
        intendedAction: 'click',
      });
    }).toThrow(AssertionTamperedError);
  });

  it('INTENT-04: should compute test body structural fingerprint', async () => {
    const specPath = path.resolve(tmpDir, 'test-body.ts');
    await fs.writeFile(
      specPath,
      `test('structural', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn');
  await expect(page).toHaveTitle('Home');
});`
    );

    const fp = AssertionHasher.computeTestBodyFingerprint(specPath);
    expect(typeof fp).toBe('string');
    expect(fp.length).toBe(64);
  });

  it('INTENT-05: reordering test statements must throw IntentInvariantViolationError [TestBodyStructure]', async () => {
    const specPath = path.resolve(tmpDir, 'reorder-spec.ts');
    await fs.writeFile(
      specPath,
      `test('reorder', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#user', 'admin');
  await page.click('#submit');
  await expect(page).toHaveURL('/dashboard');
});`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);

    // Reorder statements (click before fill!)
    await fs.writeFile(
      specPath,
      `test('reorder', async ({ page }) => {
  await page.goto('/login');
  await page.click('#submit');
  await page.fill('#user', 'admin');
  await expect(page).toHaveURL('/dashboard');
});`
    );

    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit',
      attributes: {},
      text: 'Submit',
      children: [],
    };

    expect(() => {
      IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComp,
        candidateElement: candidate,
        intendedAction: 'click',
      });
    }).toThrow(IntentInvariantViolationError);
  });

  it('INTENT-06: deleting a test statement must throw IntentInvariantViolationError', async () => {
    const specPath = path.resolve(tmpDir, 'delete-stmt.ts');
    await fs.writeFile(
      specPath,
      `test('del', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn1');
  await page.click('#btn2');
  await expect(page).toHaveTitle('Done');
});`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);

    // Delete btn1 click
    await fs.writeFile(
      specPath,
      `test('del', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn2');
  await expect(page).toHaveTitle('Done');
});`
    );

    const candidate: ResolvedElement = { tag: 'button', attributes: {}, text: 'Done', children: [] };
    expect(() => {
      IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComp,
        candidateElement: candidate,
        intendedAction: 'click',
      });
    }).toThrow(IntentInvariantViolationError);
  });

  it('INTENT-07: modifying test input literals must throw IntentInvariantViolationError [FixtureParameters]', async () => {
    const specPath = path.resolve(tmpDir, 'fixture-mod.ts');
    await fs.writeFile(
      specPath,
      `test('fixture', async ({ page }) => {
  await page.fill('#amount', '100');
  await expect(page.locator('#total')).toHaveText('100');
});`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);

    // Modify literal '100' to '50'
    await fs.writeFile(
      specPath,
      `test('fixture', async ({ page }) => {
  await page.fill('#amount', '50');
  await expect(page.locator('#total')).toHaveText('100');
});`
    );

    const candidate: ResolvedElement = { tag: 'button', attributes: {}, text: 'Pay', children: [] };
    expect(() => {
      IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComp,
        candidateElement: candidate,
        intendedAction: 'click',
      });
    }).toThrow(IntentInvariantViolationError);
  });

  it('INTENT-08: business oracle contradiction must return isValid: false', async () => {
    const specPath = path.resolve(tmpDir, 'oracle-contra.ts');
    await fs.writeFile(
      specPath,
      `test('o', async ({ page }) => { await expect(page).toHaveTitle('Title'); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = { tag: 'button', role: 'button', accessibleName: 'Submit', attributes: {}, text: 'Submit', children: [] };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'click',
      businessOracleStatus: 'contradicted',
    });

    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Business oracle contradicted');
  });

  it('INTENT-09: complete invariant satisfaction returns isValid: true', async () => {
    const specPath = path.resolve(tmpDir, 'satisfaction.ts');
    await fs.writeFile(
      specPath,
      `test('ok', async ({ page }) => {
  await page.goto('/home');
  await expect(page).toHaveTitle('Home');
});`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Proceed',
      attributes: {},
      text: 'Proceed',
      children: [],
    };

    const origPom = `export class Pom { readonly proceed = this.page.locator('#old'); }`;
    const patchedPom = `export class Pom { readonly proceed = this.page.getByRole('button', { name: 'Proceed' }); }`;

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'click',
      pageObjectOriginalSource: origPom,
      pageObjectPatchedSource: patchedPom,
      pageObjectClassName: 'Pom',
      targetMemberName: 'proceed',
      executionPassed: true,
    });

    expect(res.isValid).toBe(true);
    expect(res.assertionsPreserved).toBe(true);
    expect(res.testBodyPreserved).toBe(true);
    expect(res.fixturesPreserved).toBe(true);
    expect(res.identityAndActionPreserved).toBe(true);
    expect(res.diffAllowlistPassed).toBe(true);
    expect(res.executionVerified).toBe(true);
    expect(res.summary).toContain('Intent Invariant v2 satisfied');
  });

  it('INTENT-10: computeCompositeFingerprint combines all 3 hashes', async () => {
    const specPath = path.resolve(tmpDir, 'combo.ts');
    await fs.writeFile(
      specPath,
      `test('combo', async ({ page }) => { await expect(page).toHaveTitle('A'); });`
    );

    const composite = AssertionHasher.computeCompositeFingerprint(specPath);
    expect(composite.assertionFingerprint).toBeDefined();
    expect(composite.testBodyFingerprint).toBeDefined();
    expect(composite.fixtureFingerprint).toBeDefined();
    expect(composite.compositeHash.length).toBe(64);
  });

  it('INTENT-11: execution failure causes Intent Invariant v2 isValid: false', async () => {
    const specPath = path.resolve(tmpDir, 'exec-fail.ts');
    await fs.writeFile(
      specPath,
      `test('exec', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = { tag: 'button', role: 'button', accessibleName: 'Run', attributes: {}, text: 'Run', children: [] };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'click',
      executionPassed: false, // Independent verification failed
    });

    expect(res.isValid).toBe(false);
    expect(res.executionVerified).toBe(false);
  });

  it('INTENT-12: DiffAllowlistValidator integration in validateV2', async () => {
    const specPath = path.resolve(tmpDir, 'diff-v2.ts');
    await fs.writeFile(
      specPath,
      `test('d', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = { tag: 'button', role: 'button', accessibleName: 'Pay', attributes: {}, text: 'Pay', children: [] };

    const origPom = `export class Pom { readonly pay = this.page.locator('#old'); }`;
    const patchedPom = `export class Pom { readonly pay = this.page.getByRole('button', { name: 'Pay' }); }`;

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'click',
      pageObjectOriginalSource: origPom,
      pageObjectPatchedSource: patchedPom,
      pageObjectClassName: 'Pom',
      targetMemberName: 'pay',
      executionPassed: true,
    });

    expect(res.diffAllowlistPassed).toBe(true);
    expect(res.isValid).toBe(true);
  });

  it('INTENT-13: invalid action semantics causes identityAndActionPreserved: false', async () => {
    const specPath = path.resolve(tmpDir, 'bad-action.ts');
    await fs.writeFile(
      specPath,
      `test('a', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    // Non-clickable <div> with no role or handlers
    const candidate: ResolvedElement = { tag: 'section', attributes: {}, text: '', children: [] };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'click',
    });

    expect(res.identityAndActionPreserved).toBe(false);
    expect(res.isValid).toBe(false);
  });

  it('INTENT-14: fill action on textarea passes identity and action invariant', async () => {
    const specPath = path.resolve(tmpDir, 'fill-ok.ts');
    await fs.writeFile(
      specPath,
      `test('fill', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = { tag: 'textarea', role: 'textbox', accessibleName: 'Notes', attributes: {}, text: '', children: [] };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'fill',
      mode: 'pre-flight',
    });

    expect(res.identityAndActionPreserved).toBe(true);
    expect(res.isValid).toBe(true);
  });

  it('INTENT-15: fill action on button fails identity and action invariant', async () => {
    const specPath = path.resolve(tmpDir, 'fill-bad.ts');
    await fs.writeFile(
      specPath,
      `test('f', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    const origComp = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = { tag: 'button', role: 'button', accessibleName: 'Click', attributes: {}, text: 'Click', children: [] };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComp,
      candidateElement: candidate,
      intendedAction: 'fill',
    });

    expect(res.identityAndActionPreserved).toBe(false);
    expect(res.isValid).toBe(false);
  });
});

