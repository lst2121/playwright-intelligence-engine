import { Project, Node, SyntaxKind } from 'ts-morph';
import { UnauthorizedAstModificationError } from '../core/errors/engine-errors.js';

export interface DiffAllowlistTarget {
  originalSource: string;
  patchedSource: string;
  targetClassName: string;
  targetMemberName: string;
}

export interface DiffAllowlistResult {
  isAllowed: boolean;
  reason?: string | undefined;
  modifiedMember?: string | undefined;
}

export class DiffAllowlistValidator {
  private static readonly APPROVED_LOCATOR_METHODS = new Set([
    'locator',
    'getByRole',
    'getByText',
    'getByTestId',
    'getByLabel',
    'getByPlaceholder',
    'getByAltText',
    'getByTitle',
    'filter',
    'first',
    'last',
    'nth',
  ]);

  /**
   * Validates that ONLY the authorized locator member within the specified Page Object was modified.
   * Compares the COMPLETE AST of the source file:
   * - Prohibits modifying or adding imports.
   * - Prohibits adding, removing, or modifying top-level functions, variables, interfaces, enums, type aliases.
   * - Prohibits adding or removing class members (properties, methods, getters, setters, constructors).
   * - Prohibits modifying class inheritance, decorators, or modifiers.
   * - Validates that the replacement expression conforms strictly to the approved Playwright locator grammar.
   */
  public static validate(target: DiffAllowlistTarget): DiffAllowlistResult {
    const origProject = new Project({ skipAddingFilesFromTsConfig: true });
    const patchProject = new Project({ skipAddingFilesFromTsConfig: true });

    const origFile = origProject.createSourceFile('orig.ts', target.originalSource);
    const patchFile = patchProject.createSourceFile('patched.ts', target.patchedSource);

    // 1. Verify Imports: Exact match
    const origImports = origFile.getImportDeclarations().map((i) => i.getText().trim());
    const patchImports = patchFile.getImportDeclarations().map((i) => i.getText().trim());
    if (JSON.stringify(origImports) !== JSON.stringify(patchImports)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Import declarations were modified, added, or deleted.',
      };
    }

    // 2. Verify Top-Level Non-Class Declarations (Functions, Variables, Interfaces, Type Aliases, Enums)
    const origFunctions = origFile.getFunctions().map((f) => f.getText().trim());
    const patchFunctions = patchFile.getFunctions().map((f) => f.getText().trim());
    if (JSON.stringify(origFunctions) !== JSON.stringify(patchFunctions)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Top-level function declarations were added, removed, or modified.',
      };
    }

    const origInterfaces = origFile.getInterfaces().map((i) => i.getText().trim());
    const patchInterfaces = patchFile.getInterfaces().map((i) => i.getText().trim());
    if (JSON.stringify(origInterfaces) !== JSON.stringify(patchInterfaces)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Interface declarations were altered.',
      };
    }

    const origTypeAliases = origFile.getTypeAliases().map((t) => t.getText().trim());
    const patchTypeAliases = patchFile.getTypeAliases().map((t) => t.getText().trim());
    if (JSON.stringify(origTypeAliases) !== JSON.stringify(patchTypeAliases)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Type alias declarations were altered.',
      };
    }

    const origEnums = origFile.getEnums().map((e) => e.getText().trim());
    const patchEnums = patchFile.getEnums().map((e) => e.getText().trim());
    if (JSON.stringify(origEnums) !== JSON.stringify(patchEnums)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Enum declarations were altered.',
      };
    }

    // 3. Verify Classes: Exact count and names
    const origClasses = origFile.getClasses();
    const patchClasses = patchFile.getClasses();
    if (origClasses.length !== patchClasses.length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Class structure or declarations were altered (Class count changed ${origClasses.length} -> ${patchClasses.length}).`,
      };
    }

    for (let idx = 0; idx < origClasses.length; idx++) {
      if (origClasses[idx]?.getName() !== patchClasses[idx]?.getName()) {
        return {
          isAllowed: false,
          reason: 'Diff allowlist violated: Class structure or declarations were altered.',
        };
      }
    }

    // 4. Locate Target Class
    const origClass = origFile.getClass(target.targetClassName);
    const patchClass = patchFile.getClass(target.targetClassName);

    if (!origClass || !patchClass) {
      // Check top-level constant pattern if class is not used
      const origVar = origFile.getVariableDeclaration(target.targetMemberName);
      const patchVar = patchFile.getVariableDeclaration(target.targetMemberName);
      if (origVar && patchVar) {
        const replacement = patchVar.getInitializer()?.getText() ?? '';
        const grammarCheck = DiffAllowlistValidator.validateLocatorGrammar(replacement);
        if (!grammarCheck.isValid) {
          return { isAllowed: false, reason: grammarCheck.reason };
        }
        return { isAllowed: true, modifiedMember: target.targetMemberName };
      }

      return {
        isAllowed: false,
        reason: `Target class '${target.targetClassName}' not found in source AST.`,
      };
    }

    // 5. Verify Target Class Structure & Members
    // Total member counts must match
    if (origClass.getProperties().length !== patchClass.getProperties().length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Class property count changed (${origClass.getProperties().length} -> ${patchClass.getProperties().length}). Unauthorized property added or removed.`,
      };
    }

    if (origClass.getMethods().length !== patchClass.getMethods().length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Class method count changed (${origClass.getMethods().length} -> ${patchClass.getMethods().length}). Unauthorized method added or removed.`,
      };
    }

    if (origClass.getGetAccessors().length !== patchClass.getGetAccessors().length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Getter accessor count changed in class '${target.targetClassName}'.`,
      };
    }

    if (origClass.getSetAccessors().length !== patchClass.getSetAccessors().length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Setter accessor count changed in class '${target.targetClassName}'.`,
      };
    }

    if (origClass.getConstructors().length !== patchClass.getConstructors().length) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Constructor count changed in class '${target.targetClassName}'.`,
      };
    }

    // Check heritage, modifiers, decorators
    if (origClass.getExtends()?.getText() !== patchClass.getExtends()?.getText()) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Class 'extends' heritage was altered.`,
      };
    }

    // 6. Verify all other properties are unchanged
    for (const prop of origClass.getProperties()) {
      const name = prop.getName();
      if (name !== target.targetMemberName) {
        const patchProp = patchClass.getProperty(name);
        if (!patchProp || patchProp.getText().trim() !== prop.getText().trim()) {
          return {
            isAllowed: false,
            reason: `Diff allowlist violated: Unauthorized change to property '${name}' in class '${target.targetClassName}'.`,
          };
        }
      }
    }

    // 7. Verify all other methods are unchanged
    for (const method of origClass.getMethods()) {
      const name = method.getName();
      if (name !== target.targetMemberName) {
        const patchMethod = patchClass.getMethod(name);
        if (!patchMethod || patchMethod.getText().trim() !== method.getText().trim()) {
          return {
            isAllowed: false,
            reason: `Diff allowlist violated: Unauthorized change to method '${name}' in class '${target.targetClassName}'.`,
          };
        }
      }
    }

    // 8. Extract and validate replacement expression
    const patchProp = patchClass.getProperty(target.targetMemberName);
    const patchGetter = patchClass.getGetAccessor(target.targetMemberName);
    const patchMethod = patchClass.getMethod(target.targetMemberName);
    let locatorText = '';

    if (patchProp && patchProp.getInitializer()) {
      locatorText = patchProp.getInitializer()!.getText();
    } else if (patchGetter) {
      const returns = patchGetter.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      locatorText = returns[0]?.getExpression()?.getText() ?? '';
    } else if (patchMethod) {
      const returns = patchMethod.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      locatorText = returns[0]?.getExpression()?.getText() ?? '';
    } else {
      // Check constructor assignments
      for (const ctor of patchClass.getConstructors()) {
        for (const stmt of ctor.getStatements()) {
          if (Node.isExpressionStatement(stmt)) {
            const expr = stmt.getExpression();
            if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
              if (expr.getLeft().getText() === `this.${target.targetMemberName}`) {
                locatorText = expr.getRight().getText();
                break;
              }
            }
          }
        }
      }
    }

    if (!locatorText) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Target member '${target.targetMemberName}' has no replacement expression.`,
      };
    }

    // 9. Semantic AST Locator Grammar Validation
    const grammarCheck = DiffAllowlistValidator.validateLocatorGrammar(locatorText);
    if (!grammarCheck.isValid) {
      return {
        isAllowed: false,
        reason: grammarCheck.reason,
      };
    }

    return {
      isAllowed: true,
      modifiedMember: target.targetMemberName,
    };
  }

  /**
   * Validates that a replacement expression is strictly a safe Playwright locator call AST.
   * Rejects arbitrary statements, process calls, functions, or unapproved methods.
   */
  public static validateLocatorGrammar(expressionText: string): { isValid: boolean; reason?: string } {
    // 1. Basic sanitization: No statements separated by semicolons
    const trimmed = expressionText.trim().replace(/;$/, '');
    if (trimmed.includes(';')) {
      return {
        isValid: false,
        reason: `Replacement expression contains disallowed statements: multiple statements in '${expressionText}'`,
      };
    }

    // 2. Parse into AST expression
    const tempProject = new Project({ skipAddingFilesFromTsConfig: true });
    const tempFile = tempProject.createSourceFile('temp_expr.ts', `const _x = ${trimmed};`);
    const varDecl = tempFile.getVariableDeclaration('_x');
    const initializer = varDecl?.getInitializer();

    if (!initializer) {
      return {
        isValid: false,
        reason: `Replacement expression contains disallowed statements: failed to parse '${expressionText}'`,
      };
    }

    // String literals are valid for locator constants (e.g. '[data-test=submit]')
    if (Node.isStringLiteral(initializer)) {
      return { isValid: true };
    }

    // Must be a CallExpression or PropertyAccessExpression resolving to a locator
    if (!Node.isCallExpression(initializer)) {
      return {
        isValid: false,
        reason: `Replacement expression contains disallowed statements: must be a CallExpression (e.g. this.page.getByRole(...)), received ${initializer.getKindName()}`,
      };
    }

    // Validate the call chain
    let current: Node = initializer;
    while (Node.isCallExpression(current)) {
      const expr = current.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const methodName = expr.getName();
        if (!DiffAllowlistValidator.APPROVED_LOCATOR_METHODS.has(methodName)) {
          return {
            isValid: false,
            reason: `Replacement expression contains disallowed statements: disallowed method call '${methodName}'. Only Playwright locator methods are permitted.`,
          };
        }
        current = expr.getExpression();
      } else {
        break;
      }
    }

    // Root of chain must be `this.page`, `page`, `this`, or a parameterless locator variable
    const rootText = current.getText().trim();
    if (rootText !== 'this.page' && rootText !== 'page' && rootText !== 'this') {
      return {
        isValid: false,
        reason: `Replacement expression contains disallowed statements: locator chain root must be 'this.page' or 'page', received '${rootText}'`,
      };
    }

    return { isValid: true };
  }

  /**
   * Asserts diff allowlist compliance, throwing UnauthorizedAstModificationError if violated.
   */
  public static assertAllowed(target: DiffAllowlistTarget): void {
    const result = DiffAllowlistValidator.validate(target);
    if (!result.isAllowed) {
      throw new UnauthorizedAstModificationError(result.reason ?? 'Unknown violation');
    }
  }
}
