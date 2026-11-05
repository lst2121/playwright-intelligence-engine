import { TraceAdapter, ArchiveManifest, AdapterValidationResult } from './trace-adapter.js';
import { DiagnosticContext } from '../../core/types/diagnostic-context.js';
import { TraceParser } from '../trace-parser.js';
import { VersionDetector } from '../version-detector.js';

export class V8TraceAdapter implements TraceAdapter {
  public readonly adapterVersion = '1.0.0-v8';
  public readonly supportedFormatVersions = [7, 8];

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
    context.traceFormatVersion = 8;
    return context;
  }

  public validate(context: DiagnosticContext): AdapterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!context.failedAction.callId || context.failedAction.callId === 'unknown') {
      warnings.push('Action callId could not be definitively extracted from v8 trace');
    }
    if (context.networkEvents.length === 0) {
      warnings.push('No network events parsed from v8 network stream');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
