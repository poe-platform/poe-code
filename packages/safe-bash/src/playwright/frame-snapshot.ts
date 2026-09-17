import type { SnapshotNode } from './adapter.js';

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
        for (let index = 0; index < nodes.length; index++) {
          const node = nodes[index]!;
          const tag = node.tagName.toLowerCase();
          const type = (node.getAttribute('type') || 'text').toLowerCase();
          const role = node.getAttribute('role') || (tag === 'input' ? (Object.hasOwn(inputRoles, type) ? inputRoles[type]! : 'textbox')
            : tag === 'select' && (node.multiple || (node.size ?? 0) > 1) ? 'listbox' : Object.hasOwn(roles, tag) ? roles[tag]! : tag);
          const labelIds: string[] = [];
          let labelId = '';
          for (const character of node.getAttribute('aria-labelledby') || '') {
            if (' \t\n\r\f'.includes(character)) {
              if (labelId) labelIds.push(labelId);
              labelId = '';
            } else labelId += character;
          }
          if (labelId) labelIds.push(labelId);
          const labelledBy = labelIds.map(id => node.ownerDocument?.getElementById?.(id)?.textContent || '').join(' ').trim();
          const labels = Array.from(node.labels || []).map(label => label.textContent || '').join(' ').trim();
          const name = labelledBy || node.getAttribute('aria-label') || labels
            || (tag === 'input' && ['button', 'submit', 'reset'].includes(type) ? node.value || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '') : '')
            || (tag === 'input' && type === 'image' ? node.getAttribute('alt') : '')
            || (tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : node.textContent)
            || node.getAttribute('title') || node.getAttribute('placeholder') || '';
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
