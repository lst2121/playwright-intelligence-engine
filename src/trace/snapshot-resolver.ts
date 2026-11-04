export type NodeSnapshot =
  | string
  | number
  | [string, Record<string, string>, ...NodeSnapshot[]];

export interface ResolvedElement {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: ResolvedElement[];
  role?: string;
  accessibleName?: string;
}

export interface FrameSnapshotRecord {
  frameId: string;
  pageId?: string;
  callId?: string;
  snapshotName?: string;
  node: NodeSnapshot;
}

export class SnapshotResolver {
  /**
   * Reconstructs an in-memory resolved element tree from Playwright's array-based NodeSnapshot.
   */
  public static resolveNode(node: NodeSnapshot): ResolvedElement | null {
    if (typeof node === 'string' || typeof node === 'number') {
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
        textAccumulator += child.trim() + ' ';
      } else if (Array.isArray(child)) {
        const resolvedChild = SnapshotResolver.resolveNode(child);
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
        Boolean(node.attributes['onclick']) ||
        node.attributes['cursor'] === 'pointer';

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
