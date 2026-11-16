import { Project, SyntaxKind } from 'ts-morph';

/**
 * AST Fixture Composer for Playwright Intelligence Engine (PIE).
 *
 * Uses ts-morph to safely and idempotently compose Page Objects into existing
 * Playwright fixture files (e.g. `tests/fixtures/test.ts` or `app.fixtures.ts`).
 *
 * Guarantees idiomatic Playwright parameter injection:
 * `test('workflow', async ({ userLoginPage, page }) => { ... });`
 * eliminating fallback inline `new Page(page)` instantiations.
 */
export function composeFixtureAst(
  existingContent: string,
  pageClassName: string,
  pageVar: string,
  pomImportPath: string
): string {
  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('fixture.ts', existingContent);

    // 1. Ensure import of the Page Object
    const existingImports = sourceFile.getImportDeclarations();
    const hasImport = existingImports.some((decl) =>
      decl.getNamedImports().some((exp) => exp.getName() === pageClassName)
    );

    if (!hasImport) {
      // Find the last import declaration to place the new import neatly
      const lastImport = existingImports[existingImports.length - 1];
      const importStructure = {
        namedImports: [pageClassName],
        moduleSpecifier: pomImportPath,
      };

      if (lastImport) {
        sourceFile.insertImportDeclaration(lastImport.getChildIndex() + 1, importStructure);
      } else {
        sourceFile.addImportDeclaration(importStructure);
      }
    }

    // 2. Find and update the Fixture Type definition (type or interface)
    const typeAlias = sourceFile.getTypeAliases().find((t) => /fixtures?$/i.test(t.getName()));
    const iface = sourceFile.getInterfaces().find((i) => /fixtures?$/i.test(i.getName()));

    if (typeAlias) {
      const typeNode = typeAlias.getTypeNode();
      if (typeNode && typeNode.getKind() === SyntaxKind.TypeLiteral) {
        const typeLiteral = typeNode.asKind(SyntaxKind.TypeLiteral);
        const hasProp = typeLiteral?.getProperties().some((p) => p.getName() === pageVar);
        if (!hasProp && typeLiteral) {
          typeLiteral.addProperty({
            name: pageVar,
            type: pageClassName,
          });
        }
      }
    } else if (iface) {
      const hasProp = iface.getProperties().some((p) => p.getName() === pageVar);
      if (!hasProp) {
        iface.addProperty({
          name: pageVar,
          type: pageClassName,
        });
      }
    } else {
      // Check if base.extend<{ ... }> has an inline type literal
      const extendCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
        const exprText = c.getExpression().getText();
        return exprText.endsWith('.extend');
      });
      const targetExtendCall = extendCalls[0];
      const typeArgs = targetExtendCall?.getTypeArguments() ?? [];
      const inlineTypeLiteral = typeArgs.find((ta) => ta.getKind() === SyntaxKind.TypeLiteral)?.asKind(SyntaxKind.TypeLiteral);

      if (inlineTypeLiteral) {
        const hasProp = inlineTypeLiteral.getProperties().some((p) => p.getName() === pageVar);
        if (!hasProp) {
          inlineTypeLiteral.addProperty({
            name: pageVar,
            type: pageClassName,
          });
        }
      } else {
        // Create AppFixtures if none existed
        sourceFile.addTypeAlias({
          name: `${pageClassName}Fixtures`,
          type: `{\n  ${pageVar}: ${pageClassName};\n}`,
        });
      }
    }

    // 3. Find base.extend / test.extend call and add the fixture setup
    const extendCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      const exprText = c.getExpression().getText();
      return exprText.endsWith('.extend');
    });

    const targetExtendCall = extendCalls[0];
    if (targetExtendCall) {
      const args = targetExtendCall.getArguments();
      const objArg = args.find((a) => a.getKind() === SyntaxKind.ObjectLiteralExpression)?.asKind(SyntaxKind.ObjectLiteralExpression);

      if (objArg) {
        const hasFixtureDef = objArg.getProperties().some((p) => {
          const name = p.asKind(SyntaxKind.PropertyAssignment)?.getName();
          return name === pageVar;
        });

        if (!hasFixtureDef) {
          objArg.addPropertyAssignment({
            name: pageVar,
            initializer: `async ({ page }, use) => {\n    const ${pageVar} = new ${pageClassName}(page);\n    await ${pageVar}.goto();\n    await use(${pageVar});\n  }`,
          });
        }
      }
    }

    return sourceFile.getFullText();
  } catch (err) {
    // Graceful regex-based fallback if AST encountered unexpected syntax
    return composeFixtureFallback(existingContent, pageClassName, pageVar, pomImportPath);
  }
}

/**
 * Robust regex-based fallback for fixture composition if AST encounters atypical syntax.
 */
function composeFixtureFallback(
  existingContent: string,
  pageClassName: string,
  pageVar: string,
  pomImportPath: string
): string {
  if (existingContent.includes(` ${pageVar}:`) || existingContent.includes(`'${pageVar}':`)) {
    return existingContent; // Already registered
  }

  let updated = existingContent;

  // Add import if missing
  if (!updated.includes(pageClassName)) {
    const importStmt = `import { ${pageClassName} } from ${JSON.stringify(pomImportPath)};\n`;
    const lastImportIndex = updated.lastIndexOf('import ');
    if (lastImportIndex !== -1) {
      const endOfLastImport = updated.indexOf('\n', lastImportIndex);
      updated = updated.slice(0, endOfLastImport + 1) + importStmt + updated.slice(endOfLastImport + 1);
    } else {
      updated = importStmt + updated;
    }
  }

  // Update type MyFixtures = { ... }
  const typeMatch = updated.match(/(type\s+\w+Fixtures\s*=\s*\{)([^}]*?)(\};?)/s);
  if (typeMatch && !typeMatch[2]?.includes(`${pageVar}:`)) {
    const newProps = `${typeMatch[2]?.trimEnd()}\n  ${pageVar}: ${pageClassName};\n`;
    updated = updated.replace(typeMatch[0], `${typeMatch[1]}${newProps}${typeMatch[3]}`);
  }

  // Update base.extend({ ... })
  const extendMatch = updated.match(/(\.extend(?:<[^>]*>)?\s*\(\s*\{)([\s\S]*?)(\}\s*\))/);
  if (extendMatch && !extendMatch[2]?.includes(`${pageVar}:`)) {
    const fixtureDef = `\n  ${pageVar}: async ({ page }, use) => {\n    const ${pageVar} = new ${pageClassName}(page);\n    await ${pageVar}.goto();\n    await use(${pageVar});\n  },\n`;
    const newBody = `${extendMatch[2]?.trimEnd()}${fixtureDef}`;
    updated = updated.replace(extendMatch[0], `${extendMatch[1]}${newBody}${extendMatch[3]}`);
  }

  return updated;
}
