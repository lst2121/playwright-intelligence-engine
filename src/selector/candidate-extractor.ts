import { ResolvedElement, SnapshotResolver } from '../trace/snapshot-resolver.js';
import { FailedAction } from '../core/types/diagnostic-context.js';

export class CandidateExtractor {
  /**
   * Generates a modern, user-centric Playwright locator expression prioritizing getByRole and getByLabel.
   */
  public static generateLocator(el: ResolvedElement): string {
    // Rule 1: Priority on ARIA role with accessible name (getByRole)
    if (el.role && el.accessibleName) {
      return `this.page.getByRole('${el.role}', { name: '${el.accessibleName.replace(/'/g, "\\'")}' })`;
    }

    // Rule 2: Dedicated Test ID attribute (getByTestId)
    const testId = el.attributes['data-testid'] ?? el.attributes['data-test'] ?? el.attributes['data-cy'];
    if (testId) {
      return `this.page.getByTestId('${testId}')`;
    }

    // Rule 3: Form label (getByLabel)
    if (el.attributes['aria-label']) {
      return `this.page.getByLabel('${el.attributes['aria-label'].replace(/'/g, "\\'")}')`;
    }

    // Rule 4: Placeholder (getByPlaceholder)
    if (el.attributes['placeholder']) {
      return `this.page.getByPlaceholder('${el.attributes['placeholder'].replace(/'/g, "\\'")}')`;
    }

    // Rule 5: Accessible text (getByText)
    if (el.text && el.text.length > 0 && el.text.length < 40) {
      return `this.page.getByText('${el.text.replace(/'/g, "\\'")}')`;
    }

    // Rule 6: Scoped ID selector locator(#id)
    const id = el.attributes['id'];
    if (id && !/^[0-9a-f]{8,}$/i.test(id)) {
      return `this.page.locator('#${id}')`;
    }

    // Rule 7: Scoped Class selector locator(tag.class)
    const cls = el.attributes['class'];
    if (cls && !/css-[a-z0-9]+/i.test(cls)) {
      const primaryClass = cls.split(' ').filter(Boolean)[0];
      if (primaryClass) {
        return `this.page.locator('${el.tag}.${primaryClass}')`;
      }
    }

    return `this.page.locator('${el.tag}')`;
  }

  /**
   * Extracts candidate elements from a resolved DOM tree matching the target action's semantics.
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
          Boolean(element.attributes['onclick']);
        if (!isClickable && element.tag !== 'input' && element.tag !== 'div') return false;
      }

      if (action.includes('fill') || action.includes('type')) {
        const isInput =
          element.tag === 'input' ||
          element.tag === 'textarea' ||
          element.role === 'textbox';
        if (!isInput) return false;
      }

      // Rule 2: Basic plausibility check against original selector tokens
      if (originalSelector) {
        // Check for token overlap in tag, id, class, or text
        const hasTagMatch = originalSelector.includes(element.tag);
        const hasTextOverlap =
          element.text &&
          element.text.length > 2 &&
          originalSelector.includes(element.text.toLowerCase());
        const hasAttrOverlap = Object.values(element.attributes).some(
          (val) => val.length > 2 && originalSelector.includes(val.toLowerCase())
        );

        // Keep element if it shares some semantic or structural affinity
        return hasTagMatch || hasTextOverlap || hasAttrOverlap || allInteractive.length < 10;
      }

      return true;
    });
  }
}

