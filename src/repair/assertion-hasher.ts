import { Project, Node, CallExpression } from 'ts-morph';
import crypto from 'node:crypto';

export interface CompositeIntentFingerprint {
  assertionFingerprint: string;
  testBodyFingerprint: string;
  fixtureFingerprint: string;
  compositeHash: string;
}

export class AssertionHasher {
  /**
   * Computes a canonical, whitespace-and-formatting-insensitive SHA-256 hash of all expect() assertions.
   * Ensures that code repairs never mutate, delete, or weaken test assertions.
   * Preserves exact whitespace and characters inside string literals.
   */
  public static computeFingerprint(testFilePath: string): string {
    return AssertionHasher.computeAssertionFingerprint(testFilePath);
  }

  /**
   * Computes SHA-256 of all assertion expressions in the file.
   * Identifies assertions semantically (calls to expect(), expect.soft(), expect.poll()).
   * Preserves exact string literal contents and argument ordering.
   */
  public static computeAssertionFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const assertionRecords: any[] = [];
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        if (AssertionHasher.isAssertionCall(node)) {
          assertionRecords.push(AssertionHasher.canonicalizeAssertion(node));
        }
      }
    });

    const canonicalString = JSON.stringify(assertionRecords);
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  /**
   * Semantically identifies whether a CallExpression is an assertion API call.
   */
  public static isAssertionCall(callExpr: CallExpression): boolean {
    const exprText = callExpr.getExpression().getText();
    // Matches expect(...), expect.soft(...), expect.poll(...)
    if (/^expect(\.soft|\.poll)?$/.test(exprText)) {
      return true;
    }
    // Matches chained matchers like expect(...).toBe(...) or await expect(...).toHaveText(...)
    if (Node.isPropertyAccessExpression(callExpr.getExpression())) {
      const propAccess = callExpr.getExpression();
      const rootText = propAccess.getText();
      if (rootText.startsWith('expect(') || rootText.startsWith('expect.soft(') || rootText.startsWith('expect.poll(')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Computes SHA-256 structural fingerprint of test body statements, control flow, conditions and operators.
   * Ensures statement sequence, logical operators, condition expressions, and argument structure remain invariant.
   */
  public static computeTestBodyFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const structuralTokens: any[] = [];

    sourceFile.forEachDescendant((node) => {
      // 1. Control flow statements
      if (
        Node.isIfStatement(node) ||
        Node.isForStatement(node) ||
        Node.isForOfStatement(node) ||
        Node.isForInStatement(node) ||
        Node.isWhileStatement(node) ||
        Node.isDoStatement(node) ||
        Node.isTryStatement(node) ||
        Node.isSwitchStatement(node) ||
        Node.isReturnStatement(node)
      ) {
        const conditionText = Node.isIfStatement(node) || Node.isWhileStatement(node)
          ? node.getExpression().getText().trim()
          : '';
        structuralTokens.push({
          kind: node.getKindName(),
          childCount: node.getChildCount(),
          condition: conditionText,
        });
      }
      // 2. Expression statements & binary/unary expressions (captures operators like !user.isActive vs user.isActive)
      else if (Node.isBinaryExpression(node)) {
        structuralTokens.push({
          kind: 'BinaryExpression',
          operator: node.getOperatorToken().getText(),
          left: node.getLeft().getText().trim(),
          right: node.getRight().getText().trim(),
        });
      } else if (Node.isPrefixUnaryExpression(node)) {
        structuralTokens.push({
          kind: 'PrefixUnaryExpression',
          operator: node.getOperatorToken(),
          operand: node.getOperand().getText().trim(),
        });
      }
      // 3. Call expressions (non-assertion calls)
      else if (Node.isCallExpression(node)) {
        if (!AssertionHasher.isAssertionCall(node)) {
          structuralTokens.push({
            kind: 'CallExpression',
            expr: node.getExpression().getText().trim(),
            argCount: node.getArguments().length,
          });
        }
      }
    });

    const canonical = JSON.stringify(structuralTokens);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Computes SHA-256 of test fixtures, parameters, and input literals.
   * Preserves exact ordering and associations (e.g. object property key-value pairs).
   * Does NOT sort away key-value associations.
   */
  public static computeFixtureFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const fixtureTokens: string[] = [];

    sourceFile.forEachDescendant((node) => {
      // 1. Property assignments: key + value preserved together (e.g. username: 'admin')
      if (Node.isPropertyAssignment(node)) {
        const key = node.getName();
        const initializer = node.getInitializer();
        const value = initializer ? initializer.getText() : '';
        fixtureTokens.push(`Prop:${key}=${value}`);
      }
      // 2. Standalone literals not inside property assignment
      else if (
        (Node.isStringLiteral(node) ||
          Node.isNumericLiteral(node) ||
          Node.isTrueLiteral(node) ||
          Node.isFalseLiteral(node)) &&
        !Node.isPropertyAssignment(node.getParent())
      ) {
        fixtureTokens.push(`Literal:${node.getKindName()}:${node.getText()}`);
      }
    });

    // Sequence preserved (do not sort, to capture reordering of data properties)
    const canonical = fixtureTokens.join(';;');
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Computes full composite intent fingerprint combining assertions, test structure, and fixtures.
   */
  public static computeCompositeFingerprint(testFilePath: string): CompositeIntentFingerprint {
    const assertionFingerprint = AssertionHasher.computeAssertionFingerprint(testFilePath);
    const testBodyFingerprint = AssertionHasher.computeTestBodyFingerprint(testFilePath);
    const fixtureFingerprint = AssertionHasher.computeFixtureFingerprint(testFilePath);

    const compositeHash = crypto
      .createHash('sha256')
      .update(`${assertionFingerprint}:${testBodyFingerprint}:${fixtureFingerprint}`)
      .digest('hex');

    return {
      assertionFingerprint,
      testBodyFingerprint,
      fixtureFingerprint,
      compositeHash,
    };
  }

  /**
   * Canonicalizes an assertion node while strictly preserving string literals exactly.
   */
  private static canonicalizeAssertion(callExpr: CallExpression): any {
    // Normalizes formatting whitespace around tokens WITHOUT modifying string literal contents
    const normalizeExpression = (str: string) =>
      str.replace(/\s+/g, ' ').replace(/\s*([().,{}:])\s*/g, '$1').trim();

    return {
      kind: callExpr.getKindName(),
      expression: normalizeExpression(callExpr.getExpression().getText()),
      arguments: callExpr.getArguments().map((arg) => {
        if (Node.isStringLiteral(arg)) {
          // Preserve EXACT text and whitespace inside string literals
          return {
            kind: 'StringLiteral',
            value: arg.getLiteralValue(),
          };
        }
        return {
          kind: arg.getKindName(),
          text: normalizeExpression(arg.getText()),
        };
      }),
      typeArguments: callExpr.getTypeArguments().map((t) => normalizeExpression(t.getText())),
    };
  }
}
