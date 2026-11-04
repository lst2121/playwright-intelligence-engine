export interface GeneratedStep {
  action: 'click' | 'fill' | 'navigate' | 'assert-visible' | 'assert-text';
  role?: string;
  name?: string;
  selector?: string;
  value?: string;
  expectedText?: string;
}

export interface GeneratedSuiteOutput {
  pageObjectName: string;
  pageObjectCode: string;
  specCode: string;
}

export class TestGenerator {
  /**
   * Generates production-grade TypeScript Playwright Page Object and Spec code adhering to enterprise standards.
   */
  public static generateSuite(
    featureName: string,
    steps: GeneratedStep[],
    baseUrl = 'https://example.com'
  ): GeneratedSuiteOutput {
    const className = `${featureName.replace(/[^a-zA-Z0-9]/g, '')}Page`;
    const specFileName = `${featureName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.spec.ts`;

    // Generate Page Object locators and actions
    const locatorDeclarations: string[] = [];
    const actionMethods: string[] = [];

    steps.forEach((step, idx) => {
      if (step.action === 'click') {
        const propName = `actionButton${idx + 1}`;
        const loc = step.role && step.name
          ? `this.page.getByRole('${step.role}', { name: '${step.name}' })`
          : `this.page.locator('${step.selector ?? 'button'}')`;

        locatorDeclarations.push(`  readonly ${propName} = ${loc};`);
        actionMethods.push(`  async click${idx + 1}(): Promise<void> {\n    await this.${propName}.click();\n  }`);
      } else if (step.action === 'fill') {
        const propName = `inputField${idx + 1}`;
        const loc = step.name
          ? `this.page.getByRole('textbox', { name: '${step.name}' })`
          : `this.page.locator('${step.selector ?? 'input'}')`;

        locatorDeclarations.push(`  readonly ${propName} = ${loc};`);
        actionMethods.push(`  async fill${idx + 1}(val: string): Promise<void> {\n    await this.${propName}.fill(val);\n  }`);
      }
    });

    const pageObjectCode = `import { Page, Locator } from '@playwright/test';

export class ${className} {
  readonly page: Page;

${locatorDeclarations.join('\n')}

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('${baseUrl}');
  }

${actionMethods.join('\n\n')}
}
`;

    // Generate Spec code with web-first assertions
    const specCode = `import { test, expect } from '@playwright/test';
import { ${className} } from './${className}.js';

test.describe('${featureName} Workflow', () => {
  test('should execute ${featureName} successfully', async ({ page }) => {
    const ${className.toLowerCase()} = new ${className}(page);
    await ${className.toLowerCase()}.goto();

    // Verification-first execution steps
${steps
  .map((s, idx) => {
    if (s.action === 'click') {
      return `    await ${className.toLowerCase()}.click${idx + 1}();`;
    }
    if (s.action === 'fill') {
      return `    await ${className.toLowerCase()}.fill${idx + 1}('${s.value ?? 'test-data'}');`;
    }
    if (s.action === 'assert-visible') {
      return `    await expect(page.getByRole('${s.role ?? 'heading'}', { name: '${s.name ?? ''}' })).toBeVisible();`;
    }
    return '';
  })
  .filter(Boolean)
  .join('\n')}
  });
});
`;

    return {
      pageObjectName: className,
      pageObjectCode,
      specCode,
    };
  }
}
