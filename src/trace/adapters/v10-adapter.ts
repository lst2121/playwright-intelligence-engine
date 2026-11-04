import { TraceAdapter, ArchiveManifest, AdapterValidationResult } from './trace-adapter.js';
import { DiagnosticContext } from '../../core/types/diagnostic-context.js';
import { TraceParser } from '../trace-parser.js';
import { VersionDetector } from '../version-detector.js';

export class V10TraceAdapter implements TraceAdapter {
  public readonly adapterVersion = '1.0.0-v10';
  public readonly supportedFormatVersions = [10];

  public canParse(_manifest: ArchiveManifest, sampleLines: string[]): boolean {
    const versionInfo = VersionDetector.detectFromLines(sampleLines);
    return this.supportedFormatVersions.includes(versionInfo.traceFormatVersion);
  }

  public async parse(
    _manifest: ArchiveManifest,
    traceLines: string[],
    networkLines: string[]
  ): Promise<DiagnosticContext> {
    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    return context;
  }

  public validate(context: DiagnosticContext): AdapterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!context.failedAction.callId || context.failedAction.callId === 'unknown') {
      warnings.push('Action callId could not be definitively extracted from modern v10 trace');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
