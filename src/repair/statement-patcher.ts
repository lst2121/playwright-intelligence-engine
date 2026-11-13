import { Project, SyntaxKind, Node, Statement } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import { AbstentionError } from '../core/errors/engine-errors.js';
import { AstPatcher } from './ast-patcher.js';

export type StatementPatchOperation =
  | 'replace-timeout-with-wait'
  | 'wrap-action-with-response'
  | 'insert-readiness-check'
  | 'replace-inline-locator'
  | 'replace-statement';

export interface BaseStatementPatchPlan {
  kind: StatementPatchOperation;
  /** 1-based line number in the source file. If omitted, matching is done by text pattern. */
  targetLine?: number;
}

export interface ReplaceTimeoutPlan extends BaseStatementPatchPlan {
  kind: 'replace-timeout-with-wait';
  /** Replacement wait statement, e.g. "await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 5000 });" */
  replacementWaitStatement: string;
}

export interface WrapActionWithResponsePlan extends BaseStatementPatchPlan {
  kind: 'wrap-action-with-response';
  /** Target action substring to locate if targetLine is omitted, e.g. "click()" or locator name */
  targetActionSubstring?: string;
  /** Predicate string for page.waitForResponse, e.g. "resp => resp.url().includes('/api/auth') && resp.status() === 200" */
  responsePredicate: string;
  /** Optional custom timeout in ms for waitForResponse */
  timeoutMs?: number;
  /** Optional explicit page variable name, defaults to auto-detected or "page" */
  pageVarName?: string;
}

export interface InsertReadinessCheckPlan extends BaseStatementPatchPlan {
  kind: 'insert-readiness-check';
  /** Target action substring to locate if targetLine is omitted */
  targetActionSubstring?: string;
  /** Statement to insert before action, e.g. "await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();" */
  readinessStatement: string;
}

export interface ReplaceInlineLocatorPlan extends BaseStatementPatchPlan {
  kind: 'replace-inline-locator';
  /** Old locator text in statement, e.g. "page.locator('.btn-login')" */
  oldLocatorText: string;
  /** New locator expression, e.g. "page.getByRole('button', { name: 'Log In' })" */
  newLocatorExpression: string;
}

export interface ReplaceStatementPlan extends BaseStatementPatchPlan {
  kind: 'replace-statement';
  /** Target substring to locate statement if targetLine is omitted */
  targetSubstring?: string;
  /** Complete new statement to replace existing one */
  newStatement: string;
}

export type StatementPatchPlan =
  | ReplaceTimeoutPlan
  | WrapActionWithResponsePlan
  | InsertReadinessCheckPlan
  | ReplaceInlineLocatorPlan
  | ReplaceStatementPlan;

export interface StatementPatchResult {
  success: boolean;
  operation: StatementPatchOperation;
  originalStatement: string;
  replacementStatement: string;
  patchedSource: string;
  diff: string;
  importAdded?: boolean;
}

export class StatementPatcher {
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

  /**
   * Patches a test source string in-memory without touching disk.
   */
  public patchStatementInMemory(
    sourceText: string,
    plan: StatementPatchPlan,
    fileName = 'test.spec.ts'
  ): StatementPatchResult {
    const tempProject = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = tempProject.createSourceFile(fileName, sourceText);

    let importAdded = false;

    // Check if expect import is needed
    if (
      plan.kind === 'replace-timeout-with-wait' ||
      plan.kind === 'insert-readiness-check' ||
      plan.kind === 'replace-statement'
    ) {
      const codeToCheck =
        plan.kind === 'replace-timeout-with-wait'
          ? plan.replacementWaitStatement
          : plan.kind === 'insert-readiness-check'
            ? plan.readinessStatement
            : plan.newStatement;

      if (codeToCheck.includes('expect(')) {
        importAdded = this.ensurePlaywrightExpectImport(sourceFile);
      }
    }

    let result: {
      originalStatement: string;
      replacementStatement: string;
    };

    switch (plan.kind) {
      case 'replace-timeout-with-wait':
        result = this.executeReplaceTimeout(sourceFile, plan);
        break;
      case 'wrap-action-with-response':
        result = this.executeWrapActionWithResponse(sourceFile, plan);
        break;
      case 'insert-readiness-check':
        result = this.executeInsertReadinessCheck(sourceFile, plan);
        break;
      case 'replace-inline-locator':
        result = this.executeReplaceInlineLocator(sourceFile, plan);
        break;
      case 'replace-statement':
        result = this.executeReplaceStatement(sourceFile, plan);
        break;
      default:
        throw new AbstentionError(
          `Unsupported statement patch operation: ${(plan as BaseStatementPatchPlan).kind}`,
          'AST_UNSUPPORTED_STATEMENT_OPERATION'
        );
    }

    // Validate that syntax remains valid after patching
    const diagnostics = tempProject.getProgram().getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      const firstError = diagnostics[0]?.getMessageText();
      const errorMsg = typeof firstError === 'string' ? firstError : firstError?.getMessageText();
      throw new AbstentionError(
        `Syntax error after applying statement patch: ${errorMsg ?? 'unknown syntax error'}`,
        'AST_SYNTAX_ERROR'
      );
    }

    const patchedSource = sourceFile.getFullText();
    const diff = AstPatcher.generateDiff(sourceText, patchedSource, fileName);

    return {
      success: true,
      operation: plan.kind,
      originalStatement: result.originalStatement,
      replacementStatement: result.replacementStatement,
      patchedSource,
      diff,
      importAdded,
    };
  }

  /**
   * Patches a test file on disk atomically.
   */
  public patchStatementInFile(filePath: string, plan: StatementPatchPlan): StatementPatchResult {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new AbstentionError(`Target file not found at ${resolvedPath}`, 'AST_FILE_NOT_FOUND');
    }

    const sourceFile = this.project.getSourceFile(resolvedPath) ?? this.project.addSourceFileAtPath(resolvedPath);
    const sourceText = sourceFile.getFullText();
    const fileName = path.basename(resolvedPath);
    const result = this.patchStatementInMemory(sourceText, plan, fileName);

    const targetDir = path.dirname(resolvedPath);
    const tempFile = path.join(
      targetDir,
      `.${path.basename(resolvedPath)}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`
    );

    try {
      fs.writeFileSync(tempFile, result.patchedSource, 'utf8');
      fs.renameSync(tempFile, resolvedPath);
      sourceFile.refreshFromFileSystemSync();
      return result;
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

  // ---------------------------------------------------------------------------
  // Execution Handlers
  // ---------------------------------------------------------------------------

  private executeReplaceTimeout(
    sourceFile: import('ts-morph').SourceFile,
    plan: ReplaceTimeoutPlan
  ): { originalStatement: string; replacementStatement: string } {
    const candidateStatements = this.findStatements(sourceFile, plan.targetLine, (stmt) => {
      const text = stmt.getText();
      return text.includes('waitForTimeout');
    });

    if (candidateStatements.length === 0) {
      throw new AbstentionError(
        plan.targetLine
          ? `No waitForTimeout statement found at line ${plan.targetLine}`
          : 'No waitForTimeout statement found in source file',
        'AST_STATEMENT_NOT_FOUND'
      );
    }

    const targetStatement = candidateStatements[0]!;
    this.assertNotAssertion(targetStatement);

    const originalStatement = targetStatement.getText();
    const replacement = plan.replacementWaitStatement.trim().endsWith(';')
      ? plan.replacementWaitStatement.trim()
      : `${plan.replacementWaitStatement.trim()};`;

    targetStatement.replaceWithText(replacement);

    return {
      originalStatement,
      replacementStatement: replacement,
    };
  }

  private executeWrapActionWithResponse(
    sourceFile: import('ts-morph').SourceFile,
    plan: WrapActionWithResponsePlan
  ): { originalStatement: string; replacementStatement: string } {
    const candidateStatements = this.findStatements(sourceFile, plan.targetLine, (stmt) => {
      const text = stmt.getText();
      if (plan.targetActionSubstring) {
        return text.includes(plan.targetActionSubstring);
      }
      return (
        text.includes('.click(') ||
        text.includes('.fill(') ||
        text.includes('.press(') ||
        text.includes('.selectOption(') ||
        text.includes('.check(')
      );
    });

    if (candidateStatements.length === 0) {
      throw new AbstentionError(
        plan.targetLine
          ? `No action statement found at line ${plan.targetLine}`
          : `No action statement matching '${plan.targetActionSubstring ?? 'click/fill'}' found`,
        'AST_STATEMENT_NOT_FOUND'
      );
    }

    const targetStatement = candidateStatements[0]!;
    this.assertNotAssertion(targetStatement);

    const originalStatement = targetStatement.getText();

    // Extract bare expression without leading await and trailing semicolon
    let bareAction = originalStatement.trim();
    if (bareAction.startsWith('await ')) {
      bareAction = bareAction.substring(6).trim();
    }
    if (bareAction.endsWith(';')) {
      bareAction = bareAction.substring(0, bareAction.length - 1).trim();
    }

    // Auto-detect page variable
    let pageVar = plan.pageVarName ?? 'page';
    if (!plan.pageVarName) {
      const pageMatch = bareAction.match(/(\b\w*[pP]age\w*)\./);
      if (pageMatch && pageMatch[1]) {
        pageVar = pageMatch[1];
      }
    }

    const timeoutArg = plan.timeoutMs ? `, { timeout: ${plan.timeoutMs} }` : '';
    const replacementStatement = `await Promise.all([\n  ${pageVar}.waitForResponse(${plan.responsePredicate}${timeoutArg}),\n  ${bareAction},\n]);`;

    targetStatement.replaceWithText(replacementStatement);

    return {
      originalStatement,
      replacementStatement,
    };
  }

  private executeInsertReadinessCheck(
    sourceFile: import('ts-morph').SourceFile,
    plan: InsertReadinessCheckPlan
  ): { originalStatement: string; replacementStatement: string } {
    const candidateStatements = this.findStatements(sourceFile, plan.targetLine, (stmt) => {
      const text = stmt.getText();
      if (plan.targetActionSubstring) {
        return text.includes(plan.targetActionSubstring);
      }
      return text.includes('.click(') || text.includes('.fill(');
    });

    if (candidateStatements.length === 0) {
      throw new AbstentionError(
        plan.targetLine
          ? `No statement found at line ${plan.targetLine}`
          : `No statement matching '${plan.targetActionSubstring ?? 'click/fill'}' found`,
        'AST_STATEMENT_NOT_FOUND'
      );
    }

    const targetStatement = candidateStatements[0]!;
    this.assertNotAssertion(targetStatement);

    const originalStatement = targetStatement.getText();
    const parent = targetStatement.getParent();

    const readinessCode = plan.readinessStatement.trim().endsWith(';')
      ? plan.readinessStatement.trim()
      : `${plan.readinessStatement.trim()};`;

    if (Node.isBlock(parent)) {
      const index = targetStatement.getChildIndex();
      parent.insertStatements(index, readinessCode);
    } else {
      // Fallback: replace target statement with readiness + target
      targetStatement.replaceWithText(`${readinessCode}\n${originalStatement}`);
    }

    return {
      originalStatement,
      replacementStatement: `${readinessCode}\n${originalStatement}`,
    };
  }

  private executeReplaceInlineLocator(
    sourceFile: import('ts-morph').SourceFile,
    plan: ReplaceInlineLocatorPlan
  ): { originalStatement: string; replacementStatement: string } {
    const candidateStatements = this.findStatements(sourceFile, plan.targetLine, (stmt) => {
      return stmt.getText().includes(plan.oldLocatorText);
    });

    if (candidateStatements.length === 0) {
      throw new AbstentionError(
        `Old locator '${plan.oldLocatorText}' not found in source AST`,
        'AST_LOCATOR_NOT_FOUND'
      );
    }

    const targetStatement = candidateStatements[0]!;
    this.assertNotAssertion(targetStatement);

    const originalStatement = targetStatement.getText();
    const patchedStatementText = originalStatement.replace(plan.oldLocatorText, plan.newLocatorExpression);

    if (patchedStatementText === originalStatement) {
      throw new AbstentionError(
        `Failed to replace '${plan.oldLocatorText}' with '${plan.newLocatorExpression}'`,
        'AST_REPLACEMENT_FAILED'
      );
    }

    targetStatement.replaceWithText(patchedStatementText);

    return {
      originalStatement,
      replacementStatement: patchedStatementText,
    };
  }

  private executeReplaceStatement(
    sourceFile: import('ts-morph').SourceFile,
    plan: ReplaceStatementPlan
  ): { originalStatement: string; replacementStatement: string } {
    const candidateStatements = this.findStatements(sourceFile, plan.targetLine, (stmt) => {
      if (plan.targetSubstring) {
        return stmt.getText().includes(plan.targetSubstring);
      }
      return true;
    });

    if (candidateStatements.length === 0) {
      throw new AbstentionError(
        plan.targetLine
          ? `No statement found at line ${plan.targetLine}`
          : `No statement matching '${plan.targetSubstring}' found`,
        'AST_STATEMENT_NOT_FOUND'
      );
    }

    const targetStatement = candidateStatements[0]!;
    this.assertNotAssertion(targetStatement);

    const originalStatement = targetStatement.getText();
    const replacement = plan.newStatement.trim().endsWith(';')
      ? plan.newStatement.trim()
      : `${plan.newStatement.trim()};`;

    targetStatement.replaceWithText(replacement);

    return {
      originalStatement,
      replacementStatement: replacement,
    };
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  private findStatements(
    sourceFile: import('ts-morph').SourceFile,
    targetLine?: number,
    predicate?: (stmt: Statement) => boolean
  ): Statement[] {
    const statements: Statement[] = [];

    // Traverse all expression statements and variable statements in tests/blocks
    const allStatements = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ExpressionStatement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.VariableStatement),
    ];

    for (const stmt of allStatements) {
      // Exclude outer test wrapper calls (e.g. test('...', () => { ... }))
      if (Node.isExpressionStatement(stmt)) {
        const expr = stmt.getExpression();
        if (Node.isCallExpression(expr)) {
          const callText = expr.getExpression().getText();
          if (
            callText === 'test' ||
            callText === 'test.describe' ||
            callText === 'test.step' ||
            callText === 'describe' ||
            callText === 'it'
          ) {
            continue;
          }
        }
      }

      if (targetLine !== undefined) {
        const startLine = stmt.getStartLineNumber();
        const endLine = stmt.getEndLineNumber();
        if (targetLine < startLine || targetLine > endLine) {
          continue;
        }
      }

      if (predicate && !predicate(stmt)) {
        continue;
      }

      statements.push(stmt);
    }

    return statements;
  }

  private assertNotAssertion(stmt: Statement): void {
    const trimmed = stmt.getText().trim();
    // Guard against removing or tampering with expect assertions
    if (trimmed.startsWith('expect(') || trimmed.startsWith('await expect(')) {
      throw new AbstentionError(
        'Modifying or removing test assertions via StatementPatcher is strictly prohibited',
        'AST_ASSERTION_TAMPERING_PROHIBITED'
      );
    }
  }

  private ensurePlaywrightExpectImport(sourceFile: import('ts-morph').SourceFile): boolean {
    const importDecls = sourceFile.getImportDeclarations();
    const pwImport = importDecls.find((decl) => {
      const spec = decl.getModuleSpecifierValue();
      return spec === '@playwright/test';
    });

    if (pwImport) {
      const namedImports = pwImport.getNamedImports().map((i) => i.getName());
      if (!namedImports.includes('expect')) {
        pwImport.addNamedImport('expect');
        return true;
      }
      return false;
    }

    // No @playwright/test import found; add one at the top of the file
    sourceFile.insertImportDeclaration(0, {
      moduleSpecifier: '@playwright/test',
      namedImports: ['expect'],
    });
    return true;
  }
}
