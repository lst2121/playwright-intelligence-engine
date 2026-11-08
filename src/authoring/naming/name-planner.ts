import type { GeneratedStep } from '../../generator/test-generator.js';
import type { NamePlan, SymbolEntry } from './name-plan.js';

const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'enum', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'await', 'abstract', 'boolean', 'byte', 'char', 'double', 'final', 'float',
  'goto', 'int', 'long', 'native', 'short', 'synchronized', 'throws', 'transient', 'volatile',
  'page', 'constructor', 'click', 'fill', 'expect', 'locator', 'waitFor', 'reload', 'close',
]);

const ROLE_SUFFIXES: Record<string, string> = {
  button: 'Button',
  textbox: 'Input',
  input: 'Input',
  searchbox: 'SearchInput',
  link: 'Link',
  checkbox: 'Checkbox',
  combobox: 'Select',
  listbox: 'Select',
  select: 'Select',
  cell: 'Cell',
  heading: 'Heading',
  dialog: 'Dialog',
  status: 'Status',
  tab: 'Tab',
  radio: 'Radio',
};

const ARTICLES = new Set(['a', 'an', 'the']);

export function stripArticles(text: string): string {
  const words = text.trim().split(/\s+/);
  const filtered = words.filter((w) => !ARTICLES.has(w.toLowerCase()));
  return filtered.length > 0 ? filtered.join(' ') : text.trim();
}

export function toPascalCase(text: string): string {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g);
  if (!words || words.length === 0) return 'Element';
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');
}

export function toCamelCase(text: string): string {
  const pascal = toPascalCase(text);
  if (!pascal) return 'element';
  return pascal[0]!.toLowerCase() + pascal.slice(1);
}

export function sanitizeIdentifier(identifier: string, suffixFallback = 'Element'): string {
  let cleaned = identifier.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    cleaned = `${suffixFallback.toLowerCase()}${cleaned}`;
  }
  if (RESERVED_WORDS.has(cleaned.toLowerCase())) {
    cleaned = `${cleaned}${suffixFallback}`;
  }
  return cleaned;
}

export function extractPageName(featureOrTitle: string): { className: string; variable: string } {
  const lower = featureOrTitle.toLowerCase();
  let canonicalName: string | undefined;

  if (/\b(login|log\s*in|sign\s*in|auth|authenticate)\b/i.test(lower)) {
    canonicalName = 'LoginPage';
  } else if (/\b(register|sign\s*up|registration|signup)\b/i.test(lower)) {
    canonicalName = 'RegisterPage';
  } else if (/\b(checkout|pay|payment)\b/i.test(lower)) {
    canonicalName = 'CheckoutPage';
  } else if (/\b(cart|basket)\b/i.test(lower)) {
    canonicalName = 'CartPage';
  } else if (/\b(dashboard|home)\b/i.test(lower)) {
    canonicalName = 'DashboardPage';
  } else if (/\b(profile|account|setting)\b/i.test(lower)) {
    canonicalName = 'ProfilePage';
  } else if (/\b(product|catalog|search)\b/i.test(lower)) {
    canonicalName = 'ProductsPage';
  } else if (/\b(admin)\b/i.test(lower)) {
    canonicalName = 'AdminPage';
  }

  if (canonicalName) {
    const variable = canonicalName[0]!.toLowerCase() + canonicalName.slice(1);
    return { className: canonicalName, variable };
  }

  // Strip common testing / scenario noise
  let cleaned = featureOrTitle
    .replace(/\b(should|complete|workflow|flow|spec|test|sanity|suite|journey|scenario)\b/gi, '')
    .replace(/\b(with|for|and|using|valid|invalid|empty|wrong|credentials)\b/gi, '')
    .replace(/\b(user|admin|customer|client)\b/gi, '')
    .trim();

  // If stripping left empty or too short, revert to original
  if (!cleaned || cleaned.length < 3) {
    cleaned = featureOrTitle;
  }

  const words = cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g) ?? ['Feature'];
  // Keep meaningful domain words up to 3 words
  const domainWords = words.slice(0, 3);
  let baseName = domainWords.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');

  if (!baseName.endsWith('Page')) {
    baseName = `${baseName}Page`;
  }

  const className = sanitizeIdentifier(baseName, 'Page');
  const variable = className[0]!.toLowerCase() + className.slice(1);
  return { className, variable };
}

export function derivePropertyIdentifier(step: GeneratedStep, roleSuffix: string): { property: string; isFallback: boolean } {
  const rawName = step.name ?? step.selector;
  if (rawName) {
    const stripped = stripArticles(rawName);
    const words = stripped
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .match(/[A-Za-z0-9]+/g);
    if (words && words.length > 0) {
      const base = toCamelCase(stripped);
      const lowerBase = base.toLowerCase();
      const lowerSuffix = roleSuffix.toLowerCase();
      let property = base;
      if (!lowerBase.endsWith(lowerSuffix)) {
        if (lowerSuffix === 'searchinput' && lowerBase.endsWith('search')) {
          property = `${base}Input`;
        } else {
          property = `${base}${roleSuffix}`;
        }
      }
      return { property: sanitizeIdentifier(property, roleSuffix), isFallback: false };
    }
  }

  // Fallback when no semantic name exists
  const role = step.role ?? (step.action === 'fill' ? 'textbox' : 'button');
  const roleBase = toCamelCase(role);
  let fallbackBase = roleBase;
  if (roleBase.toLowerCase() === roleSuffix.toLowerCase()) {
    fallbackBase = role === 'button' ? 'action' : 'input';
  }
  const fallback = sanitizeIdentifier(`${fallbackBase}${roleSuffix}`, roleSuffix);
  return { property: fallback, isFallback: true };
}

export function deriveMethodIdentifier(step: GeneratedStep, propertyName: string): { method: string; verb: string } {
  const rawName = step.name ?? step.selector;
  const stripped = rawName ? stripArticles(rawName) : '';
  const pascalTarget = stripped ? toPascalCase(stripped) : toPascalCase(propertyName);

  const formatWithVerb = (verb: string, target: string): string => {
    const lowerVerb = verb.toLowerCase();
    const lowerTarget = target.toLowerCase();
    if (lowerTarget.startsWith(lowerVerb)) {
      const remainder = target.slice(verb.length);
      return sanitizeIdentifier(remainder.length > 0 ? `${verb}${remainder}` : verb, 'Action');
    }
    return sanitizeIdentifier(`${verb}${target}`, 'Action');
  };

  if (step.action === 'fill') {
    return {
      method: formatWithVerb('fill', pascalTarget),
      verb: 'fill',
    };
  }

  if (step.action === 'click') {
    const lower = (rawName ?? '').toLowerCase();
    const roleLower = (step.role ?? '').toLowerCase();
    if (roleLower === 'link' || roleLower === 'tab' || /\b(open|goto|go\s*to|home|back|nav|view|plans|settings)\b/.test(lower)) {
      return { method: formatWithVerb('open', pascalTarget), verb: 'open' };
    }
    if (/\b(sign\s*in|log\s*in|login|signin)\b/.test(lower)) {
      return { method: sanitizeIdentifier('signIn', 'Action'), verb: 'signIn' };
    }
    if (/\b(sign\s*up|register)\b/.test(lower)) {
      return { method: sanitizeIdentifier('signUp', 'Action'), verb: 'signUp' };
    }
    if (/\b(submit|send|confirm|save|apply|checkout)\b/.test(lower)) {
      return { method: formatWithVerb('submit', pascalTarget), verb: 'submit' };
    }
    return {
      method: formatWithVerb('click', pascalTarget),
      verb: 'click',
    };
  }

  if (step.action === 'assert-visible') {
    return {
      method: sanitizeIdentifier(`expect${pascalTarget}Visible`, 'Action'),
      verb: 'expectVisible',
    };
  }

  if (step.action === 'assert-text') {
    return {
      method: sanitizeIdentifier(`expect${pascalTarget}Text`, 'Action'),
      verb: 'expectText',
    };
  }

  return {
    method: sanitizeIdentifier(`perform${pascalTarget}`, 'Action'),
    verb: 'perform',
  };
}

export class NamePlanner {
  public static planNames(
    featureOrTitle: string,
    steps: GeneratedStep[],
    options?: { existingPageClassName?: string; source?: 'llm' | 'heuristic' }
  ): NamePlan {
    const assumptions: string[] = [];
    const source = options?.source ?? 'heuristic';
    const page = options?.existingPageClassName
      ? { className: options.existingPageClassName, variable: options.existingPageClassName[0]!.toLowerCase() + options.existingPageClassName.slice(1) }
      : extractPageName(featureOrTitle);

    const symbols: SymbolEntry[] = [];
    const usedProperties = new Set<string>();
    const usedMethods = new Set<string>();

    const disambiguationQualifiers = ['primary', 'secondary', 'confirm', 'alternate', 'detail', 'modal', 'auxiliary'];

    steps.forEach((step, idx) => {
      const ref = `step-${idx + 1}`;
      const role = step.role ?? (step.action === 'fill' ? 'textbox' : step.action === 'click' ? 'button' : undefined);
      const roleSuffix = ROLE_SUFFIXES[role?.toLowerCase() ?? ''] ?? (step.action === 'fill' ? 'Input' : 'Button');

      const propResult = derivePropertyIdentifier(step, roleSuffix);
      let property = propResult.property;

      if (propResult.isFallback) {
        assumptions.push(`Step ${ref} has no accessible name; generated generic semantic property '${property}'`);
      }

      // Disambiguate property collisions using semantic qualifiers, NEVER by bare index numbers
      if (usedProperties.has(property)) {
        let disambiguated = false;
        for (const qualifier of disambiguationQualifiers) {
          const candidate = `${qualifier}${property[0]!.toUpperCase()}${property.slice(1)}`;
          if (!usedProperties.has(candidate)) {
            assumptions.push(`Property name collision for '${property}'; disambiguated to '${candidate}'`);
            property = candidate;
            disambiguated = true;
            break;
          }
        }
        if (!disambiguated) {
          property = `${property}Alt`;
        }
      }
      usedProperties.add(property);

      const methodResult = deriveMethodIdentifier(step, property);
      let method = methodResult.method;

      // Disambiguate method collisions
      if (usedMethods.has(method)) {
        let disambiguated = false;
        for (const qualifier of disambiguationQualifiers) {
          const candidate = `${methodResult.verb}${qualifier[0]!.toUpperCase()}${qualifier.slice(1)}`;
          if (!usedMethods.has(candidate)) {
            assumptions.push(`Method name collision for '${method}'; disambiguated to '${candidate}'`);
            method = candidate;
            disambiguated = true;
            break;
          }
        }
        if (!disambiguated) {
          method = `${method}Alt`;
        }
      }
      usedMethods.add(method);

      symbols.push({
        ref,
        role: step.role,
        accessibleName: step.name,
        property,
        method,
        verb: methodResult.verb,
        confidence: propResult.isFallback ? 0.75 : 0.95,
        source,
        assumptions: [],
      });
    });

    return {
      planVersion: '1',
      pageClassName: page.className,
      pageVariable: page.variable,
      symbols,
      assumptions,
    };
  }
}
