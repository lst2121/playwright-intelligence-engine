import { Project } from 'ts-morph';
import { ResolvedElement, SnapshotResolver } from '../trace/snapshot-resolver.js';
import { FailedAction } from '../core/types/diagnostic-context.js';
import { InsufficientIdentifiersError } from '../core/errors/engine-errors.js';

export type LocatorPlan =
  | {
      kind: 'getByRole';
      role: string;
      options?: {
        name?: string;
        exact?: boolean;
      };
    }
  | {
      kind: 'getByText';
      text: string;
      options?: {
        exact?: boolean;
      };
    }
  | {
      kind: 'getByLabel';
      label: string;
      options?: {
        exact?: boolean;
      };
    }
  | {
      kind: 'getByPlaceholder';
      placeholder: string;
      options?: {
        exact?: boolean;
      };
    }
  | {
      kind: 'getByTestId';
      testId: string;
    }
  | {
      kind: 'locator';
      selector: string;
    };

export class CandidateExtractor {
  /**
   * Safely escapes a string literal for embedding inside TypeScript single-quoted strings.
   * Handles backslashes, quotes, newlines, tabs, and unicode line separators.
   */
  public static escapeLocatorString(val: string): string {
    return val
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  /**
   * Discovers the page property identifier used in a Page Object class using AST analysis.
   * Inspects class property declarations, constructor parameters, and inheritance context.
   * Does NOT rely on loose substring search in comments or unrelated text.
   */
  public static discoverPageProperty(source?: string): string {
    if (!source || typeof source !== 'string' || source.trim().length === 0) {
      return 'this.page';
    }

    try {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile('temp-pom.ts', source);
      const classes = sourceFile.getClasses();

      for (const cls of classes) {
        // 1. Inspect class properties
        for (const prop of cls.getProperties()) {
          const name = prop.getName();
          const typeNode = prop.getTypeNode();
          const typeText = typeNode ? typeNode.getText() : '';

          if (name === '_page' || name === 'browserPage' || name === 'page') {
            return `this.${name}`;
          }
          if (typeText.includes('Page')) {
            return `this.${name}`;
          }
        }

        // 2. Inspect constructor parameter properties (e.g. constructor(protected _page: Page))
        const ctor = cls.getConstructors()[0];
        if (ctor) {
          for (const param of ctor.getParameters()) {
            const name = param.getName();
            const isProperty = param.hasScopeKeyword() || param.isReadonly();
            if (isProperty) {
              if (name === '_page' || name === 'browserPage' || name === 'page') {
                return `this.${name}`;
              }
            }
          }
        }
      }
    } catch {
      // Fallback to strict regex if ts-morph parsing encounters incomplete fragment
    }

    // Strict structural regex check (not plain substring in comments)
    if (/^\s*(?:readonly|private|protected|public)?\s*_page\s*[:=]/m.test(source)) {
      return 'this._page';
    }
    if (/^\s*(?:readonly|private|protected|public)?\s*browserPage\s*[:=]/m.test(source)) {
      return 'this.browserPage';
    }
    if (/^\s*(?:readonly|private|protected|public)?\s*page\s*[:=]/m.test(source)) {
      return 'this.page';
    }

    return 'this.page';
  }

  /**
   * Generates a strongly typed, safe LocatorPlan representing a Playwright locator intent.
   * Strictly refuses to generate bare tag fallbacks.
   */
  public static generateLocatorPlan(el: ResolvedElement): LocatorPlan {
    // Rule 1: Priority on ARIA role with accessible name (getByRole)
    if (el.role && el.accessibleName && el.accessibleName.trim().length > 0) {
      return {
        kind: 'getByRole',
        role: el.role,
        options: {
          name: el.accessibleName.trim(),
          exact: true,
        },
      };
    }

    // Rule 2: Dedicated Test ID attribute (getByTestId)
    const testId = el.attributes['data-testid'] ?? el.attributes['data-test'] ?? el.attributes['data-cy'];
    if (testId && testId.trim().length > 0) {
      return {
        kind: 'getByTestId',
        testId: testId.trim(),
      };
    }

    // Rule 3: Form label (getByLabel)
    const labelAttr =
      el.attributes['aria-label'] ??
      el.attributes['aria-labelledby'] ??
      el.attributes['data-label'] ??
      el.attributes['label'];
    if (labelAttr && labelAttr.trim().length > 0) {
      return {
        kind: 'getByLabel',
        label: labelAttr.trim(),
      };
    }

    if (
      (el.tag === 'input' || el.tag === 'textarea' || el.role === 'textbox') &&
      el.accessibleName &&
      el.accessibleName.trim().length > 0
    ) {
      return {
        kind: 'getByLabel',
        label: el.accessibleName.trim(),
      };
    }

    // Rule 4: Placeholder (getByPlaceholder)
    if (el.attributes['placeholder'] && el.attributes['placeholder'].trim().length > 0) {
      return {
        kind: 'getByPlaceholder',
        placeholder: el.attributes['placeholder'].trim(),
      };
    }

    // Rule 5: Accessible text (getByText)
    if (el.text && el.text.trim().length > 0 && el.text.trim().length < 50) {
      return {
        kind: 'getByText',
        text: el.text.trim(),
      };
    }

    // Rule 6: Scoped non-hash, non-volatile ID selector locator(#id)
    const id = el.attributes['id'];
    const isVolatileId =
      !id ||
      /^[0-9a-f]{8,}$/i.test(id) ||
      /^[a-z]+-[0-9a-f]{4,}$/i.test(id) ||
      /^:r[0-9a-z]+:$/i.test(id) ||
      /^(ember|chakra|radix)-\d+/i.test(id);

    if (id && id.trim().length > 0 && !isVolatileId) {
      return {
        kind: 'locator',
        selector: `#${id.trim()}`,
      };
    }

    // Rule 7: Scoped Class selector locator(tag.class) with semantic non-generated class
    const cls = el.attributes['class'];
    if (cls && !/css-[a-z0-9]+/i.test(cls)) {
      const primaryClass = cls.split(' ').filter(Boolean)[0];
      if (primaryClass && primaryClass.length > 2 && !/^[0-9a-f_-]{6,}$/i.test(primaryClass)) {
        return {
          kind: 'locator',
          selector: `${el.tag}.${primaryClass}`,
        };
      }
    }

    // Rule 8: Standalone distinct ARIA role if specific (e.g. dialog, alert, banner, search)
    const specificRoles = new Set(['dialog', 'alert', 'banner', 'search', 'navigation', 'main', 'complementary']);
    if (el.role && specificRoles.has(el.role)) {
      return {
        kind: 'getByRole',
        role: el.role,
      };
    }

    // AUDIT-13 Remediation: Bare tag fallback is strictly ELIMINATED.
    throw new InsufficientIdentifiersError(
      el.tag,
      `Element <${el.tag}> lacks distinctive identifying attributes (accessible name, test ID, label, placeholder, stable id, or semantic class) to construct a safe locator. Bare tag fallback (locator('${el.tag}')) is strictly prohibited to prevent test flakiness and incorrect repairs.`
    );
  }

  /**
   * Converts a typed LocatorPlan into an approved TypeScript expression string.
   */
  public static planToExpression(plan: LocatorPlan, pageProperty = 'this.page'): string {
    switch (plan.kind) {
      case 'getByRole': {
        const role = CandidateExtractor.escapeLocatorString(plan.role);
        if (plan.options?.name) {
          const name = CandidateExtractor.escapeLocatorString(plan.options.name);
          return `${pageProperty}.getByRole('${role}', { name: '${name}' })`;
        }
        return `${pageProperty}.getByRole('${role}')`;
      }
      case 'getByTestId': {
        const id = CandidateExtractor.escapeLocatorString(plan.testId);
        return `${pageProperty}.getByTestId('${id}')`;
      }
      case 'getByLabel': {
        const label = CandidateExtractor.escapeLocatorString(plan.label);
        return `${pageProperty}.getByLabel('${label}')`;
      }
      case 'getByPlaceholder': {
        const pl = CandidateExtractor.escapeLocatorString(plan.placeholder);
        return `${pageProperty}.getByPlaceholder('${pl}')`;
      }
      case 'getByText': {
        const txt = CandidateExtractor.escapeLocatorString(plan.text);
        return `${pageProperty}.getByText('${txt}')`;
      }
      case 'locator': {
        const sel = CandidateExtractor.escapeLocatorString(plan.selector);
        return `${pageProperty}.locator('${sel}')`;
      }
    }
  }

  /**
   * Generates a modern, user-centric Playwright locator expression.
   * Delegates to generateLocatorPlan and planToExpression.
   * Throws EngineError('INSUFFICIENT_IDENTIFIERS') if element lacks distinctive attributes.
   */
  public static generateLocator(el: ResolvedElement, pageProperty = 'this.page'): string {
    const plan = CandidateExtractor.generateLocatorPlan(el);
    return CandidateExtractor.planToExpression(plan, pageProperty);
  }

  /**
   * Extracts candidate elements from a resolved DOM tree matching the target action's semantics.
   * Requires genuine semantic or structural affinity.
   */
  public static extractCandidates(
    root: ResolvedElement,
    actionOrFailedAction?: FailedAction | { action?: string | undefined; selector?: string | undefined } | string
  ): ResolvedElement[] {
    const allInteractive = SnapshotResolver.extractInteractiveElements(root);

    let action = 'click';

    if (actionOrFailedAction && typeof actionOrFailedAction !== 'string') {
      action = (actionOrFailedAction.action ?? 'click').toLowerCase();
    }

    // Filter candidates by action compatibility
    return allInteractive.filter((element) => {
      // Rule 1: Action type compatibility
      if (action.includes('click')) {
        const isClickable =
          element.tag === 'button' ||
          element.tag === 'a' ||
          element.role === 'button' ||
          element.role === 'link' ||
          element.role === 'menuitem' ||
          element.role === 'tab' ||
          Boolean(element.attributes?.['onclick']) ||
          Boolean(element.attributes?.['href']);

        if (!isClickable && element.tag !== 'div' && element.tag !== 'span' && element.tag !== 'td') {
          return false;
        }
      } else if (action.includes('fill') || action.includes('type')) {
        const isInput =
          element.tag === 'input' ||
          element.tag === 'textarea' ||
          element.role === 'textbox' ||
          element.attributes?.['contenteditable'] === 'true';

        if (!isInput) {
          return false;
        }
      }

      // Rule 2: Exclude hidden / disabled elements
      if (
        element.attributes?.['aria-hidden'] === 'true' ||
        element.attributes?.['hidden'] !== undefined ||
        element.attributes?.['disabled'] !== undefined ||
        element.attributes?.['aria-disabled'] === 'true'
      ) {
        return false;
      }

      // Rule 3: Must have at least one valid identifier to be eligible for repair
      try {
        CandidateExtractor.generateLocatorPlan(element);
        return true;
      } catch {
        return false; // Bare elements lacking identifiers are filtered out
      }
    });
  }
}
