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
   */
  public static computeFingerprint(testFilePath: string): string {
    return AssertionHasher.computeAssertionFingerprint(testFilePath);
  }

  /**
   * Computes SHA-256 of all assertion expressions in the file.
   */
  public static computeAssertionFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const expectNodes: any[] = [];
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const text = node.getExpression().getText();
        if (text.includes('expect')) {
          expectNodes.push(AssertionHasher.canonicalizeAssertion(node));
        }
      }
    });

    const canonicalString = JSON.stringify(expectNodes);
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  /**
   * Computes SHA-256 structural fingerprint of test body statements and control flow.
   * Ensures test execution order, logic branching, and statement sequence remain invariant.
   */
  public static computeTestBodyFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const structuralTokens: any[] = [];

    sourceFile.forEachDescendant((node) => {
      // Record statement sequences and call expressions
      if (
        Node.isExpressionStatement(node) ||
        Node.isIfStatement(node) ||
        Node.isForStatement(node) ||
        Node.isForOfStatement(node) ||
        Node.isWhileStatement(node) ||
        Node.isTryStatement(node)
      ) {
        structuralTokens.push({
          kind: node.getKindName(),
          childCount: node.getChildCount(),
        });
      } else if (Node.isCallExpression(node)) {
        structuralTokens.push({
          kind: 'CallExpression',
          expr: node.getExpression().getText().trim(),
        });
      }
    });

    const canonical = JSON.stringify(structuralTokens);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Computes SHA-256 of test fixtures, parameters, and input literals.
   * Guarantees test data and execution preconditions are preserved.
   */
  public static computeFixtureFingerprint(testFilePath: string): string {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(testFilePath);

    const fixtureTokens: string[] = [];

    sourceFile.forEachDescendant((node) => {
      if (
        Node.isStringLiteral(node) ||
        Node.isNumericLiteral(node) ||
        Node.isTrueLiteral(node) ||
        Node.isFalseLiteral(node)
      ) {
        fixtureTokens.push(`${node.getKindName()}:${node.getText().trim()}`);
      }
    });

    const canonical = fixtureTokens.sort().join('|');
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

  private static canonicalizeAssertion(callExpr: CallExpression): any {
    const normalize = (str: string) =>
      str.replace(/\s+/g, ' ').replace(/\s*([().,{}:])\s*/g, '$1').trim();

    return {
      kind: callExpr.getKindName(),
      expression: normalize(callExpr.getExpression().getText()),
      arguments: callExpr.getArguments().map((arg) => ({
        kind: arg.getKindName(),
        text: normalize(arg.getText()),
      })),
      typeArguments: callExpr.getTypeArguments().map((t) => normalize(t.getText())),
    };
  }
}

