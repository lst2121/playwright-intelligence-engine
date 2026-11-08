#!/usr/bin/env node
/**
 * Grounding probe — a step with no accessible name must not become a locator.
 *
 * v3.2 scope is "stop inventing". A navigate-only plan must produce zero
 * symbols and a NEEDS_INPUT status rather than a synthetic button.
 */
import { planArchitecture } from '../../../dist/index.js';

const failures = [];

const navigateOnly = planArchitecture({
  featureName: 'OrderReview',
  mode: 'greenfield',
  steps: [{ action: 'navigate' }],
});

const symbols = navigateOnly.namePlan?.symbols ?? [];
if (navigateOnly.status !== 'NEEDS_INPUT') {
  failures.push(`navigate-only status=${navigateOnly.status} (expected NEEDS_INPUT)`);
}
if (symbols.length !== 0) {
  failures.push(`navigate-only emitted ${symbols.length} symbol(s): ${symbols.map((s) => s.property).join(', ')}`);
}

const genericButton = navigateOnly.files
  .map((f) => f.content)
  .join('\n')
  .match(/readonly\s+(actionButton|buttonButton|button\d*)\s*:/g);
if (genericButton) {
  failures.push(`generated POM contains generic locator(s): ${genericButton.join(', ')}`);
}

if (failures.length > 0) {
  console.log(`FAIL ${failures.join('; ')}`);
  process.exit(1);
}
console.log('OK ungrounded steps produce NEEDS_INPUT with zero symbols');
