import { Project, SyntaxKind } from 'ts-morph';
import * as fs from 'fs';
import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';

export interface StaticAstInput {
  targetFilePath: string;
  sourceContent?: string;
  executionId?: string;
}

export interface ExtractedLocatorAst {
  className: string | undefined;
  propertyName: string;
  method: string;
  selectorText: string;
  line: number;
  pattern: 'property-initializer' | 'getter' | 'constructor-assignment' | 'inline';
}

export interface ExtractedActionAst {
  action: string;
  line: number;
  text: string;
}

export interface ExtractedAssertionAst {
  assertion: string;
  line: number;
  text: string;
}

export class StaticAstCollector implements EvidenceCollector<StaticAstInput> {
  public readonly name = 'StaticAstCollector';
  public readonly source = 'static-ast' as const;

  public async collect(input: StaticAstInput): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const timestamp = Date.now();

    let content = input.sourceContent;
    if (!content && fs.existsSync(input.targetFilePath)) {
      content = fs.readFileSync(input.targetFilePath, 'utf-8');
    }

    if (!content) {
      return [
        {
          evidenceId: `ast-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          executionId,
          source: 'static-ast',
          timestamp,
          evidenceType: 'ast-analysis',
          payload: {
            filePath: input.targetFilePath,
            error: 'File does not exist or empty content',
            locators: [],
            actions: [],
            assertions: [],
            imports: [],
            isPageObject: false,
            isSpec: false,
          },
          reliability: 'LOW',
          provenance: {
            collector: this.name,
            collectedAt: timestamp,
            captureMethod: 'ts-morph-ast-inspection',
            sourceUri: input.targetFilePath,
          },
          redactionStatus: { isRedacted: false },
        },
      ];
    }

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(input.targetFilePath, content);

    const locators: ExtractedLocatorAst[] = [];
    const actions: ExtractedActionAst[] = [];
    const assertions: ExtractedAssertionAst[] = [];
    const imports: string[] = [];

    // Check imports
    for (const imp of sourceFile.getImportDeclarations()) {
      imports.push(imp.getModuleSpecifierValue());
    }

    const classes = sourceFile.getClasses();
    const isPageObject = classes.length > 0;
    const isSpec = input.targetFilePath.includes('.spec.') || input.targetFilePath.includes('.test.');

    // 1. Inspect Classes for Page Object locators
    for (const cls of classes) {
      // Property initializers
      for (const prop of cls.getProperties()) {
        const init = prop.getInitializer();
        if (init && (init.getText().includes('.locator(') || init.getText().includes('.getBy'))) {
          locators.push({
            className: cls.getName(),
            propertyName: prop.getName(),
            method: this.extractLocatorMethod(init.getText()),
            selectorText: init.getText(),
            line: prop.getStartLineNumber(),
            pattern: 'property-initializer',
          });
        }
      }

      // Getters
      for (const getProp of cls.getGetAccessors()) {
        const returnStmt = getProp.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
        if (returnStmt) {
          const expr = returnStmt.getExpression();
          if (expr && (expr.getText().includes('.locator(') || expr.getText().includes('.getBy'))) {
            locators.push({
              className: cls.getName(),
              propertyName: getProp.getName(),
              method: this.extractLocatorMethod(expr.getText()),
              selectorText: expr.getText(),
              line: getProp.getStartLineNumber(),
              pattern: 'getter',
            });
          }
        }
      }

      // Constructor assignments
      for (const ctor of cls.getConstructors()) {
        for (const stmt of ctor.getStatements()) {
          const text = stmt.getText();
          if (text.startsWith('this.') && (text.includes('.locator(') || text.includes('.getBy'))) {
            const parts = text.split('=');
            const propName = (parts[0] ?? '').replace('this.', '').trim();
            locators.push({
              className: cls.getName(),
              propertyName: propName,
              method: this.extractLocatorMethod(text),
              selectorText: text,
              line: stmt.getStartLineNumber(),
              pattern: 'constructor-assignment',
            });
          }
        }
      }
    }

    // 2. Inspect CallExpressions for test actions and assertions (only inline calls outside class members)
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const exprText = expr.getText();

      // Inline locators (page.locator(...)) - only record if not already part of a class member
      const isInsideClass = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      if (!isInsideClass && (exprText.endsWith('.locator') || exprText.includes('.getBy'))) {
        locators.push({
          className: undefined,
          propertyName: 'inline',
          method: this.extractLocatorMethod(call.getText()),
          selectorText: call.getText(),
          line: call.getStartLineNumber(),
          pattern: 'inline',
        });
      }

      // Actions
      if (
        exprText.endsWith('.click') ||
        exprText.endsWith('.fill') ||
        exprText.endsWith('.press') ||
        exprText.endsWith('.type') ||
        exprText.endsWith('.check') ||
        exprText.endsWith('.selectOption') ||
        exprText.endsWith('.goto')
      ) {
        actions.push({
          action: exprText.split('.').pop() ?? 'action',
          line: call.getStartLineNumber(),
          text: call.getText(),
        });
      }

      // Assertions
      if (exprText.startsWith('expect(')) {
        assertions.push({
          assertion: call.getText(),
          line: call.getStartLineNumber(),
          text: call.getText(),
        });
      }
    }

    return [
      {
        evidenceId: `ast-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        executionId,
        source: 'static-ast',
        timestamp,
        evidenceType: 'ast-analysis',
        payload: {
          filePath: input.targetFilePath,
          isPageObject,
          isSpec,
          classesCount: classes.length,
          locators,
          actions,
          assertions,
          imports,
        },
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: timestamp,
          captureMethod: 'ts-morph-ast-inspection',
          sourceUri: input.targetFilePath,
        },
        redactionStatus: { isRedacted: false },
      },
    ];
  }

  private extractLocatorMethod(text: string): string {
    const match = text.match(/(locator|getByRole|getByText|getByTestId|getByLabel|getByPlaceholder|getByAltText|getByTitle)/);
    return match && match[1] ? match[1] : 'locator';
  }
}
