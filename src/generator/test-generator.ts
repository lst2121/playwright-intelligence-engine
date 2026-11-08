import { planArchitecture, toClassName } from './architecture-generator.js';

export interface GeneratedStep {
  action: 'click' | 'fill' | 'press' | 'navigate' | 'assert-visible' | 'assert-text' | 'assert-count' | 'assert-value';
  role?: string | undefined;
  name?: string | undefined;
  selector?: string | undefined;
  value?: string | undefined;
  placeholder?: string | undefined;
  expectedText?: string | undefined;
  expectedCount?: number | undefined;
  expectedValue?: string | undefined;
  frame?: string | undefined;
  frameSelector?: string | undefined;
}

export interface GeneratedSuiteOutput {
  pageObjectName: string;
  pageObjectCode: string;
  specCode: string;
}

export class TestGenerator {
  /**
   * Generates production-grade TypeScript Playwright Page Object and Spec code adhering to enterprise standards.
   * Delegates to ArchitectureGenerator to guarantee single source of truth and semantic naming.
   */
  public static generateSuite(
    featureName: string,
    steps: GeneratedStep[],
    baseUrl = 'https://example.com'
  ): GeneratedSuiteOutput {
    const rawClassName = toClassName(featureName);
    const className = rawClassName.endsWith('Page') ? rawClassName : `${rawClassName}Page`;

    const plan = planArchitecture({
      featureName,
      mode: 'greenfield',
      baseUrl,
      steps,
    });

    const pageFile = plan.files.find((f) => f.relativePath.endsWith('Page.ts'));
    const specFile = plan.files.find((f) => f.relativePath.endsWith('.spec.ts'));

    return {
      pageObjectName: className,
      pageObjectCode: pageFile?.content ?? '',
      specCode: specFile?.content ?? '',
    };
  }
}
