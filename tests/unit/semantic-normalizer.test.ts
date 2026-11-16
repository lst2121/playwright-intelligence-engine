import { describe, expect, it } from 'vitest';
import {
  normalizeFormFieldName,
  findPrimarySubmitButton,
  isNonPrimaryOrThirdPartyButton,
} from '../../src/intelligence/semantic-normalizer.js';
import { composeFixtureAst } from '../../src/intelligence/fixture-composer.js';

describe('Semantic Field Normalizer', () => {
  it('normalizes literal email dummy placeholder to emailInput', () => {
    const name = normalizeFormFieldName({
      placeholder: 'info@gmail.com',
      type: 'text',
      role: 'textbox',
    }, 0);
    expect(name).toBe('emailInput');
  });

  it('normalizes password fields to passwordInput and confirmPasswordInput', () => {
    const used = new Set<string>();
    const pass = normalizeFormFieldName({
      type: 'password',
      placeholder: '••••••••',
    }, 0, used);
    expect(pass).toBe('passwordInput');

    const confirm = normalizeFormFieldName({
      type: 'password',
      label: 'Confirm Password',
      placeholder: 'Re-enter password',
    }, 1, used);
    expect(confirm).toBe('confirmPasswordInput');
  });

  it('normalizes names, titles, and body fields', () => {
    const used = new Set<string>();
    expect(normalizeFormFieldName({ label: 'First Name' }, 0, used)).toBe('firstNameInput');
    expect(normalizeFormFieldName({ label: 'Last Name' }, 1, used)).toBe('lastNameInput');
    expect(normalizeFormFieldName({ label: 'Title', placeholder: 'Note title' }, 2, used)).toBe('titleInput');
    expect(normalizeFormFieldName({ label: 'Body', placeholder: 'Write your notes here' }, 3, used)).toBe('bodyInput');
  });

  it('normalizes search, phone, and datepickers', () => {
    const used = new Set<string>();
    expect(normalizeFormFieldName({ placeholder: 'Search...' }, 0, used)).toBe('searchInput');
    expect(normalizeFormFieldName({ placeholder: 'Enter phone number' }, 1, used)).toBe('phoneInput');
    expect(normalizeFormFieldName({ placeholder: 'flatpickr-input' }, 2, used)).toBe('datePicker');
  });

  it('avoids collisions by incrementing suffix', () => {
    const used = new Set<string>();
    const name1 = normalizeFormFieldName({ label: 'Email' }, 0, used);
    const name2 = normalizeFormFieldName({ label: 'Email' }, 1, used);
    expect(name1).toBe('emailInput');
    expect(name2).toBe('emailInput2');
  });
});

describe('Primary Submit Button Filtering', () => {
  it('filters out third-party SSO and DevTools buttons', () => {
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Sign in with Google' })).toBe(true);
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Sign in with GitHub' })).toBe(true);
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Open Next.js Dev Tools' })).toBe(true);
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Delete Note' })).toBe(true);
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Sign in' })).toBe(false);
    expect(isNonPrimaryOrThirdPartyButton({ accessibleName: 'Submit' })).toBe(false);
  });

  it('prioritizes primary submit button over OAuth buttons', () => {
    const locators = [
      { role: 'button', accessibleName: 'Sign in with Google', visible: true },
      { role: 'button', accessibleName: 'Sign in with GitHub', visible: true },
      { role: 'button', accessibleName: 'Sign in', visible: true },
      { role: 'button', accessibleName: 'Open Next.js Dev Tools', visible: true },
    ];
    const submit = findPrimarySubmitButton(locators);
    expect(submit?.accessibleName).toBe('Sign in');
  });
});

describe('AST Fixture Composer', () => {
  it('composes a new Page Object into an existing fixture file', () => {
    const initialFixture = `import { test as base } from '@playwright/test';
import { UserLoginPage } from './pages/UserLoginPage.js';

type AppFixtures = {
  userLoginPage: UserLoginPage;
};

export const test = base.extend<AppFixtures>({
  userLoginPage: async ({ page }, use) => {
    const userLoginPage = new UserLoginPage(page);
    await userLoginPage.goto();
    await use(userLoginPage);
  },
});

export { expect } from '@playwright/test';
`;

    const composed = composeFixtureAst(
      initialFixture,
      'NotesPage',
      'notesPage',
      './pages/NotesPage.js'
    );

    expect(composed).toMatch(/import \{ NotesPage \} from ['"]\.\/pages\/NotesPage\.js['"];/);
    expect(composed).toContain('notesPage: NotesPage;');
    expect(composed).toContain('userLoginPage: UserLoginPage;');
    expect(composed).toContain('notesPage: async ({ page }, use) => {');
    expect(composed).toContain('const notesPage = new NotesPage(page);');
  });

  it('is idempotent when the Page Object is already composed', () => {
    const initialFixture = `import { test as base } from '@playwright/test';
import { UserLoginPage } from './pages/UserLoginPage.js';

type AppFixtures = {
  userLoginPage: UserLoginPage;
};

export const test = base.extend<AppFixtures>({
  userLoginPage: async ({ page }, use) => {
    const userLoginPage = new UserLoginPage(page);
    await userLoginPage.goto();
    await use(userLoginPage);
  },
});

export { expect } from '@playwright/test';
`;

    const composedOnce = composeFixtureAst(
      initialFixture,
      'UserLoginPage',
      'userLoginPage',
      './pages/UserLoginPage.js'
    );

    // Should not duplicate
    const occurrences = (composedOnce.match(/userLoginPage:/g) || []).length;
    expect(occurrences).toBe(2); // 1 in type, 1 in extend
  });
});
