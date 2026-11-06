export type NodeSnapshot =
  | string
  | number
  | [string, Record<string, string>, ...NodeSnapshot[]];

export interface ResolvedElement {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: ResolvedElement[];
  role?: string | undefined;
  accessibleName?: string | undefined;
}

export type SnapshotCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface ResolvedSnapshot {
  frameId: string;
  callId?: string | undefined;
  phase: 'before' | 'action' | 'after';
  completeness: SnapshotCompleteness;
  unresolvedReferences: string[];
  dom: ResolvedElement[];
}

export interface FrameSnapshotRecord {
  frameId: string;
  pageId?: string | undefined;
  callId?: string | undefined;
  snapshotName?: string | undefined;
  phase?: 'before' | 'action' | 'after' | undefined;
  node?: NodeSnapshot | undefined;
}

export class SnapshotResolver {
  /**
   * Reconstructs an in-memory resolved element tree from Playwright's array-based NodeSnapshot,
   * tracking provenance, snapshot phase, and evidence completeness.
   */
  public static resolveSnapshot(record: FrameSnapshotRecord): ResolvedSnapshot {
    const frameId = record.frameId || 'main-frame';
    const phase = record.phase ?? 'before';
    const unresolvedReferences: string[] = [];

    if (!record.node) {
      return {
        frameId,
        callId: record.callId,
        phase,
        completeness: 'UNAVAILABLE',
        unresolvedReferences: ['Missing root node in snapshot record'],
        dom: [],
      };
    }

    const rootElement = SnapshotResolver.resolveNode(record.node, unresolvedReferences);
    const completeness: SnapshotCompleteness =
      unresolvedReferences.length > 0 ? 'PARTIAL' : rootElement ? 'COMPLETE' : 'UNAVAILABLE';

    return {
      frameId,
      callId: record.callId,
      phase,
      completeness,
      unresolvedReferences,
      dom: rootElement ? [rootElement] : [],
    };
  }

  /**
   * Reconstructs an in-memory resolved element tree from Playwright's array-based NodeSnapshot.
   */
  public static resolveNode(node: NodeSnapshot, unresolvedRefs?: string[]): ResolvedElement | null {
    if (typeof node === 'string' || typeof node === 'number') {
      if (typeof node === 'string' && node.startsWith('ref:')) {
        unresolvedRefs?.push(node);
      }
      return null;
    }

    if (!Array.isArray(node) || node.length < 2) {
      return null;
    }

    const tag = (node[0] as string).toLowerCase();
    const attributes = (node[1] as Record<string, string>) ?? {};
    const rawChildren = node.slice(2) as NodeSnapshot[];

    const children: ResolvedElement[] = [];
    let textAccumulator = '';

    for (const child of rawChildren) {
      if (typeof child === 'string') {
        if (child.startsWith('ref:')) {
          unresolvedRefs?.push(child);
        } else {
          textAccumulator += child.trim() + ' ';
        }
      } else if (Array.isArray(child)) {
        const resolvedChild = SnapshotResolver.resolveNode(child, unresolvedRefs);
        if (resolvedChild) {
          children.push(resolvedChild);
          textAccumulator += resolvedChild.text + ' ';
        }
      }
    }

    const role = attributes['role'] ?? SnapshotResolver.inferRoleFromTag(tag, attributes);
    const accessibleName =
      attributes['aria-label'] ??
      attributes['alt'] ??
      attributes['title'] ??
      attributes['placeholder'] ??
      textAccumulator.trim();

    return {
      tag,
      attributes,
      text: textAccumulator.trim(),
      children,
      role,
      accessibleName: accessibleName || undefined,
    };
  }

  /**
   * Traverses and collects all nodes in depth-first order as Playwright's snapshotNodes does.
   */
  public static snapshotNodes(snap: any): any[] {
    if (!snap) return [];
    if (snap._nodes) return snap._nodes;
    const nodes: any[] = [];
    const visit = (n: any) => {
      if (typeof n === 'string' || typeof n === 'number') {
        nodes.push(n);
      } else if (Array.isArray(n) && typeof n[0] === 'string') {
        const [, , ...children] = n;
        for (const child of children) visit(child);
        nodes.push(n);
      }
    };
    if (snap.html) visit(snap.html);
    else if (snap.node) visit(snap.node);
    snap._nodes = nodes;
    return nodes;
  }

  /**
   * Resolves a modern Playwright differential snapshot node with support for subtree references [ [ delta, nodeIndex ] ].
   */
  public static resolveDifferentialNode(
    n: any,
    snapshotIndex: number,
    allSnapshots: any[],
    unresolvedRefs?: string[]
  ): ResolvedElement | string | null {
    if (typeof n === 'string' || typeof n === 'number') {
      return String(n);
    }

    // Check for Playwright subtree reference [ [ delta, nodeIndex ] ]
    if (
      Array.isArray(n) &&
      n.length === 1 &&
      Array.isArray(n[0]) &&
      n[0].length === 2 &&
      typeof n[0][0] === 'number' &&
      typeof n[0][1] === 'number'
    ) {
      const referenceIndex = snapshotIndex - n[0][0];
      if (referenceIndex >= 0 && referenceIndex < allSnapshots.length) {
        const nodes = SnapshotResolver.snapshotNodes(allSnapshots[referenceIndex]);
        const nodeIndex = n[0][1];
        if (nodeIndex >= 0 && nodeIndex < nodes.length) {
          return SnapshotResolver.resolveDifferentialNode(
            nodes[nodeIndex],
            referenceIndex,
            allSnapshots,
            unresolvedRefs
          );
        }
      }
      unresolvedRefs?.push(`Subtree reference out of bounds: [${n[0][0]}, ${n[0][1]}]`);
      return null;
    }

    if (!Array.isArray(n) || n.length < 2 || typeof n[0] !== 'string') {
      return null;
    }

    const tag = (n[0] as string).toLowerCase();
    const attributes = (n[1] as Record<string, string>) ?? {};
    const rawChildren = n.slice(2);

    const children: ResolvedElement[] = [];
    let textAccumulator = '';

    for (const child of rawChildren) {
      const resolved = SnapshotResolver.resolveDifferentialNode(
        child,
        snapshotIndex,
        allSnapshots,
        unresolvedRefs
      );
      if (typeof resolved === 'string') {
        textAccumulator += resolved.trim() + ' ';
      } else if (resolved && typeof resolved === 'object' && 'tag' in resolved) {
        children.push(resolved as ResolvedElement);
        textAccumulator += (resolved as ResolvedElement).text + ' ';
      }
    }

    const role = attributes['role'] ?? SnapshotResolver.inferRoleFromTag(tag, attributes);
    const accessibleName =
      attributes['aria-label'] ??
      attributes['alt'] ??
      attributes['title'] ??
      attributes['placeholder'] ??
      textAccumulator.trim();

    return {
      tag,
      attributes,
      text: textAccumulator.trim(),
      children,
      role,
      accessibleName: accessibleName || undefined,
    };
  }

  /**
   * Serializes a resolved element tree back into clean, formatted HTML.
   */
  public static toHtml(element: ResolvedElement, indent = 0): string {
    const spacing = '  '.repeat(indent);
    const attrs = Object.entries(element.attributes)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`)
      .join(' ');
    const attrString = attrs.length > 0 ? ` ${attrs}` : '';

    if (element.children.length === 0) {
      return `${spacing}<${element.tag}${attrString}>${element.text}</${element.tag}>`;
    }

    const childrenHtml = element.children.map((c) => SnapshotResolver.toHtml(c, indent + 1)).join('\n');
    return `${spacing}<${element.tag}${attrString}>\n${childrenHtml}\n${spacing}</${element.tag}>`;
  }

  /**
   * Collects all descendant interactive elements (buttons, inputs, links, selects, roles).
   */
  public static extractInteractiveElements(root: ResolvedElement): ResolvedElement[] {
    const interactiveTags = new Set(['button', 'a', 'input', 'select', 'textarea', 'option']);
    const interactiveRoles = new Set([
      'button',
      'link',
      'textbox',
      'combobox',
      'checkbox',
      'radio',
      'tab',
      'menuitem',
    ]);

    const results: ResolvedElement[] = [];

    function traverse(node: ResolvedElement) {
      const isInteractive =
        interactiveTags.has(node.tag) ||
        (node.role && interactiveRoles.has(node.role.toLowerCase())) ||
        Boolean(node.attributes?.['onclick']) ||
        node.attributes?.['cursor'] === 'pointer';

      if (isInteractive) {
        results.push(node);
      }

      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(root);
    return results;
  }

  private static inferRoleFromTag(tag: string, attributes: Record<string, string>): string | undefined {
    switch (tag) {
      case 'button':
        return 'button';
      case 'a':
        return attributes['href'] ? 'link' : undefined;
      case 'input': {
        const type = attributes['type']?.toLowerCase() ?? 'text';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      case 'select':
        return 'combobox';
      case 'textarea':
        return 'textbox';
      default:
        return undefined;
    }
  }
}
