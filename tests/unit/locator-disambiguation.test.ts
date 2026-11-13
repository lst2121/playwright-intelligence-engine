import { describe, it, expect } from 'vitest';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';
import { LocatorDisambiguationEngine } from '../../src/intelligence/locator-disambiguation-engine.js';

describe('PIE-AMB: Multi-Match Disambiguation & Positional Invariant Suite (AMB-01 .. AMB-10)', () => {
  // Helpers to construct mock DOM nodes
  const createBtn = (name: string, attrs: Record<string, string> = {}): ResolvedElement => ({
    tag: 'button',
    role: 'button',
    accessibleName: name,
    text: name,
    attributes: attrs,
    children: [],
  });

  const createContainer = (
    tag: string,
    children: ResolvedElement[],
    text = '',
    attrs: Record<string, string> = {}
  ): ResolvedElement => ({
    tag,
    text,
    attributes: attrs,
    children,
  });

  it('AMB-01: Unique Direct Match resolves cleanly with confidence 1.0', () => {
    const btn = createBtn('Sign In');
    const result = LocatorDisambiguationEngine.disambiguate([btn]);

    expect(result.strategy).toBe('UNIQUE_DIRECT_MATCH');
    expect(result.isUnique).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.resolvedExpression).toContain(`getByRole('button', { name: 'Sign In' })`);
  });

  it('AMB-02: Visibility Filtering resolves when 1 button is visible and duplicate is hidden', () => {
    const visibleBtn = createBtn('Menu', { id: 'desktop-menu' });
    const hiddenBtn = createBtn('Menu', { id: 'mobile-menu', 'aria-hidden': 'true' });

    const result = LocatorDisambiguationEngine.disambiguate([visibleBtn, hiddenBtn]);

    expect(result.strategy).toBe('VISIBILITY_FILTER');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedCandidate).toBe(visibleBtn);
    expect(result.resolvedExpression).toContain('.filter({ visible: true })');
  });

  it('AMB-03: Container Anchoring scopes to Table Row by distinguishing row text', () => {
    const btn1 = createBtn('Edit');
    const btn2 = createBtn('Edit');

    const row1 = createContainer('tr', [createContainer('td', [], 'User #101'), btn1], 'User #101');
    const row2 = createContainer('tr', [createContainer('td', [], 'User #202'), btn2], 'User #202');

    const tableRoot = createContainer('table', [row1, row2]);

    const result = LocatorDisambiguationEngine.disambiguate(
      [btn1, btn2],
      {
        rootDom: tableRoot,
        testIntentText: 'Click Edit for User #101',
      }
    );

    expect(result.strategy).toBe('CONTAINER_ANCHOR');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`locator('tr').filter({ hasText: 'User #101' })`);
    expect(result.resolvedExpression).toContain(`getByRole('button', { name: 'Edit' })`);
  });

  it('AMB-04: Container Anchoring scopes to Product Card by product title', () => {
    const btnA = createBtn('Add to Cart');
    const btnB = createBtn('Add to Cart');

    const cardA = createContainer(
      'article',
      [createContainer('h3', [], 'Mechanical Keyboard'), btnA],
      'Mechanical Keyboard',
      { 'data-testid': 'product-card' }
    );
    const cardB = createContainer(
      'article',
      [createContainer('h3', [], 'Wireless Mouse'), btnB],
      'Wireless Mouse',
      { 'data-testid': 'product-card' }
    );

    const catalogRoot = createContainer('div', [cardA, cardB]);

    const result = LocatorDisambiguationEngine.disambiguate(
      [btnA, btnB],
      {
        rootDom: catalogRoot,
        testIntentText: 'Add Mechanical Keyboard to cart',
      }
    );

    expect(result.strategy).toBe('CONTAINER_ANCHOR');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`filter({ hasText: 'Mechanical Keyboard' })`);
  });

  it('AMB-05: Landmark Scoping scopes to Header search when header is specified in context', () => {
    const headerBtn = createBtn('Search');
    const footerBtn = createBtn('Search');

    const header = createContainer('header', [headerBtn]);
    const footer = createContainer('footer', [footerBtn]);
    const root = createContainer('div', [header, footer]);

    const result = LocatorDisambiguationEngine.disambiguate(
      [headerBtn, footerBtn],
      {
        rootDom: root,
        originalSelector: `page.locator('header').getByRole('button', { name: 'Search' })`,
      }
    );

    expect(result.strategy).toBe('LANDMARK_SECTION');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`locator('header').getByRole('button', { name: 'Search' })`);
  });

  it('AMB-06: Landmark Scoping scopes to Modal Dialog', () => {
    const mainConfirm = createBtn('Confirm');
    const modalConfirm = createBtn('Confirm');

    const main = createContainer('main', [mainConfirm]);
    const dialog = createContainer('dialog', [modalConfirm]);
    const root = createContainer('div', [main, dialog]);

    const result = LocatorDisambiguationEngine.disambiguate(
      [mainConfirm, modalConfirm],
      {
        rootDom: root,
        testIntentText: 'Click Confirm in delete modal dialog',
      }
    );

    expect(result.strategy).toBe('LANDMARK_SECTION');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`locator('dialog').getByRole('button', { name: 'Confirm' })`);
  });

  it('AMB-06B: Multiple candidates inside same landmark should NOT claim uniqueness via landmark scoping', () => {
    const headerBtn1 = createBtn('Search');
    const headerBtn2 = createBtn('Search');

    const header = createContainer('header', [headerBtn1, headerBtn2]);
    const root = createContainer('div', [header]);

    const result = LocatorDisambiguationEngine.disambiguate(
      [headerBtn1, headerBtn2],
      {
        rootDom: root,
        originalSelector: `page.locator('header').getByRole('button', { name: 'Search' })`,
      }
    );

    // Because both buttons are in the header, landmark scoping cannot resolve uniquely; it must safely abstain
    expect(result.strategy).toBe('ABSTAIN_AMBIGUOUS');
    expect(result.isUnique).toBe(false);
  });

  it('AMB-07: Explicit Positional Intent preserves .first() when declared in originalSelector', () => {
    const btn1 = createBtn('Select');
    const btn2 = createBtn('Select');

    const result = LocatorDisambiguationEngine.disambiguate(
      [btn1, btn2],
      {
        originalSelector: `page.getByRole('button', { name: 'Select' }).first()`,
      }
    );

    expect(result.strategy).toBe('EXPLICIT_POSITIONAL_INTENT');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`.first()`);
    expect(result.explanation).toContain('Verified explicit positional intent');
  });

  it('AMB-08: Explicit Positional Intent preserves .nth(2) when declared in originalSelector', () => {
    const btn1 = createBtn('Select');
    const btn2 = createBtn('Select');
    const btn3 = createBtn('Select');

    const result = LocatorDisambiguationEngine.disambiguate(
      [btn1, btn2, btn3],
      {
        originalSelector: `page.getByRole('button', { name: 'Select' }).nth(2)`,
      }
    );

    expect(result.strategy).toBe('EXPLICIT_POSITIONAL_INTENT');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedExpression).toContain(`.nth(2)`);
  });

  it('AMB-09: Safe Abstention on Ambiguous Multi-Match without distinguishing context', () => {
    const btn1 = createBtn('Checkout');
    const btn2 = createBtn('Checkout');

    const result = LocatorDisambiguationEngine.disambiguate(
      [btn1, btn2],
      {
        originalSelector: `page.getByRole('button', { name: 'Checkout' })`,
      }
    );

    expect(result.strategy).toBe('ABSTAIN_AMBIGUOUS');
    expect(result.isUnique).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toContain('Safe abstention enforced');
  });

  it('AMB-10: POSITIONAL INVARIANT: Engine strictly refuses to invent .first() or positional guessing', () => {
    const btn1 = createBtn('Add');
    const btn2 = createBtn('Add');

    const result = LocatorDisambiguationEngine.disambiguate(
      [btn1, btn2],
      {
        originalSelector: `page.getByRole('button', { name: 'Add' })`,
        testIntentText: 'Click add',
      }
    );

    // INVARIANT CHECK: Must NEVER return .first() when the test didn't ask for it!
    expect(result.strategy).toBe('ABSTAIN_AMBIGUOUS');
    expect(result.resolvedExpression).toBeUndefined();
    expect(result.isUnique).toBe(false);
  });
});
