/**
 * Semantic Field & Action Normalizer for Playwright Intelligence Engine (PIE).
 *
 * Replaces naive DOM placeholder camelCasing (e.g. `info@gmail.com` -> `infoGmailComInput`)
 * with semantic, W3C/ARIA-grounded property names and robust primary submit button filtering.
 */

export interface FormLocatorCandidate {
  id?: string | undefined;
  type?: string | undefined;
  role?: string | undefined;
  accessibleName?: string | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  testId?: string | undefined;
  expression?: string | undefined;
  visible?: boolean | undefined;
}

const RESERVED_JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'enum', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'await', 'abstract', 'boolean', 'byte', 'char', 'double', 'final', 'float',
  'goto', 'int', 'long', 'native', 'short', 'synchronized', 'throws', 'transient', 'volatile',
  'page', 'constructor', 'submit', 'goto', 'fill', 'click', 'press',
]);

const THIRD_PARTY_SSO_PATTERN = /\b(google|github|apple|facebook|twitter|microsoft|gitlab|sso|oauth)\b/i;
const DEVTOOLS_PATTERN = /\b(dev ?tools|turbopack|webpack|inspect|debug)\b/i;
const DESTRUCTIVE_ACTION_PATTERN = /\b(delete|remove|destroy|cancel|close|dismiss|clear|reset|back)\b/i;
const NAVIGATION_TOGGLE_PATTERN = /\b(toggle menu|sidebar|collapse|expand|notification|profile|avatar|theme|dark mode|light mode)\b/i;
const PRIMARY_SUBMIT_PATTERN = /^(log ?in|sign ?in|sign ?up|register|submit|save|create|send|continue|confirm|next|add|done|finish)$/i;
const SUBMIT_VERBS_PATTERN = /\b(submit|send|save|create|continue|confirm|log ?in|sign ?in|sign ?up|register|next|add)\b/i;

function cleanText(text: string): string {
  return text
    .replace(/^please\s+/i, '')
    .replace(/^enter\s+(?:your\s+)?/i, '')
    .replace(/^type\s+(?:your\s+)?/i, '')
    .replace(/^input\s+(?:your\s+)?/i, '')
    .replace(/^your\s+/i, '')
    .replace(/^e\.?g\.?\s*/i, '')
    .trim();
}

function toCamelCase(str: string): string {
  const words = str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g);
  if (!words || words.length === 0) return '';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/**
 * Derives a clean, semantic property name for an input or interactive control.
 * Prioritizes W3C semantics, ARIA labels, and domain intents over literal placeholder text.
 */
export function normalizeFormFieldName(
  loc: FormLocatorCandidate,
  index: number,
  usedNames: Set<string> = new Set()
): string {
  const hints = [
    loc.type,
    loc.label,
    loc.accessibleName,
    loc.placeholder,
    loc.testId,
    loc.expression,
  ].filter(Boolean).join(' ').toLowerCase();

  let base = '';

  // 1. Password confirmation
  if (/confirm.*pass|repeat.*pass|verify.*pass|re-?enter.*pass/i.test(hints)) {
    base = 'confirmPasswordInput';
  }
  // 2. Password
  else if (loc.type === 'password' || /\b(password|passwd|pwd)\b/i.test(hints)) {
    base = 'passwordInput';
  }
  // 3. Email (recognizes HTML5 type, aria label, or placeholder example with @)
  else if (loc.type === 'email' || /\bemail\b/i.test(hints) || /[^@\s]+@[^@\s]+\.[^@\s]+/i.test(hints)) {
    base = 'emailInput';
  }
  // 4. First Name
  else if (/\b(first\s*name|fname|given\s*name)\b/i.test(hints)) {
    base = 'firstNameInput';
  }
  // 5. Last Name
  else if (/\b(last\s*name|lname|surname|family\s*name)\b/i.test(hints)) {
    base = 'lastNameInput';
  }
  // 6. Full Name
  else if (/\b(full\s*name)\b/i.test(hints) || (/\bname\b/i.test(hints) && !/\b(user|file|company|org|product|category)\b/i.test(hints))) {
    base = 'nameInput';
  }
  // 7. Username / Handle
  else if (/\b(username|user\s*name|login\s*name|handle)\b/i.test(hints)) {
    base = 'usernameInput';
  }
  // 8. Phone / Mobile
  else if (loc.type === 'tel' || /\b(phone|mobile|telephone|cell)\b/i.test(hints)) {
    base = 'phoneInput';
  }
  // 9. Search
  else if (loc.type === 'search' || loc.role === 'searchbox' || /\b(search|find)\b/i.test(hints)) {
    base = 'searchInput';
  }
  // 10. Date / Calendar / Flatpickr
  else if (loc.type === 'date' || /\b(date|flatpickr|calendar|dob|birth|schedule)\b/i.test(hints)) {
    base = 'datePicker';
  }
  // 11. Title / Subject / Heading
  else if (/\b(title|subject|heading)\b/i.test(hints)) {
    base = 'titleInput';
  }
  // 12. Body / Content / Message / Notes
  else if (/\b(body|content|message|description|notes?|comment|summary)\b/i.test(hints)) {
    base = 'bodyInput';
  }
  // 13. Address / Street
  else if (/\b(address|street)\b/i.test(hints)) {
    base = 'addressInput';
  }
  // 14. City
  else if (/\bcity\b/i.test(hints)) {
    base = 'cityInput';
  }
  // 15. Zip / Postal
  else if (/\b(zip|postal|postcode)\b/i.test(hints)) {
    base = 'zipCodeInput';
  }
  // 16. State / Province
  else if (/\b(state|province|region)\b/i.test(hints)) {
    base = 'stateInput';
  }
  // 17. Country
  else if (/\bcountry\b/i.test(hints)) {
    base = 'countryInput';
  }
  // 18. Company / Organization
  else if (/\b(company|organization|org)\b/i.test(hints)) {
    base = 'companyInput';
  }
  // 19. URL / Website
  else if (loc.type === 'url' || /\b(url|website|site|link)\b/i.test(hints)) {
    base = 'urlInput';
  }
  // 20. Code / OTP / PIN / Token
  else if (/\b(code|token|otp|pin|verification)\b/i.test(hints)) {
    base = 'codeInput';
  }
  // 21. Price / Amount
  else if (/\b(price|amount|cost|fee)\b/i.test(hints)) {
    base = 'amountInput';
  }
  // 22. Quantity / Count
  else if (/\b(quantity|qty|count)\b/i.test(hints)) {
    base = 'quantityInput';
  }

  // Fallback: derive from label or accessibleName, avoiding literal placeholder values
  if (!base) {
    const rawCandidate = loc.label || loc.accessibleName || loc.testId || '';
    const cleaned = cleanText(rawCandidate);
    const camel = toCamelCase(cleaned).replace(/[^a-zA-Z0-9]/g, '');

    if (camel && !/^\d/.test(camel) && camel.length >= 2) {
      if (loc.role === 'checkbox') {
        base = camel.endsWith('Checkbox') ? camel : `${camel}Checkbox`;
      } else if (loc.role === 'combobox') {
        base = camel.endsWith('Select') ? camel : `${camel}Select`;
      } else {
        base = /input|field|textbox|box|textarea|select|picker/i.test(camel) ? camel : `${camel}Input`;
      }
    }
  }

  // Absolute fallback
  if (!base || /^\d/.test(base) || RESERVED_JS_KEYWORDS.has(base.toLowerCase())) {
    base = `inputField${index + 1}`;
  }

  // Collision handling
  let finalName = base;
  let count = 1;
  while (usedNames.has(finalName)) {
    finalName = `${base}${++count}`;
  }
  usedNames.add(finalName);
  return finalName;
}

/**
 * Identifies whether a button is a third-party SSO button, devtools button,
 * destructive action, or navigation toggle rather than the primary submit action.
 */
export function isNonPrimaryOrThirdPartyButton(loc: FormLocatorCandidate): boolean {
  const text = [loc.accessibleName, loc.label, loc.testId, loc.expression].filter(Boolean).join(' ');
  if (THIRD_PARTY_SSO_PATTERN.test(text)) return true;
  if (DEVTOOLS_PATTERN.test(text)) return true;
  if (DESTRUCTIVE_ACTION_PATTERN.test(text)) return true;
  if (NAVIGATION_TOGGLE_PATTERN.test(text)) return true;
  return false;
}

/**
 * Selects the unambiguous primary submit button from scoped locators,
 * preventing third-party OAuth ("Sign in with Google") and devtools from hijacking form submission.
 */
export function findPrimarySubmitButton(scopedLocators: FormLocatorCandidate[]): FormLocatorCandidate | undefined {
  const visibleButtons = scopedLocators.filter((l) =>
    (l.role === 'button' || l.type === 'submit') &&
    l.visible !== false &&
    !isNonPrimaryOrThirdPartyButton(l)
  );

  // 1. Highest priority: accessibleName strictly matches primary submit action
  const exactSubmit = visibleButtons.find((l) =>
    l.accessibleName && PRIMARY_SUBMIT_PATTERN.test(l.accessibleName.trim())
  );
  if (exactSubmit) return exactSubmit;

  // 2. Second priority: accessibleName contains primary submit verbs
  const verbSubmit = visibleButtons.find((l) =>
    l.accessibleName && SUBMIT_VERBS_PATTERN.test(l.accessibleName)
  );
  if (verbSubmit) return verbSubmit;

  // 3. Third priority: HTML type="submit"
  const typeSubmit = visibleButtons.find((l) => l.type === 'submit');
  if (typeSubmit) return typeSubmit;

  // 4. Fallback: first non-third-party, non-destructive visible button
  return visibleButtons[0];
}
