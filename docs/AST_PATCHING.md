# AST Patching & Page Object Pattern Specification

This document specifies the AST manipulation engine, supported Page Object Model (POM) architectures, diff allowlist validation, and safety boundaries implemented in `src/repair/ast-patcher.ts` and `src/repair/diff-allowlist.ts`.

---

## 1. Supported Page Object Model (POM) Patterns

Playwright enterprise suites utilize various TypeScript Page Object design patterns. The `AstPatcher` engine leverages `ts-morph` to safely analyze and modify these patterns with full syntax tree fidelity, preserving formatting, JSDoc comments, and TypeScript type annotations.

### Pattern 1: Class Property Initializer
The industry-standard Playwright pattern using `readonly` class properties:
```typescript
export class LoginPage {
  readonly page: Page;
  // TARGET PROPERTY
  readonly submitButton = this.page.locator('button#submit');

  constructor(page: Page) {
    this.page = page;
  }
}
```
**Patch Mechanism**: Locates `PropertyDeclaration` named `submitButton`, replaces its initializer expression with the verified new locator call (`this.page.getByRole('button', { name: 'Log in' })`).

---

### Pattern 2: Class Getter Declaration
Used when locators require lazy dynamic evaluation on invocation:
```typescript
export class CartPage {
  constructor(private page: Page) {}

  // TARGET GETTER
  get checkoutButton(): Locator {
    return this.page.locator('.checkout-btn');
  }
}
```
**Patch Mechanism**: Locates `GetAccessorDeclaration` named `checkoutButton`, finds the inner `ReturnStatement`, and updates the returned expression.

---

### Pattern 3: Constructor Assignment
Common in legacy or Java-style Page Object patterns:
```typescript
export class InventoryPage {
  page: Page;
  sortDropdown: Locator;

  constructor(page: Page) {
    this.page = page;
    // TARGET ASSIGNMENT
    this.sortDropdown = this.page.locator('select.sort');
  }
}
```
**Patch Mechanism**: Inspects `ConstructorDeclaration` statements, finds the `BinaryExpression` where the left expression matches `this.sortDropdown`, and rewrites the right-hand side expression.

---

### Pattern 4: Parameterless Factory Method
```typescript
export class ProfilePage {
  constructor(private page: Page) {}

  // TARGET FACTORY METHOD
  getSaveButton() {
    return this.page.locator('button.save-profile');
  }
}
```
**Patch Mechanism**: Locates `MethodDeclaration` without parameters, updates the `ReturnStatement` expression.

---

### Pattern 5: Standalone Locator Constant
Used in lightweight functional test architectures:
```typescript
// TARGET CONSTANT
export const SEARCH_INPUT = (page: Page) => page.locator('input#search');
// OR
export const DEFAULT_HEADER = 'header.main-header';
```
**Patch Mechanism**: Locates `VariableDeclaration` named `SEARCH_INPUT`, verifies scope, and updates the initializer expression.

---

## 2. Rejection of Parameterized Dynamic Methods

In enterprise Page Objects, helper methods frequently accept dynamic parameters to target table rows, specific IDs, or item names:
```typescript
// DYNAMIC PARAMETERIZED METHOD — UNSUPPORTED
export class UserTablePage {
  constructor(private page: Page) {}

  userRow(userId: string) {
    return this.page.locator(`tr[data-user-id="${userId}"]`);
  }
}
```

### Safety Abstention Rule
Static string or selector replacement inside dynamic parameterized methods risks:
- Corrupting parameter interpolation (`${userId}`).
- Breaking TypeScript type inference and generics.
- Introducing syntax errors into surrounding closure logic.

**Engine Behavior**:  
When `AstPatcher` inspects a target method containing one or more parameters (`parameters.length > 0`), it **strictly aborts**:
```typescript
if (methodDeclaration.getParameters().length > 0) {
  throw new DiagnosticError(
    DiagnosticCategory.AST_PARAMETERIZED_LOCATOR,
    `Dynamic parameterized locator method '${targetName}(...)' cannot be safely auto-patched. Manual developer review required.`
  );
}
```
This is a critical safety boundary ensuring that complex dynamic locator factories are never corrupted.

---

## 3. Diff Allowlist AST Validation (`DiffAllowlistValidator`)

Before any patch is written to disk or tested, `DiffAllowlistValidator` compares the pre-patch AST and post-patch AST to ensure absolute boundary isolation.

### Allowlist Rules
1. **Zero Import Alterations**: The count, specifiers, and module paths of all `ImportDeclaration` nodes must be identical.
2. **Zero Structural Additions**: The count of class methods, getters, properties, and constructors must not change.
3. **Zero Decorator / Metadata Modifications**: Class decorators and class heritage clauses (`extends`, `implements`) must be untouched.
4. **Single-Node Modification Guarantee**: Exactly one AST node initializer may exhibit a diff.

If any collateral modification is detected, the operation is immediately rejected with `DiffAllowlistViolationError`.

---

## 4. Atomic Rollback & Syntax Verification

Every AST modification follows an atomic lifecycle:
1. `ts-morph` creates an in-memory clone of the source file.
2. Transformation is applied in-memory.
3. TypeScript compiler diagnostics are executed on the modified file (`sourceFile.getPreEmitDiagnostics()`).
4. If any TypeScript diagnostic errors (e.g. syntax errors, type mismatches, unresolved identifiers) are detected, the transformation is aborted and memory is cleared.
5. Only upon zero diagnostic errors is the file committed to the isolated worktree directory.

