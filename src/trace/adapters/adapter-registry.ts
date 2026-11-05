import { TraceAdapter, ArchiveManifest } from './trace-adapter.js';
import { V8TraceAdapter } from './v8-adapter.js';
import { V9TraceAdapter } from './v9-adapter.js';
import { V10TraceAdapter } from './v10-adapter.js';
import { UnknownTraceAdapter } from './unknown-adapter.js';

export class TraceAdapterRegistry {
  private static adapters: TraceAdapter[] = [
    new V10TraceAdapter(),
    new V9TraceAdapter(),
    new V8TraceAdapter(),
  ];

  private static fallbackAdapter = new UnknownTraceAdapter();

  /**
   * Registers a custom or extended trace adapter.
   */
  public static registerAdapter(adapter: TraceAdapter): void {
    TraceAdapterRegistry.adapters.unshift(adapter);
  }

  /**
   * Resolves the matching TraceAdapter for a given trace archive and sample lines.
   */
  public static resolveAdapter(manifest: ArchiveManifest, sampleLines: string[]): TraceAdapter {
    for (const adapter of TraceAdapterRegistry.adapters) {
      if (adapter.canParse(manifest, sampleLines)) {
        return adapter;
      }
    }
    return TraceAdapterRegistry.fallbackAdapter;
  }
}

