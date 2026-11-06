import { TraceAdapter, ArchiveManifest, AdapterValidationResult } from './trace-adapter.js';
import { DiagnosticContext } from '../../core/types/diagnostic-context.js';
import { TraceParser } from '../trace-parser.js';
import { VersionDetector } from '../version-detector.js';

/** Compatibility adapter for Playwright 1.32-era trace format v4. */
export class V4TraceAdapter implements TraceAdapter {
  public readonly adapterVersion = '1.0.0-v4';
  public readonly supportedFormatVersions = [4];

  public canParse(_manifest: ArchiveManifest, sampleLines: string[]): boolean {
    const versionInfo = VersionDetector.detectFromLines(sampleLines);
    return this.supportedFormatVersions.includes(versionInfo.traceFormatVersion);
  }

  public async parse(
    _manifest: ArchiveManifest,
    traceLines: string[],
    networkLines: string[],
  ): Promise<DiagnosticContext> {
    return TraceParser.assembleDiagnosticContext(traceLines, networkLines);
  }

  public validate(context: DiagnosticContext): AdapterValidationResult {
    const warnings: string[] = [];
    if (!context.failedAction.callId || context.failedAction.callId === 'unknown') {
      warnings.push('Action callId could not be definitively extracted from legacy v4 trace');
    }
    return { isValid: true, errors: [], warnings };
  }
}
