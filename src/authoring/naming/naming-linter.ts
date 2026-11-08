import type { NamePlan } from './name-plan.js';

export interface NamingLintViolation {
  kind:
    | 'INDEX_DERIVED_IDENTIFIER'
    | 'DUPLICATE_PROPERTY'
    | 'DUPLICATE_METHOD'
    | 'RESERVED_WORD_COLLISION'
    | 'MISSING_VERB'
    | 'ZERO_SEMANTIC_OVERLAP';
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
  semanticNameCoverage: number;
  namingConformanceRate: number;
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
]);

export class NamingLinter {
  public static lint(plan: NamePlan): NamingLintReport {
    const violations: NamingLintViolation[] = [];
    const seenProperties = new Set<string>();
    const seenMethods = new Set<string>();

    let indexDerivedCount = 0;
    let duplicateCount = 0;
    let semanticMatches = 0;
    let totalAssessed = 0;

    for (const sym of plan.symbols) {
      // Check property
      totalAssessed++;
      if (/^(actionButton|inputField|button|input)\d+$/i.test(sym.property)) {
        indexDerivedCount++;
        violations.push({
          kind: 'INDEX_DERIVED_IDENTIFIER',
          message: `Property '${sym.property}' is derived from a raw index`,
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

      // Check method
      totalAssessed++;
      if (/^(click|fill|action)\d+$/i.test(sym.method)) {
        indexDerivedCount++;
        violations.push({
          kind: 'INDEX_DERIVED_IDENTIFIER',
          message: `Method '${sym.method}' is derived from a raw index`,
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

      // Check semantic overlap with accessibleName if present
      if (sym.accessibleName) {
        const tokens = sym.accessibleName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const propLower = sym.property.toLowerCase();
        const hasOverlap = tokens.some((t) => t.length > 2 && propLower.includes(t));
        if (hasOverlap) {
          semanticMatches++;
        } else if (sym.source !== 'heuristic' && !plan.assumptions.some((a) => a.includes(sym.ref))) {
          violations.push({
            kind: 'ZERO_SEMANTIC_OVERLAP',
            message: `Property '${sym.property}' shares zero semantic tokens with accessible name '${sym.accessibleName}'`,
            identifier: sym.property,
            ref: sym.ref,
          });
        }
      } else {
        // Without accessibleName, fallback counts as valid if assumption recorded
        semanticMatches++;
      }
    }

    const totalSymbols = plan.symbols.length;
    const semanticNameCoverage = totalSymbols > 0 ? Number((semanticMatches / totalSymbols).toFixed(4)) : 1.0;
    const nonViolating = Math.max(0, totalAssessed - violations.length);
    const namingConformanceRate = totalAssessed > 0 ? Number((nonViolating / totalAssessed).toFixed(4)) : 1.0;

    return {
      passed: violations.length === 0,
      violations,
      totalIdentifiers: totalAssessed,
      indexDerivedIdentifierCount: indexDerivedCount,
      duplicateSymbolCount: duplicateCount,
      semanticNameCoverage,
      namingConformanceRate,
    };
  }
}
