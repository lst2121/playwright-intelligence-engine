import { Project, SyntaxKind, Node } from 'ts-morph';
import { AbstentionError } from '../core/errors/engine-errors.js';

export interface PatchTarget {
  filePath: string;
  className: string;
  memberName: string;
  replacementExpression: string; // e.g. "this.page.getByRole('button', { name: 'Submit' })"
}

export type SupportedPOMPattern = 'property-initializer' | 'getter-return' | 'constructor-assignment';

export interface PatchResult {
  success: boolean;
  pattern: SupportedPOMPattern;
  originalExpression: string;
  replacementExpression: string;
}

export class AstPatcher {
  private project: Project;

  constructor(tsConfigFilePath?: string) {
    this.project = new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: !tsConfigFilePath,
    });
  }

  /**
   * Surgical AST modification targeting Page Object locator definitions.
   * Constrained to the 3 enterprise Page Object patterns.
   * Throws AbstentionError if pattern is ambiguous, parameterized, or unsupported.
   */
  public patchPageObject(target: PatchTarget): PatchResult {
    const sourceFile = this.project.addSourceFileAtPath(target.filePath);
    const classDecl = sourceFile.getClass(target.className);

    if (!classDecl) {
      throw new AbstentionError(
        `Class '${target.className}' not found in '${target.filePath}'`,
        'AST_CLASS_NOT_FOUND'
      );
    }

    // Pattern 1: Property Initializer (e.g. readonly submitBtn = this.page.locator(...))
    const property = classDecl.getProperty(target.memberName);
    if (property && property.getInitializer()) {
      const initializer = property.getInitializer()!;
      const originalExpression = initializer.getText();
      property.setInitializer(target.replacementExpression);
      sourceFile.saveSync();
      return {
        success: true,
        pattern: 'property-initializer',
        originalExpression,
        replacementExpression: target.replacementExpression,
      };
    }

    // Pattern 2: Simple Getter Method (e.g. get submitBtn(): Locator { return this.page.locator(...); })
    const getter = classDecl.getGetAccessor(target.memberName);
    if (getter) {
      const returnStatements = getter.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      if (returnStatements.length !== 1) {
        throw new AbstentionError(
          `Getter '${target.memberName}' contains complex control flow (${returnStatements.length} return statements)`,
          'AST_COMPLEX_CONTROL_FLOW'
        );
      }
      const returnExpr = returnStatements[0]!.getExpression();
      if (!returnExpr) {
        throw new AbstentionError(
          `Getter '${target.memberName}' return statement has no expression`,
          'AST_EMPTY_RETURN'
        );
      }
      const originalExpression = returnExpr.getText();
      returnExpr.replaceWithText(target.replacementExpression);
      sourceFile.saveSync();
      return {
        success: true,
        pattern: 'getter-return',
        originalExpression,
        replacementExpression: target.replacementExpression,
      };
    }

    // Pattern 3: Constructor Assignment (e.g. this.submitBtn = page.locator(...))
    for (const ctor of classDecl.getConstructors()) {
      for (const statement of ctor.getStatements()) {
        if (Node.isExpressionStatement(statement)) {
          const expr = statement.getExpression();
          if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
            const leftText = expr.getLeft().getText();
            if (leftText === `this.${target.memberName}`) {
              const originalExpression = expr.getRight().getText();
              expr.getRight().replaceWithText(target.replacementExpression);
              sourceFile.saveSync();
              return {
                success: true,
                pattern: 'constructor-assignment',
                originalExpression,
                replacementExpression: target.replacementExpression,
              };
            }
          }
        }
      }
    }

    // Check if member is a parameterized helper method (e.g. row(id: string)) -> MUST ABSTAIN
    const method = classDecl.getMethod(target.memberName);
    if (method && method.getParameters().length > 0) {
      throw new AbstentionError(
        `Member '${target.memberName}' is a parameterized helper method (${method.getParameters().length} params). Dynamic locators require manual review.`,
        'AST_PARAMETERIZED_LOCATOR'
      );
    }

    throw new AbstentionError(
      `Target member '${target.memberName}' does not match any supported Page Object pattern in class '${target.className}'`,
      'AST_UNSUPPORTED_PATTERN'
    );
  }
}
