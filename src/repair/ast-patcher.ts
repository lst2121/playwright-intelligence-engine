import { Project, SyntaxKind, Node } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import { AbstentionError } from '../core/errors/engine-errors.js';
import { DiffAllowlistValidator } from './diff-allowlist.js';

export interface PatchTarget {
  filePath: string;
  className: string;
  memberName: string;
  replacementExpression: string; // e.g. "this.page.getByRole('button', { name: 'Submit' })"
}

export type SupportedPOMPattern =
  | 'property-initializer'
  | 'getter-return'
  | 'constructor-assignment'
  | 'parameterless-factory'
  | 'locator-constant';

export interface PatchResult {
  success: boolean;
  pattern: SupportedPOMPattern;
  originalExpression: string;
  replacementExpression: string;
  patchedSource?: string;
}

export class AstPatcher {
  private project: Project;

  constructor(tsConfigFilePath?: string) {
    if (tsConfigFilePath) {
      this.project = new Project({
        tsConfigFilePath,
        skipAddingFilesFromTsConfig: false,
      });
    } else {
      this.project = new Project({
        skipAddingFilesFromTsConfig: true,
      });
    }
  }

  public static generateDiff(originalText: string, patchedText: string, fileName = 'target.ts'): string {
    const origLines = originalText.split('\n');
    const patchedLines = patchedText.split('\n');
    const diffLines: string[] = [`--- a/${fileName}`, `+++ b/${fileName}`];
    for (let i = 0; i < Math.max(origLines.length, patchedLines.length); i++) {
      const orig = origLines[i];
      const patch = patchedLines[i];
      if (orig !== patch) {
        if (orig !== undefined) diffLines.push(`- ${orig}`);
        if (patch !== undefined) diffLines.push(`+ ${patch}`);
      }
    }
    return diffLines.join('\n');
  }

  /**
   * Surgical AST modification targeting Page Object locator definitions in-memory.
   * Does NOT write to disk, enabling sandboxed validation and atomic diff checking.
   */
  public patchPageObjectInMemory(sourceText: string, target: Omit<PatchTarget, 'filePath'>): {
    patchedSource: string;
    pattern: SupportedPOMPattern;
    originalExpression: string;
    diff: string;
  } {
    // 1. Validate locator expression grammar upfront
    const grammarCheck = DiffAllowlistValidator.validateLocatorGrammar(target.replacementExpression);
    if (!grammarCheck.isValid) {
      throw new AbstentionError(
        grammarCheck.reason ?? 'Invalid locator grammar',
        'AST_INVALID_REPLACEMENT_EXPRESSION'
      );
    }

    const tempProject = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = tempProject.createSourceFile('memory.ts', sourceText);
    const classDecl = sourceFile.getClass(target.className);

    const createResult = (patchedSource: string, pattern: SupportedPOMPattern, originalExpression: string) => ({
      patchedSource,
      pattern,
      originalExpression,
      diff: AstPatcher.generateDiff(sourceText, patchedSource),
    });

    // Pattern 5: Top-level constant
    if (!classDecl) {
      const variableDecl = sourceFile.getVariableDeclaration(target.memberName);
      if (variableDecl && variableDecl.getInitializer()) {
        const originalExpression = variableDecl.getInitializer()!.getText();
        variableDecl.setInitializer(target.replacementExpression);
        return createResult(sourceFile.getFullText(), 'locator-constant', originalExpression);
      }

      throw new AbstentionError(
        `Class '${target.className}' not found in source AST`,
        'AST_CLASS_NOT_FOUND'
      );
    }

    // Pattern 1: Property Initializer
    const property = classDecl.getProperty(target.memberName);
    if (property && property.getInitializer()) {
      const originalExpression = property.getInitializer()!.getText();
      property.setInitializer(target.replacementExpression);
      return createResult(sourceFile.getFullText(), 'property-initializer', originalExpression);
    }

    // Pattern 2: Getter Method
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
      return createResult(sourceFile.getFullText(), 'getter-return', originalExpression);
    }

    // Pattern 3: Constructor Assignment
    for (const ctor of classDecl.getConstructors()) {
      for (const statement of ctor.getStatements()) {
        if (Node.isExpressionStatement(statement)) {
          const expr = statement.getExpression();
          if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
            const leftText = expr.getLeft().getText();
            if (leftText === `this.${target.memberName}`) {
              const originalExpression = expr.getRight().getText();
              expr.getRight().replaceWithText(target.replacementExpression);
              return createResult(sourceFile.getFullText(), 'constructor-assignment', originalExpression);
            }
          }
        }
      }
    }

    // Pattern 4: Parameterless Locator Factory Method
    const method = classDecl.getMethod(target.memberName);
    if (method) {
      if (method.getParameters().length === 0) {
        const returnStatements = method.getDescendantsOfKind(SyntaxKind.ReturnStatement);
        if (returnStatements.length === 1 && returnStatements[0]?.getExpression()) {
          const returnExpr = returnStatements[0]!.getExpression()!;
          const originalExpression = returnExpr.getText();
          returnExpr.replaceWithText(target.replacementExpression);
          return createResult(sourceFile.getFullText(), 'parameterless-factory', originalExpression);
        }
      } else {
        throw new AbstentionError(
          `Method '${target.memberName}' has ${method.getParameters().length} parameter(s). Dynamic parameterized locators cannot be safely patched.`,
          'AST_PARAMETERIZED_LOCATOR'
        );
      }
    }

    throw new AbstentionError(
      `Locator member '${target.memberName}' not found in class '${target.className}' across supported patterns.`,
      'AST_UNSUPPORTED_PATTERN'
    );
  }

  /**
   * Surgical AST modification targeting Page Object locator definitions.
   * Performs in-memory patch validation, then atomically writes to disk
   * using a temporary file and atomic rename to guarantee transactional consistency.
   */
  public patchPageObject(target: PatchTarget): PatchResult {
    const sourceFile = this.project.addSourceFileAtPath(target.filePath);
    const originalText = sourceFile.getFullText();

    // Patch in-memory first to validate pattern & locator grammar
    const inMem = this.patchPageObjectInMemory(originalText, {
      className: target.className,
      memberName: target.memberName,
      replacementExpression: target.replacementExpression,
    });

    // Write to a temporary file in the same directory and atomically rename
    const targetDir = path.dirname(target.filePath);
    const tempFile = path.join(
      targetDir,
      `.${path.basename(target.filePath)}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`
    );

    try {
      fs.writeFileSync(tempFile, inMem.patchedSource, 'utf8');
      fs.renameSync(tempFile, target.filePath);
      sourceFile.refreshFromFileSystemSync();

      return {
        success: true,
        pattern: inMem.pattern,
        originalExpression: inMem.originalExpression,
        replacementExpression: target.replacementExpression,
        patchedSource: inMem.patchedSource,
      };
    } catch (err: any) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // ignore cleanup failure
        }
      }
      throw err;
    }
  }
}
