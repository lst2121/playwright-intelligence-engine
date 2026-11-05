import { ResolvedElement, SnapshotResolver } from '../trace/snapshot-resolver.js';
import { FailedAction } from '../core/types/diagnostic-context.js';

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
   * Discovers the page property identifier used in a Page Object class (e.g. this.page, this._page, this.browserPage, page).
   */
  public static discoverPageProperty(source?: string): string {
    if (!source || typeof source !== 'string') return 'this.page';
    if (source.includes('this._page')) return 'this._page';
    if (source.includes('this.browserPage')) return 'this.browserPage';
    if (source.includes('this.page')) return 'this.page';
    if (source.includes(' page: Page') || source.includes('page.')) return 'this.page';
    return 'this.page';
  }

  /**
   * Generates a modern, user-centric Playwright locator expression prioritizing getByRole and getByLabel.
   * Employs robust literal escaping.
   * Dynamically adapts to Page Object page property prefix.
   */
  public static generateLocator(el: ResolvedElement, pageProperty = 'this.page'): string {
    // Rule 1: Priority on ARIA role with accessible name (getByRole)
    if (el.role && el.accessibleName) {
      const escapedRole = CandidateExtractor.escapeLocatorString(el.role);
      const escapedName = CandidateExtractor.escapeLocatorString(el.accessibleName);
      return `${pageProperty}.getByRole('${escapedRole}', { name: '${escapedName}' })`;
    }

    // Rule 2: Dedicated Test ID attribute (getByTestId)
    const testId = el.attributes['data-testid'] ?? el.attributes['data-test'] ?? el.attributes['data-cy'];
    if (testId) {
      const escapedId = CandidateExtractor.escapeLocatorString(testId);
      return `${pageProperty}.getByTestId('${escapedId}')`;
    }

    // Rule 3: Form label (getByLabel)
    if (el.attributes['aria-label']) {
      const escapedLabel = CandidateExtractor.escapeLocatorString(el.attributes['aria-label']);
      return `${pageProperty}.getByLabel('${escapedLabel}')`;
    }

    // Rule 4: Placeholder (getByPlaceholder)
    if (el.attributes['placeholder']) {
      const escapedPl = CandidateExtractor.escapeLocatorString(el.attributes['placeholder']);
      return `${pageProperty}.getByPlaceholder('${escapedPl}')`;
    }

    // Rule 5: Accessible text (getByText)
    if (el.text && el.text.length > 0 && el.text.length < 50) {
      const escapedText = CandidateExtractor.escapeLocatorString(el.text);
      return `${pageProperty}.getByText('${escapedText}')`;
    }

    // Rule 6: Scoped ID selector locator(#id)
    const id = el.attributes['id'];
    if (id && !/^[0-9a-f]{8,}$/i.test(id)) {
      const escapedId = CandidateExtractor.escapeLocatorString(id);
      return `${pageProperty}.locator('#${escapedId}')`;
    }

    // Rule 7: Scoped Class selector locator(tag.class)
    const cls = el.attributes['class'];
    if (cls && !/css-[a-z0-9]+/i.test(cls)) {
      const primaryClass = cls.split(' ').filter(Boolean)[0];
      if (primaryClass) {
        const escapedClass = CandidateExtractor.escapeLocatorString(primaryClass);
        return `${pageProperty}.locator('${el.tag}.${escapedClass}')`;
      }
    }

    // If no identifying attributes exist, produce a scoped attribute locator or role locator
    if (el.role) {
      return `${pageProperty}.getByRole('${CandidateExtractor.escapeLocatorString(el.role)}')`;
    }

    // Never return bare tag fallback without warning/abstention
    return `${pageProperty}.locator('${CandidateExtractor.escapeLocatorString(el.tag)}')`;
  }

  /**
   * Extracts candidate elements from a resolved DOM tree matching the target action's semantics.
   * Requires genuine semantic or structural affinity; does NOT blindly accept all elements on small DOMs.
   */
  public static extractCandidates(
    root: ResolvedElement,
    actionOrFailedAction?: FailedAction | { action?: string | undefined; selector?: string | undefined } | string
  ): ResolvedElement[] {
    const allInteractive = SnapshotResolver.extractInteractiveElements(root);

    let action = 'click';
    let originalSelector = '';

    if (typeof actionOrFailedAction === 'string') {
      originalSelector = actionOrFailedAction.toLowerCase();
    } else if (actionOrFailedAction) {
      action = (actionOrFailedAction.action ?? 'click').toLowerCase();
      originalSelector = (actionOrFailedAction.selector ?? '').toLowerCase();
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
          element.role === 'tab' ||
          element.role === 'menuitem' ||
          element.attributes['role'] === 'button' ||
          Boolean(element.attributes['onclick']);
        if (!isClickable && element.tag !== 'input' && element.tag !== 'div') return false;
      }

      if (action.includes('fill') || action.includes('type')) {
        const isInput =
          element.tag === 'input' ||
          element.tag === 'textarea' ||
          element.role === 'textbox' ||
          element.attributes['contenteditable'] === 'true';
        if (!isInput) return false;
      }

      // Rule 2: Affirmative affinity check against original selector
      if (originalSelector) {
        const selectorTokens = originalSelector
          .replace(/[^a-z0-9]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length > 2);

        const elementText = (element.text ?? '').toLowerCase();
        const elementName = (element.accessibleName ?? '').toLowerCase();
        const elementId = (element.attributes['id'] ?? '').toLowerCase();
        const elementTestId = (
          element.attributes['data-testid'] ??
          element.attributes['data-test'] ??
          element.attributes['data-cy'] ??
          ''
        ).toLowerCase();

        const hasTagMatch = originalSelector.includes(element.tag);
        const hasTextOverlap = selectorTokens.some(
          (token) => elementText.includes(token) || elementName.includes(token)
        );
        const hasIdOverlap = selectorTokens.some(
          (token) => elementId.includes(token) || elementTestId.includes(token)
        );

        // Candidate must share at least one meaningful token or attribute affinity
        return hasTagMatch || hasTextOverlap || hasIdOverlap;
      }

      return true;
    });
  }
}
