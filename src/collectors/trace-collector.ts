import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceNormalizer } from '../evidence/evidence-normalizer.js';

export interface TraceCollectorInput {
  archivePath: string;
  executionId?: string;
}

export class TraceCollector implements EvidenceCollector<TraceCollectorInput> {
  public readonly name = 'TraceCollector';
  public readonly source = 'trace' as const;

  public async collect(input: TraceCollectorInput): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const timestamp = Date.now();

    try {
      const { traceEntryName, networkEntryName } = ArchiveReader.findTraceFileEntries(input.archivePath);
      if (!traceEntryName) {
        throw new Error(`No .trace entry found inside archive: ${input.archivePath}`);
      }
      const traceText = await ArchiveReader.readEntryAsText(input.archivePath, traceEntryName);
      const networkText = networkEntryName
        ? await ArchiveReader.readEntryAsText(input.archivePath, networkEntryName)
        : '';
      const traceLines = traceText.split('\n');
      const networkLines = networkText ? networkText.split('\n') : [];
      const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);

      const records = EvidenceNormalizer.fromDiagnosticContext(context, executionId);

      // Enhance provenance with archive file path
      for (const rec of records) {
        rec.provenance.sourceUri = input.archivePath;
      }

      return records;
    } catch (err: any) {
      return [
        {
          evidenceId: `trace-err-${timestamp}`,
          executionId,
          source: 'trace',
          timestamp,
          evidenceType: 'trace-ingestion-failure',
          payload: {
            archivePath: input.archivePath,
            error: err?.message || 'Failed to parse trace archive',
          },
          reliability: 'LOW',
          provenance: {
            collector: this.name,
            collectedAt: timestamp,
            captureMethod: 'archive-reader',
            sourceUri: input.archivePath,
          },
          redactionStatus: { isRedacted: false },
          limitations: [err?.message || 'Trace parse failure'],
        },
      ];
    }
  }
}
