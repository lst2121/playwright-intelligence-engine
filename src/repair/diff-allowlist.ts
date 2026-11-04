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
  reason?: string;
  modifiedMember?: string;
}

export class DiffAllowlistValidator {
  /**
   * Validates that ONLY the authorized locator member within the specified Page Object was modified.
   * Disallows modifying assertions, fixtures, helper functions, other classes, or imports.
   */
  public static validate(target: DiffAllowlistTarget): DiffAllowlistResult {
    const origProject = new Project({ skipAddingFilesFromTsConfig: true });
    const patchProject = new Project({ skipAddingFilesFromTsConfig: true });

    const origFile = origProject.createSourceFile('orig.ts', target.originalSource);
    const patchFile = patchProject.createSourceFile('patched.ts', target.patchedSource);

    // 1. Check Imports: Imports must remain identical
    const origImports = origFile.getImportDeclarations().map((i) => i.getText().trim());
    const patchImports = patchFile.getImportDeclarations().map((i) => i.getText().trim());
    if (JSON.stringify(origImports) !== JSON.stringify(patchImports)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Import declarations were modified, added, or deleted.',
      };
    }

    // 2. Check Classes: Must have the exact same classes
    const origClasses = origFile.getClasses().map((c) => c.getName());
    const patchClasses = patchFile.getClasses().map((c) => c.getName());
    if (JSON.stringify(origClasses) !== JSON.stringify(patchClasses)) {
      return {
        isAllowed: false,
        reason: 'Diff allowlist violated: Class structure or declarations were altered.',
      };
    }

    // 3. Locate Target Class
    const origClass = origFile.getClass(target.targetClassName);
    const patchClass = patchFile.getClass(target.targetClassName);

    if (!origClass || !patchClass) {
      return {
        isAllowed: false,
        reason: `Target class '${target.targetClassName}' not found in source AST.`,
      };
    }

    // 4. Verify all OTHER members in the target class are unchanged
    const origProperties = origClass.getProperties();
    for (const prop of origProperties) {
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

    // 5. Verify all other methods are unchanged
    const origMethods = origClass.getMethods();
    for (const method of origMethods) {
      const name = method.getName();
      const patchMethod = patchClass.getMethod(name);
      if (!patchMethod || patchMethod.getText().trim() !== method.getText().trim()) {
        return {
          isAllowed: false,
          reason: `Diff allowlist violated: Unauthorized change to method '${name}' in class '${target.targetClassName}'.`,
        };
      }
    }

    // 6. Verify that the modified member is strictly a locator expression
    const patchProp = patchClass.getProperty(target.targetMemberName);
    const patchGetter = patchClass.getGetAccessor(target.targetMemberName);
    let locatorText = '';

    if (patchProp && patchProp.getInitializer()) {
      locatorText = patchProp.getInitializer()!.getText();
    } else if (patchGetter) {
      const returns = patchGetter.getDescendantsOfKind(SyntaxKind.ReturnStatement);
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

    // Ensure locator expression does not execute assertions or arbitrary scripts
    if (
      locatorText.includes('expect(') ||
      locatorText.includes('process.exit') ||
      locatorText.includes('require(') ||
      locatorText.includes('eval(')
    ) {
      return {
        isAllowed: false,
        reason: `Diff allowlist violated: Replacement expression contains disallowed statements: '${locatorText}'.`,
      };
    }

    return {
      isAllowed: true,
      modifiedMember: target.targetMemberName,
    };
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
