import { Project, Node, CallExpression } from 'ts-morph';
import crypto from 'node:crypto';

export class AssertionHasher {
  /**
   * Computes a canonical, whitespace-and-formatting-insensitive SHA-256 hash of all expect() assertions.
   * Ensures that code repairs never mutate, delete, or weaken test assertions.
   */
  public static computeFingerprint(testFilePath: string): string {
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

    const canonicalString = JSON.stringify(
      expectNodes,
      Object.keys(expectNodes).sort()
    );

    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  private static canonicalizeAssertion(callExpr: CallExpression): any {
    return {
      kind: callExpr.getKindName(),
      expression: callExpr.getExpression().getText().trim(),
      arguments: callExpr.getArguments().map((arg) => ({
        kind: arg.getKindName(),
        text: arg.getText().trim(),
      })),
      typeArguments: callExpr.getTypeArguments().map((t) => t.getText().trim()),
    };
  }
}

