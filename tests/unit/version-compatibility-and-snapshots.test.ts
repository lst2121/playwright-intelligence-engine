import { describe, it, expect } from 'vitest';
import { VersionDetector } from '../../src/trace/version-detector.js';
import { UnsupportedTraceVersionError } from '../../src/core/errors/engine-errors.js';
import { SnapshotResolver, NodeSnapshot, FrameSnapshotRecord } from '../../src/trace/snapshot-resolver.js';
import { V8TraceAdapter } from '../../src/trace/adapters/v8-adapter.js';
import { V9TraceAdapter } from '../../src/trace/adapters/v9-adapter.js';
import { V10TraceAdapter } from '../../src/trace/adapters/v10-adapter.js';
import { V4TraceAdapter } from '../../src/trace/adapters/v4-adapter.js';
import { UnknownTraceAdapter } from '../../src/trace/adapters/unknown-adapter.js';
import { TraceAdapterRegistry } from '../../src/trace/adapters/adapter-registry.js';

describe('Version Compatibility and Snapshot Resolution Suite (35 Tests)', () => {
  // --- Category 1: Version Detection & Trace Adapters (15 tests) ---
  const supportedVersions = [4, 5, 6, 7, 8, 9, 10];
  supportedVersions.forEach((ver) => {
    it(`VER-SUPPORT-${ver}: should detect and support trace format version ${ver}`, () => {
      const lines = [JSON.stringify({ type: 'version', version: ver })];
      const info = VersionDetector.detectFromLines(lines);
      expect(info.traceFormatVersion).toBe(ver);
      expect(info.isSupported).toBe(true);
      expect(() => VersionDetector.assertSupported(info)).not.toThrow();
    });
  });

  it('VER-UNSUPPORT-01: should flag unsupported future trace format version 99', () => {
    const lines = [JSON.stringify({ type: 'version', version: 99 })];
    const info = VersionDetector.detectFromLines(lines);
    expect(info.isSupported).toBe(false);
    expect(() => VersionDetector.assertSupported(info)).toThrow(UnsupportedTraceVersionError);
  });

  it('VER-DETECT-03: should extract playwrightVersion from context-options metadata', () => {
    const lines = [
      JSON.stringify({ type: 'context-options', playwrightVersion: '1.64.1', version: 10 }),
    ];
    const info = VersionDetector.detectFromLines(lines);
    expect(info.playwrightVersion).toBe('1.64.1');
    expect(info.traceFormatVersion).toBe(10);
  });

  it('VER-ADAPTER-01: V8TraceAdapter should parse format 7 and 8', () => {
    const adapter = new V8TraceAdapter();
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":7}'])).toBe(true);
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":8}'])).toBe(true);
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":10}'])).toBe(false);
  });

  it('VER-ADAPTER-00: V4TraceAdapter should parse legacy format 4', () => {
    const adapter = new V4TraceAdapter();
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":4}'])).toBe(true);
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":10}'])).toBe(false);
  });

  it('VER-ADAPTER-02: V9TraceAdapter should parse format 9', () => {
    const adapter = new V9TraceAdapter();
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":9}'])).toBe(true);
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":10}'])).toBe(false);
  });

  it('VER-ADAPTER-03: V10TraceAdapter should parse format 10', () => {
    const adapter = new V10TraceAdapter();
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":10}'])).toBe(true);
    expect(adapter.canParse({ archivePath: '', entryNames: [] }, ['{"type":"version","version":8}'])).toBe(false);
  });

  it('VER-ADAPTER-04: UnknownTraceAdapter should abstain and fail validation on unsupported format', async () => {
    const adapter = new UnknownTraceAdapter();
    const manifest = { archivePath: 'test.zip', entryNames: [] };
    const context = await adapter.parse(manifest, ['{"type":"version","version":99}'], []);
    expect(context.failureCategory).toBe('UNSUPPORTED_TRACE_FORMAT');

    const validation = adapter.validate(context);
    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('UNSUPPORTED_TRACE_FORMAT');
  });

  it('VER-REGISTRY-01: TraceAdapterRegistry should resolve matching adapter or fallback', () => {
    const manifest = { archivePath: 'test.zip', entryNames: [] };
    const a10 = TraceAdapterRegistry.resolveAdapter(manifest, ['{"type":"version","version":10}']);
    expect(a10.adapterVersion).toContain('v10');

    const aFallback = TraceAdapterRegistry.resolveAdapter(manifest, ['{"type":"version","version":88}']);
    expect(aFallback.adapterVersion).toContain('unsupported');
  });

  // --- Category 2: Snapshot Resolution, Provenance & Completeness (20 tests) ---
  it('SNAP-01: should return null for numeric or empty string nodes', () => {
    expect(SnapshotResolver.resolveNode(42)).toBeNull();
    expect(SnapshotResolver.resolveNode('just-text')).toBeNull();
  });

  it('SNAP-02: should resolve simple button element tuple', () => {
    const tuple: NodeSnapshot = ['button', { class: 'btn', id: 'submit-btn' }, 'Click Me'];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.tag).toBe('button');
    expect(el?.text).toBe('Click Me');
    expect(el?.role).toBe('button');
    expect(el?.attributes['id']).toBe('submit-btn');
  });

  it('SNAP-03: should infer role link for anchor with href', () => {
    const tuple: NodeSnapshot = ['a', { href: 'https://example.com' }, 'Home'];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('link');
    expect(el?.accessibleName).toBe('Home');
  });

  it('SNAP-04: should infer role textbox for input type text', () => {
    const tuple: NodeSnapshot = ['input', { type: 'text', placeholder: 'Enter Name' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('textbox');
    expect(el?.accessibleName).toBe('Enter Name');
  });

  it('SNAP-05: should infer role checkbox for input type checkbox', () => {
    const tuple: NodeSnapshot = ['input', { type: 'checkbox', 'aria-label': 'Accept Terms' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('checkbox');
    expect(el?.accessibleName).toBe('Accept Terms');
  });

  it('SNAP-06: should infer role radio for input type radio', () => {
    const tuple: NodeSnapshot = ['input', { type: 'radio', title: 'Option 1' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('radio');
    expect(el?.accessibleName).toBe('Option 1');
  });

  it('SNAP-07: should infer role combobox for select tag', () => {
    const tuple: NodeSnapshot = ['select', { id: 'country' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('combobox');
  });

  it('SNAP-08: should resolve nested DOM trees recursively', () => {
    const tuple: NodeSnapshot = [
      'div',
      { class: 'card' },
      ['h3', {}, 'Product Title'],
      ['button', { 'data-testid': 'add-btn' }, 'Add to Cart'],
    ];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.tag).toBe('div');
    expect(el?.children.length).toBe(2);
    expect(el?.children[0]?.text).toBe('Product Title');
    expect(el?.children[1]?.role).toBe('button');
  });

  it('SNAP-09: should track snapshot provenance (frameId, callId, phase)', () => {
    const record: FrameSnapshotRecord = {
      frameId: 'frame-xyz',
      callId: 'call@42',
      phase: 'after',
      node: ['button', {}, 'Submit'],
    };
    const snap = SnapshotResolver.resolveSnapshot(record);
    expect(snap.frameId).toBe('frame-xyz');
    expect(snap.callId).toBe('call@42');
    expect(snap.phase).toBe('after');
    expect(snap.completeness).toBe('COMPLETE');
  });

  it('SNAP-10: should mark completeness as UNAVAILABLE when root node is missing', () => {
    const record: FrameSnapshotRecord = {
      frameId: 'main',
      phase: 'before',
    };
    const snap = SnapshotResolver.resolveSnapshot(record);
    expect(snap.completeness).toBe('UNAVAILABLE');
    expect(snap.dom).toEqual([]);
    expect(snap.unresolvedReferences.length).toBeGreaterThan(0);
  });

  it('SNAP-11: should mark completeness as PARTIAL when unresolved references exist', () => {
    const record: FrameSnapshotRecord = {
      frameId: 'main',
      phase: 'action',
      node: ['div', {}, 'ref:12345', ['button', {}, 'OK']],
    };
    const snap = SnapshotResolver.resolveSnapshot(record);
    expect(snap.completeness).toBe('PARTIAL');
    expect(snap.unresolvedReferences).toContain('ref:12345');
  });

  it('SNAP-12: should extract interactive elements from DOM tree', () => {
    const tuple: NodeSnapshot = [
      'form',
      {},
      ['input', { type: 'text', placeholder: 'Username' }],
      ['input', { type: 'password' }],
      ['div', {}, ['span', {}, 'Help text']],
      ['button', { type: 'submit' }, 'Login'],
    ];
    const root = SnapshotResolver.resolveNode(tuple)!;
    const interactive = SnapshotResolver.extractInteractiveElements(root);
    expect(interactive.length).toBe(3); // text input, password input, button
  });

  it('SNAP-13: should serialize element tree back to clean HTML via toHtml', () => {
    const tuple: NodeSnapshot = ['button', { id: 'btn', class: 'btn-primary' }, 'Submit'];
    const el = SnapshotResolver.resolveNode(tuple)!;
    const html = SnapshotResolver.toHtml(el);
    expect(html).toContain('<button id="btn" class="btn-primary">Submit</button>');
  });

  it('SNAP-14: should serialize nested elements with proper indentation', () => {
    const tuple: NodeSnapshot = ['div', { id: 'container' }, ['p', {}, 'Hello World']];
    const el = SnapshotResolver.resolveNode(tuple)!;
    const html = SnapshotResolver.toHtml(el);
    expect(html).toContain('<div id="container">');
    expect(html).toContain('  <p>Hello World</p>');
  });

  it('SNAP-15: should extract explicit role attribute over tag inference', () => {
    const tuple: NodeSnapshot = ['div', { role: 'button', 'aria-label': 'Custom Button' }, 'Custom'];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('button');
  });

  it('SNAP-16: should prioritize aria-label over alt attribute for accessible name', () => {
    const tuple: NodeSnapshot = ['img', { 'aria-label': 'Logo Icon', alt: 'Backup text' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.accessibleName).toBe('Logo Icon');
  });

  it('SNAP-17: should prioritize alt attribute over title when aria-label is absent', () => {
    const tuple: NodeSnapshot = ['img', { alt: 'User Avatar', title: 'Tooltip' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.accessibleName).toBe('User Avatar');
  });

  it('SNAP-18: should extract interactive element with onclick attribute', () => {
    const tuple: NodeSnapshot = ['div', { onclick: 'doSomething()' }, 'Clickable Div'];
    const root = SnapshotResolver.resolveNode(tuple)!;
    const interactive = SnapshotResolver.extractInteractiveElements(root);
    expect(interactive.length).toBe(1);
    expect(interactive[0]?.tag).toBe('div');
  });

  it('SNAP-19: should infer role textbox for textarea element', () => {
    const tuple: NodeSnapshot = ['textarea', { placeholder: 'Comments' }];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.role).toBe('textbox');
  });

  it('SNAP-20: should handle deep nesting without stack overflow', () => {
    let current: NodeSnapshot = ['span', {}, 'Deepest'];
    for (let i = 0; i < 50; i++) {
      current = ['div', { level: `${i}` }, current];
    }
    const root = SnapshotResolver.resolveNode(current);
    expect(root).not.toBeNull();
    expect(root?.tag).toBe('div');
  });

  it('SNAP-21: should handle empty attribute object and empty children gracefully', () => {
    const tuple: NodeSnapshot = ['hr', {}];
    const el = SnapshotResolver.resolveNode(tuple);
    expect(el?.tag).toBe('hr');
    expect(el?.children).toEqual([]);
    expect(el?.text).toBe('');
  });
});
