import { ResolvedElement, SnapshotResolver } from '../trace/snapshot-resolver.js';
import { FailedAction } from '../core/types/diagnostic-context.js';

export class CandidateExtractor {
  /**
   * Extracts candidate elements from a resolved DOM tree matching the target action's semantics.
   */
  public static extractCandidates(
    root: ResolvedElement,
    failedAction: FailedAction
  ): ResolvedElement[] {
    const allInteractive = SnapshotResolver.extractInteractiveElements(root);
    const action = failedAction.action.toLowerCase();
    const originalSelector = (failedAction.selector ?? '').toLowerCase();

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
        if (!isClickable && element.tag !== 'input') return false;
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
