import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

export interface RawNetworkEvent {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  timestamp?: number;
  durationMs?: number;
  errorText?: string;
  requestId?: string;
  frameId?: string;
  resourceType?: string;
  initiator?: string;
  postData?: string;
  responseBody?: string;
}

export interface NetworkCollectorInput {
  events: RawNetworkEvent[];
  executionId?: string;
}

export class NetworkCollector implements EvidenceCollector<NetworkCollectorInput> {
  public readonly name = 'NetworkCollector';
  public readonly source = 'network' as const;

  public async collect(input: NetworkCollectorInput): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const records: UnifiedEvidenceRecord[] = [];

    for (const evt of input.events) {
      const timestamp = evt.timestamp ?? Date.now();
      const { redactedHeaders, redactedFields: headerRedactions } = EvidenceRedactor.redactHeaders(
        evt.headers
      );
      const { redactedText: cleanUrl, rulesApplied: urlRules } = EvidenceRedactor.redactText(evt.url);
      const { redactedText: cleanError } = EvidenceRedactor.redactText(evt.errorText ?? '');

      let cleanPostData: string | undefined;
      if (evt.postData) {
        cleanPostData = EvidenceRedactor.redactText(evt.postData).redactedText;
      }

      const isError = evt.status >= 400 || Boolean(evt.errorText);
      const allRedactedFields = [...headerRedactions];
      if (urlRules.length > 0) allRedactedFields.push('url');

      records.push({
        evidenceId: `net-${evt.requestId || Math.random().toString(36).slice(2, 8)}`,
        executionId,
        source: 'network',
        timestamp,
        requestId: evt.requestId,
        frameId: evt.frameId,
        evidenceType: 'http-response',
        payload: {
          url: cleanUrl,
          method: evt.method,
          status: evt.status,
          statusText: evt.statusText,
          headers: redactedHeaders,
          durationMs: evt.durationMs,
          errorText: cleanError,
          resourceType: evt.resourceType,
          initiator: evt.initiator,
          isError,
          postData: cleanPostData,
        },
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: timestamp,
          captureMethod: 'cdp-network-interception',
          sourceUri: cleanUrl,
        },
        redactionStatus: {
          isRedacted: allRedactedFields.length > 0,
          redactedFields: allRedactedFields,
        },
      });
    }

    return records;
  }
}

