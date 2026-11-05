import { LocatorPlan, CandidateExtractor } from './candidate-extractor.js';

export interface LiveVerificationResult {
  isUnique: boolean;
  count: number;
  isVisible: boolean;
  isEnabled: boolean;
  plan: LocatorPlan;
  expression: string;
  reason?: string;
}

/**
 * Safely resolves typed LocatorPlan instances to live Playwright Locator objects
 * and empirically tests count(), isVisible(), and isEnabled() against the live browser DOM.
 * Strictly enforces that count() === 1 for uniqueness (AUDIT-13).
 */
export class LiveLocatorVerifier {
  public static locate(pageOrFrame: any, plan: LocatorPlan): any {
    return LiveLocatorVerifier.resolveLocator(pageOrFrame, plan);
  }

  /**
   * Dispatches typed LocatorPlan to official Playwright Page/Frame API methods.
   * Completely avoids eval or arbitrary code execution.
   */
  public static resolveLocator(pageOrFrame: any, plan: LocatorPlan): any {
    if (!pageOrFrame) {
      throw new Error('Cannot resolve locator: pageOrFrame instance is null or undefined.');
    }

    switch (plan.kind) {
      case 'getByRole': {
        const role = plan.role;
        const options: Record<string, any> = {};
        if (plan.options?.name) options.name = plan.options.name;
        if (plan.options?.exact !== undefined) options.exact = plan.options.exact;
        return typeof pageOrFrame.getByRole === 'function'
          ? pageOrFrame.getByRole(role, options)
          : pageOrFrame.locator(`role=${role}`);
      }
      case 'getByTestId': {
        return typeof pageOrFrame.getByTestId === 'function'
          ? pageOrFrame.getByTestId(plan.testId)
          : pageOrFrame.locator(`[data-testid="${plan.testId}"]`);
      }
      case 'getByLabel': {
        return typeof pageOrFrame.getByLabel === 'function'
          ? pageOrFrame.getByLabel(plan.label, plan.options)
          : pageOrFrame.locator(`label:has-text("${plan.label}")`);
      }
      case 'getByPlaceholder': {
        return typeof pageOrFrame.getByPlaceholder === 'function'
          ? pageOrFrame.getByPlaceholder(plan.placeholder, plan.options)
          : pageOrFrame.locator(`[placeholder="${plan.placeholder}"]`);
      }
      case 'getByText': {
        return typeof pageOrFrame.getByText === 'function'
          ? pageOrFrame.getByText(plan.text, plan.options)
          : pageOrFrame.locator(`text="${plan.text}"`);
      }
      case 'locator': {
        return pageOrFrame.locator(plan.selector);
      }
    }
  }

  /**
   * Empirically checks locator uniqueness (count === 1) and actionability in the live DOM.
   */
  public static async verify(pageOrFrame: any, plan: LocatorPlan): Promise<LiveVerificationResult> {
    const expression = CandidateExtractor.planToExpression(plan);

    try {
      const loc = LiveLocatorVerifier.resolveLocator(pageOrFrame, plan);
      if (!loc || typeof loc.count !== 'function') {
        return {
          isUnique: false,
          count: 0,
          isVisible: false,
          isEnabled: false,
          plan,
          expression,
          reason: 'Target Page/Frame does not support Playwright locator count() API.',
        };
      }

      const count = await loc.count();

      if (count === 0) {
        return {
          isUnique: false,
          count: 0,
          isVisible: false,
          isEnabled: false,
          plan,
          expression,
          reason: `Locator matched 0 elements in the live browser DOM.`,
        };
      }

      if (count > 1) {
        return {
          isUnique: false,
          count,
          isVisible: false,
          isEnabled: false,
          plan,
          expression,
          reason: `Strict Mode / Uniqueness Violation: Locator matched ${count} elements in DOM. Strict uniqueness requires exactly 1 match.`,
        };
      }

      // Exactly 1 match in DOM
      const first = loc.first ? loc.first() : loc;
      const isVisible = typeof first.isVisible === 'function' ? await first.isVisible().catch(() => false) : true;
      const isEnabled = typeof first.isEnabled === 'function' ? await first.isEnabled().catch(() => true) : true;

      return {
        isUnique: true,
        count: 1,
        isVisible,
        isEnabled,
        plan,
        expression,
      };
    } catch (err: any) {
      return {
        isUnique: false,
        count: 0,
        isVisible: false,
        isEnabled: false,
        plan,
        expression,
        reason: `Live verification error: ${err.message ?? String(err)}`,
      };
    }
  }
}
