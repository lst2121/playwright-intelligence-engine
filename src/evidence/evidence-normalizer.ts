import {
  UnifiedEvidenceRecord,
  EvidenceScorecard,
  EvidenceSource,
} from './evidence-model.js';
import {
  DiagnosticContext,
  NetworkEvent,
  ConsoleEvent,
  FailedAction,
} from '../core/types/diagnostic-context.js';

export class EvidenceNormalizer {
  private static readonly ALL_SOURCES: EvidenceSource[] = [
    'trace',
    'live-browser',
    'console',
    'network',
    'static-ast',
    'git-diff',
    'environment',
    'error',
  ];

  /**
   * Computes an EvidenceScorecard summarizing the presence and completeness of all evidence channels.
   */
  public static calculateScorecard(records: UnifiedEvidenceRecord[]): EvidenceScorecard {
    const presentSources = new Set<EvidenceSource>(records.map((r) => r.source));

    const playwrightErrorAvailable = records.some(
      (r) => r.source === 'error' || r.evidenceType === 'playwright-error' || Boolean(r.payload?.errorMessage)
    );
    const testSourceAstAvailable = records.some(
      (r) => r.source === 'static-ast' || r.evidenceType === 'ast-analysis'
    );
    const domSnapshotAvailable = records.some(
      (r) => r.evidenceType === 'dom-snapshot' || r.evidenceType === 'accessibility-tree' || Boolean(r.payload?.html || r.payload?.snapshot)
    );
    const consoleEventsAvailable = records.some(
      (r) => r.source === 'console' || r.evidenceType === 'console-entry' || r.evidenceType === 'console-event'
    );
    const networkEventsAvailable = records.some(
      (r) => r.source === 'network' || r.evidenceType === 'http-response' || r.evidenceType === 'http-request'
    );
    const traceArchiveAvailable = records.some((r) => r.source === 'trace');
    const gitHistoryAvailable = records.some((r) => r.source === 'git-diff');
    const environmentMetadataAvailable = records.some((r) => r.source === 'environment');

    const availableSources = Array.from(presentSources);
    const unavailableSources = EvidenceNormalizer.ALL_SOURCES.filter((s) => !presentSources.has(s));

    return {
      playwrightErrorAvailable,
      testSourceAstAvailable,
      domSnapshotAvailable,
      consoleEventsAvailable,
      networkEventsAvailable,
      traceArchiveAvailable,
      gitHistoryAvailable,
      environmentMetadataAvailable,
      totalRecordsCount: records.length,
      availableSources,
      unavailableSources,
    };
  }

  /**
   * Normalizes a collection of multi-source UnifiedEvidenceRecords into a structured DiagnosticContext.
   * This allows the failure classifier and repair pipeline to function without requiring a trace.zip file.
   */
  public static toDiagnosticContext(records: UnifiedEvidenceRecord[]): DiagnosticContext {
    // 1. Extract FailedAction
    let failedAction: FailedAction = {
      callId: 'multi-source-0',
      action: 'unknown',
    };

    const errorRecord = records.find(
      (r) => r.source === 'error' || r.evidenceType === 'playwright-error'
    );
    if (errorRecord && errorRecord.payload) {
      failedAction = {
        callId: errorRecord.actionId || errorRecord.evidenceId,
        action: errorRecord.payload.action || 'action',
        selector: errorRecord.payload.selector,
        sourceFile: errorRecord.payload.sourceFile,
        line: errorRecord.payload.line,
        column: errorRecord.payload.column,
        errorMessage: errorRecord.payload.errorMessage,
        errorStack: errorRecord.payload.errorStack,
        durationMs: errorRecord.payload.durationMs,
      };
    } else {
      // Fallback to any record with an errorMessage
      const fallbackRecord = records.find((r) => r.payload?.errorMessage);
      if (fallbackRecord) {
        failedAction = {
          callId: fallbackRecord.actionId || fallbackRecord.evidenceId,
          action: fallbackRecord.payload.action || 'action',
          selector: fallbackRecord.payload.selector,
          errorMessage: fallbackRecord.payload.errorMessage,
        };
      }
    }

    // 2. Extract DOM Snapshots
    const snapshots: { before?: string; action?: string; after?: string } = {};
    const domRecords = records.filter(
      (r) => r.evidenceType === 'dom-snapshot' || r.evidenceType === 'accessibility-tree'
    );
    for (const domRec of domRecords) {
      const html = domRec.payload.html || domRec.payload.snapshot || domRec.payload.content;
      if (html) {
        const phase = domRec.payload.phase || 'action';
        if (phase === 'before') snapshots.before = html;
        else if (phase === 'after') snapshots.after = html;
        else snapshots.action = html;
      }
    }

    // 3. Extract Network Events
    const networkEvents: NetworkEvent[] = [];
    const networkRecords = records.filter(
      (r) => r.source === 'network' || r.evidenceType === 'http-response' || r.evidenceType === 'http-request'
    );
    for (const netRec of networkRecords) {
      if (netRec.payload?.url) {
        networkEvents.push({
          url: netRec.payload.url,
          method: netRec.payload.method || 'GET',
          status: typeof netRec.payload.status === 'number' ? netRec.payload.status : 0,
          statusText: netRec.payload.statusText,
          headers: netRec.payload.headers,
          timestamp: netRec.timestamp,
          durationMs: netRec.payload.durationMs,
          errorText: netRec.payload.errorText,
          requestId: netRec.requestId || netRec.payload.requestId,
          frameId: netRec.frameId || netRec.payload.frameId,
          resourceType: netRec.payload.resourceType,
          initiator: netRec.payload.initiator,
        });
      }
    }

    // 4. Extract Console Events
    const consoleEvents: ConsoleEvent[] = [];
    const consoleRecords = records.filter(
      (r) => r.source === 'console' || r.evidenceType === 'console-entry' || r.evidenceType === 'console-event'
    );
    for (const conRec of consoleRecords) {
      if (conRec.payload?.text) {
        consoleEvents.push({
          type: conRec.payload.type || 'log',
          text: conRec.payload.text,
          timestamp: conRec.timestamp,
          location: conRec.payload.location,
        });
      }
    }

    // 5. Extract Environment Metadata
    const envRecord = records.find((r) => r.source === 'environment');
    const playwrightVersion = envRecord?.payload?.playwrightVersion || '1.40.0';
    const traceFormatVersion = envRecord?.payload?.traceFormatVersion || 0;

    const hasSnapshots = Object.keys(snapshots).length > 0;
    const hasNetwork = networkEvents.length > 0;
    const hasSource = records.some((r) => r.source === 'static-ast');

    return {
      playwrightVersion,
      traceFormatVersion,
      failedAction,
      snapshots,
      networkEvents,
      consoleEvents,
      evidenceCompleteness: {
        domAvailable: hasSnapshots,
        networkAvailable: hasNetwork,
        sourceAvailable: hasSource,
      },
    };
  }

  /**
   * Converts a DiagnosticContext into UnifiedEvidenceRecords.
   */
  public static fromDiagnosticContext(
    context: DiagnosticContext,
    executionId = `exec-${Date.now()}`
  ): UnifiedEvidenceRecord[] {
    const records: UnifiedEvidenceRecord[] = [];
    const now = Date.now();

    // 1. Error / Failed action
    records.push({
      evidenceId: `err-${context.failedAction.callId || '0'}`,
      executionId,
      source: 'error',
      timestamp: now,
      actionId: context.failedAction.callId,
      evidenceType: 'playwright-error',
      payload: {
        action: context.failedAction.action,
        selector: context.failedAction.selector,
        errorMessage: context.failedAction.errorMessage,
        errorStack: context.failedAction.errorStack,
        sourceFile: context.failedAction.sourceFile,
        line: context.failedAction.line,
        column: context.failedAction.column,
        durationMs: context.failedAction.durationMs,
      },
      reliability: 'HIGH',
      provenance: {
        collector: 'DiagnosticContextBridge',
        collectedAt: now,
        captureMethod: 'context-export',
      },
      redactionStatus: { isRedacted: false },
    });

    // 2. DOM Snapshots
    for (const [phase, html] of Object.entries(context.snapshots)) {
      if (html) {
        records.push({
          evidenceId: `dom-${phase}-${Date.now()}`,
          executionId,
          source: 'trace',
          timestamp: now,
          evidenceType: 'dom-snapshot',
          payload: { phase, html },
          reliability: 'HIGH',
          provenance: {
            collector: 'DiagnosticContextBridge',
            collectedAt: now,
            captureMethod: 'snapshot-extraction',
          },
          redactionStatus: { isRedacted: false },
        });
      }
    }

    // 3. Network Events
    let netIdx = 0;
    for (const net of context.networkEvents) {
      records.push({
        evidenceId: `net-${net.requestId || netIdx++}`,
        executionId,
        source: 'network',
        timestamp: net.timestamp || now,
        requestId: net.requestId,
        frameId: net.frameId,
        evidenceType: 'http-response',
        payload: {
          url: net.url,
          method: net.method,
          status: net.status,
          statusText: net.statusText,
          headers: net.headers,
          durationMs: net.durationMs,
          errorText: net.errorText,
          resourceType: net.resourceType,
          initiator: net.initiator,
        },
        reliability: 'HIGH',
        provenance: {
          collector: 'DiagnosticContextBridge',
          collectedAt: now,
          captureMethod: 'network-event',
        },
        redactionStatus: { isRedacted: false },
      });
    }

    // 4. Console Events
    let conIdx = 0;
    for (const con of context.consoleEvents) {
      records.push({
        evidenceId: `con-${conIdx++}`,
        executionId,
        source: 'console',
        timestamp: con.timestamp || now,
        evidenceType: 'console-entry',
        payload: {
          type: con.type,
          text: con.text,
          location: con.location,
        },
        reliability: 'MEDIUM',
        provenance: {
          collector: 'DiagnosticContextBridge',
          collectedAt: now,
          captureMethod: 'console-event',
        },
        redactionStatus: { isRedacted: false },
      });
    }

    // 5. Environment
    records.push({
      evidenceId: `env-${Date.now()}`,
      executionId,
      source: 'environment',
      timestamp: now,
      evidenceType: 'environment-metadata',
      payload: {
        playwrightVersion: context.playwrightVersion,
        traceFormatVersion: context.traceFormatVersion,
      },
      reliability: 'HIGH',
      provenance: {
        collector: 'DiagnosticContextBridge',
        collectedAt: now,
        captureMethod: 'environment-probe',
      },
      redactionStatus: { isRedacted: false },
    });

    return records;
  }
}
