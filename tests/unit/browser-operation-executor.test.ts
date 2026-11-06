import { describe, expect, it } from 'vitest';
import { executeBrowserOperation } from '../../src/repair/browser-operation-executor.js';
import { LocatorPlan } from '../../src/selector/candidate-extractor.js';

function locator(name: string, count = 1) {
  const value: any = {
    count: async () => count,
    first: () => value,
    isVisible: async () => true,
    isEnabled: async () => true,
    click: async () => undefined,
    locator: () => value,
    name,
  };
  return value;
}

function page() {
  const target = locator('target');
  const frame = {
    getByRole: () => target,
    locator: () => target,
  };
  return {
    getByRole: () => target,
    locator: () => target,
    frameLocator: () => frame,
    waitForLoadState: async () => undefined,
  };
}

const targetPlan: LocatorPlan = { kind: 'getByRole', role: 'button', options: { name: 'Pay' } };

describe('browser-safe repair operation executor', () => {
  it('verifies a replacement locator without evaluating model-generated code', async () => {
    const result = await executeBrowserOperation({
      pageOrFrame: page(),
      operation: { kind: 'replace_locator', target: 'Payment.submit', locator: "getByRole('button', { name: 'Pay' })" },
      replacementPlan: targetPlan,
    });
    expect(result.status).toBe('VERIFIED');
    expect(result.action).toBe('verify');
  });

  it('verifies a frame-scoped target through the official frameLocator API', async () => {
    const result = await executeBrowserOperation({
      pageOrFrame: page(),
      operation: { kind: 'add_frame_scope', target: 'this.page.getByRole(\'button\', { name: \'Pay\' })', frameLocator: 'iframe[title="Payment"]' },
      targetPlan,
    });
    expect(result.status).toBe('VERIFIED');
    expect(result.verification?.count).toBe(1);
  });

  it('requires explicit interaction permission before dismissing an overlay', async () => {
    const operation = { kind: 'dismiss_overlay' as const, locator: 'overlay' };
    const blocked = await executeBrowserOperation({ pageOrFrame: page(), operation, overlayPlan: targetPlan });
    expect(blocked.status).toBe('ABSTAINED');
    expect(blocked.reason).toContain('allowInteraction');

    const allowed = await executeBrowserOperation({ pageOrFrame: page(), operation, overlayPlan: targetPlan, allowInteraction: true });
    expect(allowed.status).toBe('VERIFIED');
    expect(allowed.action).toBe('click');
  });

  it('keeps prerequisite workflows proposal-only', async () => {
    const result = await executeBrowserOperation({ pageOrFrame: page(), operation: { kind: 'satisfy_prerequisite', prerequisite: 'login' } });
    expect(result.status).toBe('ABSTAINED');
    expect(result.reason).toContain('proposal-only');
  });

  it('executes only the constrained state-wait vocabulary', async () => {
    const result = await executeBrowserOperation({
      pageOrFrame: page(),
      operation: {
        kind: 'replace_unstable_wait_with_state_wait',
        target: 'Payment.submit',
        steps: ['load_state:domcontentloaded', 'target_visible', 'target_enabled'],
      },
      targetPlan,
    });
    expect(result.status).toBe('VERIFIED');
    expect(result.evidence).toContain('Load state reached: domcontentloaded');
    expect(result.evidence).toContain('Target state verified: target_enabled');
  });

  it('rejects arbitrary state-wait strings instead of executing them', async () => {
    const result = await executeBrowserOperation({
      pageOrFrame: page(),
      operation: {
        kind: 'replace_unstable_wait_with_state_wait',
        target: 'Payment.submit',
        steps: ['page.evaluate(() => alert(1))'],
      },
      targetPlan,
    });
    expect(result.status).toBe('ABSTAINED');
    expect(result.reason).toContain('Only load_state');
  });

  it('executes a constrained combobox flow only with explicit interaction permission', async () => {
    const operation = {
      kind: 'replace_select_with_combobox_flow' as const,
      target: 'Payment.country',
      steps: ['target_visible', 'target_enabled', 'open', 'option:India'],
    };
    const blocked = await executeBrowserOperation({ pageOrFrame: page(), operation, targetPlan });
    expect(blocked.status).toBe('ABSTAINED');
    expect(blocked.reason).toContain('allowInteraction');

    const allowed = await executeBrowserOperation({ pageOrFrame: page(), operation, targetPlan, allowInteraction: true });
    expect(allowed.status).toBe('VERIFIED');
    expect(allowed.evidence).toContain('Combobox opened');
    expect(allowed.evidence).toContain('Combobox option selected: India');
  });

  it('rejects arbitrary combobox step strings', async () => {
    const result = await executeBrowserOperation({
      pageOrFrame: page(),
      operation: { kind: 'replace_select_with_combobox_flow', target: 'Payment.country', steps: ['page.evaluate(() => alert(1))'] },
      targetPlan,
      allowInteraction: true,
    });
    expect(result.status).toBe('ABSTAINED');
    expect(result.reason).toContain('Combobox flows allow only');
  });
});
