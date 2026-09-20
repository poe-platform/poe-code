import type { SnapshotContentNode, SnapshotNode } from './adapter.js';

export interface FrameSnapshotInput {
  readonly maxSnapshotBytes: number;
  readonly maxSnapshotRefs: number;
}

export type FrameSnapshotStatus = 'ok' | 'ref-limit' | 'invalid-input' | 'failed';
export type FrameSnapshotRenderStatus = FrameSnapshotStatus | 'byte-limit' | 'invalid-refs';

export interface FrameSnapshotRenderResult {
  readonly status: FrameSnapshotRenderStatus;
  readonly text: string;
}

export interface FrameSnapshotCapsule {
  readonly nodes: readonly SnapshotNode[];
  readonly status: FrameSnapshotStatus;
  readonly count: number;
  render(refs: readonly string[]): FrameSnapshotRenderResult;
}

export function createFrameSnapshot(input: FrameSnapshotInput): FrameSnapshotCapsule {
  type SnapshotDocument = {
    readonly body: { readonly innerText?: string } | null;
    querySelectorAll(selector: string): ArrayLike<SnapshotNode>;
  };
  const maxSnapshotBytes = input?.maxSnapshotBytes;
  const maxSnapshotRefs = input?.maxSnapshotRefs;
  const nodes: SnapshotNode[] = [];
  let document: SnapshotDocument;
  const capsule = {
    status: 'ok' as FrameSnapshotStatus,
    count: 0,
    nodes,
    render(refs: readonly string[]): FrameSnapshotRenderResult {
      if (capsule.status !== 'ok') return { status: capsule.status, text: '' };
      const byteLimit = {};
      try {
        if (!Array.isArray(refs) || refs.length !== nodes.length || refs.some(ref => typeof ref !== 'string')) return { status: 'invalid-refs', text: '' };
        let remaining = maxSnapshotBytes;
        let text = '';
        const encoder = new TextEncoder();
        const output = {
          append(value: string) {
            if (value.length > remaining) throw byteLimit;
            const bytes = encoder.encode(value).byteLength;
            if (bytes > remaining) throw byteLimit;
            remaining -= bytes;
            text += value;
          },
          json(value: string) {
            if (value.length > remaining) throw byteLimit;
            return JSON.stringify(value);
          },
        };
        const content = document.body?.innerText || '';
        let start = 0;
        while (start < content.length) {
          const newline = content.indexOf('\n', start);
          const end = newline === -1 ? content.length : newline;
          const paragraph = content.slice(start, end).trim();
          if (paragraph) {
            output.append('- text ');
            output.append(output.json(paragraph));
            output.append('\n');
          }
          start = end + 1;
        }
        const roles: Record<string, string> = { button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox', a: 'link' };
        const inputRoles: Record<string, string> = { checkbox: 'checkbox', radio: 'radio', number: 'spinbutton', range: 'slider', search: 'searchbox', button: 'button', submit: 'button', reset: 'button', image: 'button' };
        const contentRoles = new Set(['button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem']);
        const prohibitedRoles = new Set(['caption', 'code', 'deletion', 'emphasis', 'generic', 'insertion', 'mark', 'none', 'paragraph', 'presentation', 'strong', 'subscript', 'superscript', 'suggestion', 'term', 'time']);
        let work = maxSnapshotBytes;
        const naming = {
          visit() { if (--work < 0) throw byteLimit; },
          bounded(value: string) {
            if (value.length > maxSnapshotBytes) throw byteLimit;
            return value;
          },
          attribute(node: SnapshotContentNode, name: string) { return naming.bounded(node.getAttribute?.(name) || ''); },
          normalize(value: string) {
            let result = '';
            let space = false;
            for (const character of naming.bounded(value)) {
              if (' \t\n\r\f'.includes(character)) space = result.length > 0;
              else {
                result += (space ? ' ' : '') + character;
                space = false;
              }
            }
            return result;
          },
          hidden(node: SnapshotContentNode) {
            const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
            const hiddenAttribute = node.getAttribute?.('hidden');
            return naming.attribute(node, 'aria-hidden') === 'true' || (hiddenAttribute !== null && hiddenAttribute !== undefined)
              || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden';
          },
          hiddenReference(node: SnapshotContentNode) {
            for (let current: SnapshotContentNode | null | undefined = node; current; current = current.parentElement) {
              naming.visit();
              if (current.tagName && naming.hidden(current)) return true;
            }
            return false;
          },
          contentName(root: SnapshotContentNode, reference: boolean, control?: SnapshotNode) {
            const includeHidden = reference && naming.hiddenReference(root);
            const stack: ({ node: SnapshotContentNode; sibling: boolean } | null)[] = [{ node: root, sibling: false }];
            let result = '';
            const content = { append(value: string) {
              if (value.length > maxSnapshotBytes - result.length) throw byteLimit;
              result += value;
            } };
            while (stack.length) {
              naming.visit();
              const entry = stack.pop();
              if (!entry) { content.append(' '); continue; }
              const { node: current, sibling } = entry;
              if (sibling && current.nextSibling) stack.push({ node: current.nextSibling, sibling: true });
              if (current === control) continue;
              if (!current.tagName) {
                if (current.nodeType === undefined || current.nodeType === 3) content.append(current.textContent || '');
                continue;
              }
              const tag = current.tagName.toLowerCase();
              if (['script', 'style', 'template', 'noscript'].includes(tag) || !includeHidden && naming.hidden(current)) continue;
              if (current !== root || reference) {
                const role = naming.attribute(current, 'role');
                const explicit = prohibitedRoles.has(role) ? '' : naming.normalize(naming.attribute(current, 'aria-label'));
                const replacement = explicit || (tag === 'img' || tag === 'input' && naming.attribute(current, 'type') === 'image' ? naming.attribute(current, 'alt') : '');
                if (replacement) {
                  content.append(` ${replacement} `);
                  continue;
                }
              }
              const display = current.ownerDocument?.defaultView?.getComputedStyle?.(current).display;
              if (tag === 'br' || display && display !== 'inline' && display !== 'contents') {
                content.append(' ');
                stack.push(null);
              }
              if (current.firstChild) stack.push({ node: current.firstChild, sibling: true });
            }
            return naming.normalize(result);
          },
          accessibleName(node: SnapshotNode, tag: string, type: string, role: string) {
            if (prohibitedRoles.has(role)) return '';
            const ids = naming.attribute(node, 'aria-labelledby');
            const seen = new Set<string>();
            let validReference = false;
            let labelledBy = '';
            let labelId = '';
            for (const character of ids + ' ') {
              if (' \t\n\r\f'.includes(character)) {
                if (labelId && !seen.has(labelId)) {
                  naming.visit();
                  seen.add(labelId);
                  const label = node.ownerDocument?.getElementById?.(labelId);
                  if (label) {
                    validReference = true;
                    const name = naming.contentName(label, true);
                    labelledBy = naming.bounded(labelledBy + (labelledBy && name ? ' ' : '') + name);
                  }
                }
                labelId = '';
              } else labelId += character;
            }
            if (validReference) return labelledBy;
            const explicit = naming.normalize(naming.attribute(node, 'aria-label'));
            if (explicit) return explicit;
            const labels = node.labels;
            if (labels?.length) {
              let name = '';
              for (let index = 0; index < labels.length; index++) {
                naming.visit();
                const label = naming.contentName(labels[index]!, true, node);
                name = naming.bounded(name + (name && label ? ' ' : '') + label);
              }
              return name;
            }
            if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return naming.bounded(node.value || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : ''));
            if (tag === 'input' && type === 'image' && naming.attribute(node, 'alt')) return naming.attribute(node, 'alt');
            const contents = contentRoles.has(role) && !['input', 'textarea', 'select'].includes(tag) ? naming.contentName(node, false) : '';
            return contents || naming.attribute(node, 'title') || (tag === 'input' || tag === 'textarea' ? naming.attribute(node, 'placeholder') : '');
          },
        };
        for (let index = 0; index < nodes.length; index++) {
          const node = nodes[index]!;
          const tag = node.tagName.toLowerCase();
          const type = (naming.attribute(node, 'type') || 'text').toLowerCase();
          const role = naming.attribute(node, 'role') || (tag === 'input' ? (Object.hasOwn(inputRoles, type) ? inputRoles[type]! : 'textbox')
            : tag === 'select' && (node.multiple || (node.size ?? 0) > 1) ? 'listbox' : Object.hasOwn(roles, tag) ? roles[tag]! : tag);
          const name = naming.accessibleName(node, tag, type, role);
          output.append('- ');
          output.append(output.json(role).slice(1, -1));
          output.append(' ');
          output.append(output.json(name.trim()));
          output.append(' [ref=');
          output.append(refs[index]!);
          output.append(']');
          const checked = node.getAttribute('aria-checked');
          if (['checkbox', 'radio', 'switch'].includes(role)) {
            output.append(` [checked=${checked && ['true', 'false', 'mixed'].includes(checked) ? checked : node.indeterminate ? 'mixed' : String(node.checked === true)}]`);
          }
          if (node.disabled || node.getAttribute('aria-disabled') === 'true') output.append(' [disabled]');
          if (type !== 'password' && ['textbox', 'searchbox', 'spinbutton', 'slider', 'combobox', 'listbox'].includes(role)) {
            const value = node.value;
            if (value !== undefined) {
              output.append(' [value=');
              output.append(output.json(value));
              output.append(']');
            }
          }
          output.append('\n');
        }
        return { status: 'ok', text };
      } catch (error) {
        return { status: error === byteLimit ? 'byte-limit' : 'failed', text: '' };
      }
    },
  };
  try {
    if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 0 || !Number.isSafeInteger(maxSnapshotRefs) || maxSnapshotRefs < 0) {
      capsule.status = 'invalid-input';
      return capsule;
    }
    document = (globalThis as typeof globalThis & { document: SnapshotDocument }).document;
    const candidates = document.querySelectorAll('button, input, textarea, select, a[href], [role], [contenteditable="true"]');
    if (candidates.length > maxSnapshotRefs) {
      capsule.status = 'ref-limit';
      return capsule;
    }
    for (let index = 0; index < candidates.length; index++) nodes.push(candidates[index]!);
    capsule.count = nodes.length;
  } catch {
    nodes.length = 0;
    capsule.status = 'failed';
  }
  return capsule;
}
