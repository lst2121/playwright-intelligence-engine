import { UnifiedEvidenceRecord, RedactionStatus } from './evidence-model.js';

export class EvidenceRedactor {
  private static readonly SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'proxy-authorization',
    'proxy-authenticate',
    'www-authenticate',
    'session-token',
    'access-token',
  ]);

  private static readonly SENSITIVE_FIELD_PATTERNS = [
    /pass(word)?/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /bearer/i,
    /credit[_-]?card/i,
    /cvv/i,
    /ssn/i,
    /social[_-]?security/i,
    /private[_-]?key/i,
  ];

  private static readonly PATTERNS = [
    {
      name: 'BEARER_TOKEN',
      regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      replacement: 'Bearer [REDACTED]',
    },
    {
      name: 'JWT_TOKEN',
      regex: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
      replacement: '[JWT_TOKEN_REDACTED]',
    },
    {
      name: 'CREDIT_CARD',
      // 13-19 digits with optional spaces or dashes
      regex: /\b(?:\d[ -]*?){13,19}\b/g,
      replacement: '[CARD_REDACTED]',
    },
    {
      name: 'SSN',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: '[SSN_REDACTED]',
    },
    {
      name: 'BASIC_AUTH_URL',
      regex: /https?:\/\/[^:]+:[^@]+@/gi,
      replacement: 'https://[USER:PASS_REDACTED]@',
    },
  ];

  /**
   * Redacts sensitive string patterns such as JWT tokens, credit cards, SSNs, and passwords.
   */
  public static redactText(text: string): { redactedText: string; rulesApplied: string[] } {
    if (!text || typeof text !== 'string') {
      return { redactedText: text, rulesApplied: [] };
    }

    let result = text;
    const rulesApplied: string[] = [];

    for (const rule of EvidenceRedactor.PATTERNS) {
      if (rule.regex.test(result)) {
        rulesApplied.push(rule.name);
        result = result.replace(rule.regex, rule.replacement);
      }
      // Reset regex state if global
      rule.regex.lastIndex = 0;
    }

    return { redactedText: result, rulesApplied };
  }

  /**
   * Redacts sensitive HTTP header maps.
   */
  public static redactHeaders(headers?: Record<string, string>): {
    redactedHeaders: Record<string, string>;
    redactedFields: string[];
  } {
    if (!headers || typeof headers !== 'object') {
      return { redactedHeaders: {}, redactedFields: [] };
    }

    const redactedHeaders: Record<string, string> = {};
    const redactedFields: string[] = [];

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (EvidenceRedactor.SENSITIVE_HEADER_KEYS.has(lower)) {
        redactedHeaders[key] = '[REDACTED]';
        redactedFields.push(key);
      } else {
        const { redactedText, rulesApplied } = EvidenceRedactor.redactText(String(value));
        redactedHeaders[key] = redactedText;
        if (rulesApplied.length > 0) {
          redactedFields.push(key);
        }
      }
    }

    return { redactedHeaders, redactedFields };
  }

  /**
   * Recursively redacts objects, arrays, and primitive payload fields.
   */
  public static redactPayload(payload: any): {
    redactedPayload: any;
    redactedFields: string[];
    rulesApplied: string[];
  } {
    const redactedFields: string[] = [];
    const rulesApplied: string[] = [];

    function recurse(value: any, path: string): any {
      if (value === null || value === undefined) {
        return value;
      }

      if (typeof value === 'string') {
        const { redactedText, rulesApplied: applied } = EvidenceRedactor.redactText(value);
        if (applied.length > 0) {
          redactedFields.push(path);
          for (const rule of applied) {
            if (!rulesApplied.includes(rule)) rulesApplied.push(rule);
          }
        }
        return redactedText;
      }

      if (Array.isArray(value)) {
        return value.map((item, idx) => recurse(item, `${path}[${idx}]`));
      }

      if (typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          const currentPath = path ? `${path}.${k}` : k;
          const isSensitiveField = EvidenceRedactor.SENSITIVE_FIELD_PATTERNS.some((p) => p.test(k));

          if (isSensitiveField) {
            result[k] = '[REDACTED]';
            redactedFields.push(currentPath);
            if (!rulesApplied.includes('SENSITIVE_FIELD_KEY')) {
              rulesApplied.push('SENSITIVE_FIELD_KEY');
            }
          } else {
            result[k] = recurse(v, currentPath);
          }
        }
        return result;
      }

      return value;
    }

    const redactedPayload = recurse(payload, '');
    return { redactedPayload, redactedFields, rulesApplied };
  }

  /**
   * Sanitizes DOM HTML strings, scrubbing passwords, secret inputs, tokens, and PII.
   */
  public static redactDomContent(html: string): string {
    if (!html || typeof html !== 'string') return '';
    let clean = html;
    // 1. Password input values
    clean = clean.replace(/(<input[^>]*type=["']password["'][^>]*value=["'])([^"']*)(["'])/gi, '$1[REDACTED]$3');
    // 2. Hidden input tokens
    clean = clean.replace(/(<input[^>]*name=["'](?:csrf|token|secret|auth|apikey|api_key)["'][^>]*value=["'])([^"']*)(["'])/gi, '$1[REDACTED]$3');
    // 3. General pattern redaction (Bearer, JWT, CC, SSN)
    clean = EvidenceRedactor.redactText(clean).redactedText;
    return clean;
  }

  /**
   * Enforces complete redaction across a UnifiedEvidenceRecord.
   */
  public static redactRecord(record: UnifiedEvidenceRecord): UnifiedEvidenceRecord {
    let rawPayload = record.payload;
    if (record.evidenceType === 'dom-snapshot' && rawPayload?.html) {
      rawPayload = {
        ...rawPayload,
        html: EvidenceRedactor.redactDomContent(rawPayload.html),
      };
    }

    const { redactedPayload, redactedFields, rulesApplied } = EvidenceRedactor.redactPayload(rawPayload);

    const existingFields = record.redactionStatus.redactedFields ?? [];
    const existingRules = record.redactionStatus.redactionRulesApplied ?? [];

    const mergedFields = Array.from(new Set([...existingFields, ...redactedFields]));
    const mergedRules = Array.from(new Set([...existingRules, ...rulesApplied]));

    const redactionStatus: RedactionStatus = {
      isRedacted: mergedFields.length > 0 || record.redactionStatus.isRedacted,
      redactedFields: mergedFields,
      redactionRulesApplied: mergedRules,
    };

    return {
      ...record,
      payload: redactedPayload,
      redactionStatus,
    };
  }
}

