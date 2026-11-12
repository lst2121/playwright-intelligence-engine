import type { NamePlan } from './name-plan.js';

export interface NamingLintViolation {
  kind:
    | 'INDEX_DERIVED_IDENTIFIER'
    | 'DUPLICATE_PROPERTY'
    | 'DUPLICATE_METHOD'
    | 'DUPLICATE_WORD_IN_IDENTIFIER'
    | 'CLASS_NAME_CASING'
    | 'RESERVED_WORD_COLLISION'
    | 'MISSING_VERB'
    | 'ZERO_SEMANTIC_OVERLAP'
    | 'UNGROUNDED_IDENTIFIER';
  message: string;
  identifier: string;
  ref?: string | undefined;
}

export interface NamingLintReport {
  passed: boolean;
  violations: NamingLintViolation[];
  totalIdentifiers: number;
  indexDerivedIdentifierCount: number;
  duplicateSymbolCount: number;
  semanticNameCoverage: number | null;
  namingConformanceRate: number | null;
}

const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'enum', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'await', 'abstract', 'boolean', 'byte', 'char', 'double', 'final', 'float',
  'goto', 'int', 'long', 'native', 'short', 'synchronized', 'throws', 'transient', 'volatile',
  'page', 'constructor', 'locator',
]);

const ALLOWED_VERBS = new Set([
  'fill', 'enter', 'click', 'submit', 'signIn', 'signUp', 'open', 'goTo', 'select', 'check',
  'uncheck', 'expectVisible', 'expectText', 'expectHidden', 'perform', 'press', 'hover', 'clear',
  'add', 'create', 'update', 'edit', 'delete', 'remove', 'toggle', 'filter', 'search', 'navigate',
  'login', 'logout', 'register', 'verify', 'assert', 'wait', 'proceed', 'confirm', 'cancel',
  'complete', 'reset', 'sort', 'apply', 'upload', 'download', 'type', 'focus', 'get', 'is', 'has',
]);

/** Generic role-derived identifiers with no accessible name (actionButton, buttonButton). */
const GENERIC_ROLE_NAME_RE = /^(action|button|input|element|field|link|text|heading|checkbox|combobox|radio|select|tab|cell|status|dialog|content|widget)(Button|Input|Element|Field|Link|Text|Heading|Checkbox|Combobox|Radio|Select|Tab|Cell|Status|Dialog|Content|Widget)?$/i;

const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  register: ['signup', 'sign', 'up', 'register', 'enroll'],
  signup: ['register', 'sign', 'up', 'signup', 'enroll'],
  login: ['signin', 'sign', 'in', 'login', 'auth'],
  signin: ['login', 'sign', 'in', 'signin', 'auth'],
  checkout: ['order', 'buy', 'purchase', 'submit', 'pay'],
  save: ['submit', 'confirm', 'apply'],
  apply: ['submit', 'save', 'application'],
};

function extractWords(identifier: string): string[] {
  const tokens = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const words: string[] = [];
  for (const token of tokens) {
    if (token.length >= 6 && token.length % 2 === 0) {
      const half = token.slice(0, token.length / 2);
      const secondHalf = token.slice(token.length / 2);
      if (half.toLowerCase() === secondHalf.toLowerCase()) {
        words.push(half, secondHalf);
        continue;
      }
    }
    words.push(token);
  }
  return words;
}

function hasDuplicateAdjacentWords(identifier: string): boolean {
  const words = extractWords(identifier);
  if (words.length < 2) return false;
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i]!.toLowerCase() === words[i + 1]!.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export class NamingLinter {
  public static lint(plan: NamePlan): NamingLintReport {
    const violations: NamingLintViolation[] = [];
    const seenProperties = new Set<string>();
    const seenMethods = new Set<string>();

    let indexDerivedCount = 0;
    let duplicateCount = 0;
    let semanticMatches = 0;
    let totalAssessed = 0;

    // Check class name casing
    if (plan.pageClassName) {
      totalAssessed++;
      if (!/^[A-Z][a-zA-Z0-9]*Page$/.test(plan.pageClassName)) {
        violations.push({
          kind: 'CLASS_NAME_CASING',
          message: `Class name '${plan.pageClassName}' must be PascalCase and end with 'Page'`,
          identifier: plan.pageClassName,
        });
      }

      // Detect flattened casing (e.g. OrderreviewPage vs OrderReviewPage)
      const base = plan.pageClassName.replace(/Page$/, '');
      const words = extractWords(base);
      if (words.length === 1 && words[0]!.length > 8 && /^[A-Z][a-z]+$/.test(words[0]!)) {
        // Known compound keywords that should not be flattened
        const commonCompounds = ['orderreview', 'userlogin', 'customersignup', 'productsearch', 'shoppingcart'];
        if (commonCompounds.some((c) => words[0]!.toLowerCase().includes(c))) {
          violations.push({
            kind: 'CLASS_NAME_CASING',
            message: `Class name '${plan.pageClassName}' exhibits flattened compound casing`,
            identifier: plan.pageClassName,
          });
        }
      }
    }

    for (let stepIndex = 0; stepIndex < plan.symbols.length; stepIndex++) {
      const sym = plan.symbols[stepIndex]!;
      const expectedNum = stepIndex + 1;

      // 1. Check property
      totalAssessed++;

      // Check positional correlation for index derivation
      const propDigitMatch = sym.property.match(/\d+$/);
      const isPropPositionalIndex = propDigitMatch && (parseInt(propDigitMatch[0], 10) === expectedNum || parseInt(propDigitMatch[0], 10) === stepIndex);
      const isPropGenericIndexed = /^(actionButton|inputField|button|input|action|field|element)\d+$/i.test(sym.property);

      if (isPropPositionalIndex || isPropGenericIndexed) {
        indexDerivedCount++;
        violations.push({
          kind: 'INDEX_DERIVED_IDENTIFIER',
          message: `Property '${sym.property}' is derived from a raw index (matched step ${expectedNum})`,
          identifier: sym.property,
          ref: sym.ref,
        });
      }

      // Check duplicate adjacent words
      if (hasDuplicateAdjacentWords(sym.property)) {
        violations.push({
          kind: 'DUPLICATE_WORD_IN_IDENTIFIER',
          message: `Property '${sym.property}' contains duplicated adjacent word`,
          identifier: sym.property,
          ref: sym.ref,
        });
      }

      if (seenProperties.has(sym.property)) {
        duplicateCount++;
        violations.push({
          kind: 'DUPLICATE_PROPERTY',
          message: `Duplicate property '${sym.property}' declared in Page Object`,
          identifier: sym.property,
          ref: sym.ref,
        });
      }
      seenProperties.add(sym.property);

      if (RESERVED_WORDS.has(sym.property.toLowerCase())) {
        violations.push({
          kind: 'RESERVED_WORD_COLLISION',
          message: `Property '${sym.property}' collides with reserved language keyword`,
          identifier: sym.property,
          ref: sym.ref,
        });
      }

      // 2. Check method
      totalAssessed++;

      const methodDigitMatch = sym.method.match(/\d+$/);
      const isMethodPositionalIndex = methodDigitMatch && (parseInt(methodDigitMatch[0], 10) === expectedNum || parseInt(methodDigitMatch[0], 10) === stepIndex);
      const isMethodGenericIndexed = /^(click|fill|action|perform|open)\d+$/i.test(sym.method);

      if (isMethodPositionalIndex || isMethodGenericIndexed) {
        indexDerivedCount++;
        violations.push({
          kind: 'INDEX_DERIVED_IDENTIFIER',
          message: `Method '${sym.method}' is derived from a raw index (matched step ${expectedNum})`,
          identifier: sym.method,
          ref: sym.ref,
        });
      }

      // Check duplicate adjacent words
      if (hasDuplicateAdjacentWords(sym.method)) {
        violations.push({
          kind: 'DUPLICATE_WORD_IN_IDENTIFIER',
          message: `Method '${sym.method}' contains duplicated adjacent word`,
          identifier: sym.method,
          ref: sym.ref,
        });
      }

      if (seenMethods.has(sym.method)) {
        duplicateCount++;
        violations.push({
          kind: 'DUPLICATE_METHOD',
          message: `Duplicate method '${sym.method}' declared in Page Object`,
          identifier: sym.method,
          ref: sym.ref,
        });
      }
      seenMethods.add(sym.method);

      if (RESERVED_WORDS.has(sym.method.toLowerCase())) {
        violations.push({
          kind: 'RESERVED_WORD_COLLISION',
          message: `Method '${sym.method}' collides with reserved language keyword`,
          identifier: sym.method,
          ref: sym.ref,
        });
      }

      if (!ALLOWED_VERBS.has(sym.verb)) {
        violations.push({
          kind: 'MISSING_VERB',
          message: `Method '${sym.method}' has unapproved verb '${sym.verb}'`,
          identifier: sym.method,
          ref: sym.ref,
        });
      }

      // 3. Check semantic overlap with accessibleName (evaluating BOTH property and method)
      if (sym.accessibleName && sym.accessibleName.trim().length > 0) {
        const tokens = sym.accessibleName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const propLower = sym.property.toLowerCase();
        const methodLower = sym.method.toLowerCase();
        const meaningfulTokens = tokens.filter((t) => t.length > 2 && !['the', 'and', 'for', 'with'].includes(t));
        const candidateTerms = [
          ...meaningfulTokens,
          ...meaningfulTokens.flatMap((t) => SEMANTIC_SYNONYMS[t] ?? []),
        ];

        const propOverlap = candidateTerms.some((t) => propLower.includes(t));
        const methodOverlap = candidateTerms.some((t) => methodLower.includes(t));

        if (propOverlap && methodOverlap) {
          semanticMatches++;
        } else {
          // Zero semantic overlap violation: applies to both heuristic and LLM sources
          violations.push({
            kind: 'ZERO_SEMANTIC_OVERLAP',
            message: `Symbol '${sym.property}'/'${sym.method}' shares insufficient semantic tokens with accessible name '${sym.accessibleName}'`,
            identifier: `${sym.property} / ${sym.method}`,
            ref: sym.ref,
          });
        }
      } else if (GENERIC_ROLE_NAME_RE.test(sym.property)) {
        violations.push({
          kind: 'UNGROUNDED_IDENTIFIER',
          message: `Property '${sym.property}' is a generic role-derived name with no accessible name`,
          identifier: sym.property,
          ref: sym.ref,
        });
      }
      // Note: If no accessibleName is provided, semanticMatches is NOT incremented (absent evidence is not covered)
    }

    const totalSymbols = plan.symbols.length;
    // Empty denominator rule: n === 0 -> null (never 1.0 or 100%)
    const semanticNameCoverage = totalSymbols > 0 ? Number((semanticMatches / totalSymbols).toFixed(4)) : null;
    const nonViolating = Math.max(0, totalAssessed - violations.length);
    const namingConformanceRate = totalAssessed > 0 ? Number((nonViolating / totalAssessed).toFixed(4)) : null;

    return {
      passed: violations.length === 0 && totalAssessed > 0 && totalSymbols > 0,
      violations,
      totalIdentifiers: totalAssessed,
      indexDerivedIdentifierCount: indexDerivedCount,
      duplicateSymbolCount: duplicateCount,
      semanticNameCoverage,
      namingConformanceRate,
    };
  }
}
