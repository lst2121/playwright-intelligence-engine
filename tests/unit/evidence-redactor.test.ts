import { describe, it, expect } from 'vitest';
import { EvidenceRedactor } from '../../src/evidence/evidence-redactor.js';
import { UnifiedEvidenceRecord } from '../../src/evidence/evidence-model.js';

describe('EvidenceRedactor Suite', () => {
  it('should redact Bearer tokens from text', () => {
    const raw = 'Authorization failed with Bearer secret-token-xyz123_456-abc';
    const { redactedText, rulesApplied } = EvidenceRedactor.redactText(raw);
    expect(redactedText).toBe('Authorization failed with Bearer [REDACTED]');
    expect(rulesApplied).toContain('BEARER_TOKEN');
  });

  it('should redact JWT tokens from text', () => {
    const raw = 'Error during call with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c in payload';
    const { redactedText, rulesApplied } = EvidenceRedactor.redactText(raw);
    expect(redactedText).toContain('[JWT_TOKEN_REDACTED]');
    expect(rulesApplied).toContain('JWT_TOKEN');
  });

  it('should redact Credit Card numbers (PANs) from text', () => {
    const raw = 'Transaction failed for card 4532-1488-2940-5839';
    const { redactedText, rulesApplied } = EvidenceRedactor.redactText(raw);
    expect(redactedText).toBe('Transaction failed for card [CARD_REDACTED]');
    expect(rulesApplied).toContain('CREDIT_CARD');
  });

  it('should redact Social Security Numbers (SSNs) from text', () => {
    const raw = 'Customer SSN is 000-12-3456 in application profile';
    const { redactedText, rulesApplied } = EvidenceRedactor.redactText(raw);
    expect(redactedText).toBe('Customer SSN is [SSN_REDACTED] in application profile');
    expect(rulesApplied).toContain('SSN');
  });

  it('should redact Basic Auth credentials embedded in URLs', () => {
    const raw = 'Connecting to https://admin:SuperSecret123@internal.corp.com/api/v1';
    const { redactedText, rulesApplied } = EvidenceRedactor.redactText(raw);
    expect(redactedText).toBe('Connecting to https://[USER:PASS_REDACTED]@internal.corp.com/api/v1');
    expect(rulesApplied).toContain('BASIC_AUTH_URL');
  });

  it('should redact sensitive HTTP headers', () => {
    const headers = {
      'content-type': 'application/json',
      Authorization: 'Bearer my-token-12345',
      Cookie: 'session_id=abcdef123456789; secure',
      'X-Api-Key': 'my-custom-key-999',
      'user-agent': 'Playwright/1.40.0',
    };

    const { redactedHeaders, redactedFields } = EvidenceRedactor.redactHeaders(headers);
    expect(redactedHeaders['content-type']).toBe('application/json');
    expect(redactedHeaders['Authorization']).toBe('[REDACTED]');
    expect(redactedHeaders['Cookie']).toBe('[REDACTED]');
    expect(redactedHeaders['X-Api-Key']).toBe('[REDACTED]');
    expect(redactedHeaders['user-agent']).toBe('Playwright/1.40.0');
    expect(redactedFields).toEqual(
      expect.arrayContaining(['Authorization', 'Cookie', 'X-Api-Key'])
    );
  });

  it('should recursively redact payload objects containing sensitive keys and values', () => {
    const payload = {
      username: 'john_doe',
      password: 'MyPassword123!',
      nested: {
        apiKey: 'secret-key-123',
        description: 'Call failed with Bearer secret-tok-999',
      },
      list: ['normal item', 'token: eyJhbGciOi.eyJzdWIi.SflKxw'],
    };

    const { redactedPayload, redactedFields, rulesApplied } = EvidenceRedactor.redactPayload(payload);
    expect(redactedPayload.password).toBe('[REDACTED]');
    expect(redactedPayload.nested.apiKey).toBe('[REDACTED]');
    expect(redactedPayload.nested.description).toBe('Call failed with Bearer [REDACTED]');
    expect(redactedPayload.list[0]).toBe('normal item');
    expect(redactedPayload.list[1]).toContain('[JWT_TOKEN_REDACTED]');
    expect(redactedFields).toContain('password');
    expect(redactedFields).toContain('nested.apiKey');
    expect(rulesApplied).toContain('SENSITIVE_FIELD_KEY');
    expect(rulesApplied).toContain('BEARER_TOKEN');
  });

  it('should redact a complete UnifiedEvidenceRecord and record redaction provenance', () => {
    const record: UnifiedEvidenceRecord = {
      evidenceId: 'rec-1',
      executionId: 'exec-1',
      source: 'network',
      timestamp: 123456789,
      evidenceType: 'http-response',
      payload: {
        url: 'https://admin:pass@api.test.com/v1',
        headers: {
          authorization: 'Bearer token-123',
        },
        body: {
          creditCard: '4111-2222-3333-4444',
        },
      },
      reliability: 'HIGH',
      provenance: {
        collector: 'NetworkCollector',
        collectedAt: 123456789,
        captureMethod: 'cdp',
      },
      redactionStatus: {
        isRedacted: false,
      },
    };

    const redacted = EvidenceRedactor.redactRecord(record);
    expect(redacted.redactionStatus.isRedacted).toBe(true);
    expect(redacted.payload.url).toBe('https://[USER:PASS_REDACTED]@api.test.com/v1');
    expect(redacted.payload.body.creditCard).toBe('[REDACTED]');
  });
});
