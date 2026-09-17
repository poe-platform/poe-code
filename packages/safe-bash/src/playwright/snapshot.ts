import type { PlaywrightPage, PlaywrightElementHandle } from './adapter.js';

export interface SnapshotLimits { readonly maxSnapshotBytes: number; readonly maxSnapshotRefs: number }

/** Public element handles only. Shared by regular and Cloudflare injected pages.
 * Guest text is never compiled or evaluated as a locator or browser program.
 */
export function createSnapshotEngine(limits: SnapshotLimits, nextRef?: () => string) {
  for (const value of [limits?.maxSnapshotBytes, limits?.maxSnapshotRefs]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid snapshot limit');
  const { maxSnapshotBytes, maxSnapshotRefs } = limits;
  let sequence = 0;
  let epoch = 0;
  const retirements = new Set<Promise<void>>();
  const refs = new Map<string, PlaywrightElementHandle>();
  const invalidate = async () => {
    epoch++;
    const handles = [...refs.values()];
    refs.clear();
    const tasks = [...new Set(handles)].map(handle => Promise.resolve().then(() => handle.dispose()));
    for (const task of tasks) { retirements.add(task); void task.then(() => retirements.delete(task), () => {}); }
    const results = await Promise.allSettled([...retirements]);
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'Snapshot handle disposal failed');
  };
  const capture = async (page: PlaywrightPage, signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    if (typeof page.frames !== 'function') throw new Error('Snapshot engine unsupported: public frame element handles required');
    const frames = page.frames();
    if (frames.some(frame => typeof frame.locator('button, input, textarea, select, a[href], [role], [contenteditable="true"]').elementHandles !== 'function')) throw new Error('Snapshot engine unsupported: public element handles required');
    await invalidate();
    const capturedEpoch = epoch;
    const acquired = new Set<PlaywrightElementHandle>();
    const pending = new Map<string, PlaywrightElementHandle>();
    let text = '';
    let bytes = 0;
    try {
      for (const frame of frames) {
        signal?.throwIfAborted();
        const body = frame.locator('body');
        if (body.evaluate) {
          const content = await body.evaluate(node => node.innerText || '');
          signal?.throwIfAborted();
          for (const paragraph of content.split('\n')) {
            if (!paragraph.trim()) continue;
            const line = `- text ${JSON.stringify(paragraph.trim())}\n`;
            bytes += new TextEncoder().encode(line).byteLength;
            if (bytes > maxSnapshotBytes) throw new Error('Snapshot byte limit exceeded');
            text += line;
          }
        }
        const handles = await frame.locator('button, input, textarea, select, a[href], [role], [contenteditable="true"]').elementHandles!();
        for (const handle of handles) acquired.add(handle);
        if (acquired.size > maxSnapshotRefs) throw new Error('Snapshot ref limit exceeded');
        for (const handle of handles) {
          signal?.throwIfAborted();
          const summary = await handle.evaluate(node => {
            const tag = node.tagName.toLowerCase();
            const roles: Record<string, string> = { button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox', a: 'link' };
            const type = (node.getAttribute('type') || 'text').toLowerCase();
            const inputRoles: Record<string, string> = { checkbox: 'checkbox', radio: 'radio', number: 'spinbutton', range: 'slider', search: 'searchbox', button: 'button', submit: 'button', reset: 'button', image: 'button' };
            const role = node.getAttribute('role') || (tag === 'input' ? inputRoles[type] || 'textbox' : tag === 'select' && (node.multiple || (node.size ?? 0) > 1) ? 'listbox' : roles[tag] || tag);
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
            const state: string[] = [];
            const checked = node.getAttribute('aria-checked');
            if (['checkbox', 'radio', 'switch'].includes(role)) state.push(`checked=${checked && ['true', 'false', 'mixed'].includes(checked) ? checked : node.indeterminate ? 'mixed' : String(node.checked === true)}`);
            if (node.disabled || node.getAttribute('aria-disabled') === 'true') state.push('disabled');
            if (type !== 'password' && node.value !== undefined && ['textbox', 'searchbox', 'spinbutton', 'slider', 'combobox', 'listbox'].includes(role)) state.push(`value=${JSON.stringify(node.value)}`);
            return { role, name, state };
          });
          const ref = nextRef?.() ?? `e${++sequence}`;
          const line = `- ${JSON.stringify(summary.role).slice(1, -1)} ${JSON.stringify(summary.name.trim())} [ref=${ref}]${summary.state.map(state => ` [${state}]`).join('')}\n`;
          bytes += new TextEncoder().encode(line).byteLength;
          if (bytes > maxSnapshotBytes) throw new Error('Snapshot byte limit exceeded');
          pending.set(ref, handle);
          text += line;
        }
      }
      signal?.throwIfAborted();
      if (capturedEpoch !== epoch) throw new Error('Snapshot stale during capture');
      for (const [ref, handle] of pending) refs.set(ref, handle);
      return text;
    } catch (error) {
      const results = await Promise.allSettled([...acquired].map(handle => Promise.resolve().then(() => handle.dispose())));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError([error, ...errors], 'Snapshot capture and cleanup failed');
      throw error;
    }
  };
  const resolve = async (ref: string): Promise<PlaywrightElementHandle> => {
    const handle = refs.get(ref);
    if (!handle) throw new Error(`Unknown or stale snapshot ref: ${ref}; snapshot again`);
    const capturedEpoch = epoch;
    let connected = false;
    try { connected = await handle.evaluate(node => node.isConnected && (!node.ownerDocument || node.ownerDocument.defaultView?.document === node.ownerDocument)); }
    catch { /* Detached frames and destroyed execution contexts are stale. */ }
    if (!connected || capturedEpoch !== epoch) throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
    return handle;
  };
  return { capture, resolve, invalidate };
}
