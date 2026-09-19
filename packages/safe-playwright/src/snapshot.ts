import type { PlaywrightPage, PlaywrightElementHandle, PlaywrightFrame } from './adapter.js';

export interface SnapshotLimits { readonly maxSnapshotBytes: number; readonly maxSnapshotRefs: number }

/** Public element handles only. Shared by regular and Cloudflare injected pages.
 * This is a DOM interaction summary, not the full Playwright CLI accessibility tree.
 * Guest text is never compiled or evaluated as a locator or browser program.
 */
export function createSnapshotEngine(limits: SnapshotLimits, nextRef?: () => string) {
  for (const value of [limits?.maxSnapshotBytes, limits?.maxSnapshotRefs]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid snapshot limit');
  const { maxSnapshotBytes, maxSnapshotRefs } = limits;
  let sequence = 0;
  let epoch = 0;
  const retirements = new Set<Promise<void>>();
  const refs = new Map<string, { handle: PlaywrightElementHandle; frame: PlaywrightFrame }>();
  const invalidate = async (frame?: PlaywrightFrame) => {
    epoch++;
    const handles: PlaywrightElementHandle[] = [];
    for (const [ref, entry] of refs) {
      if (frame !== undefined && entry.frame !== frame) continue;
      handles.push(entry.handle);
      refs.delete(ref);
    }
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
    const pending = new Map<string, { handle: PlaywrightElementHandle; frame: PlaywrightFrame }>();
    let text = '';
    let bytes = 0;
    try {
      for (const frame of frames) {
        signal?.throwIfAborted();
        const handles = await frame.locator('button, input, textarea, select, a[href], [role], [contenteditable="true"]').elementHandles!();
        for (const handle of handles) acquired.add(handle);
        if (acquired.size > maxSnapshotRefs) throw new Error('Snapshot ref limit exceeded');
        for (const handle of handles) {
          signal?.throwIfAborted();
          const summary = await handle.evaluate(node => {
            const tag = node.tagName.toLowerCase();
            const roles: Record<string, string> = { button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox', a: 'link' };
            return { role: node.getAttribute('role') || roles[tag] || tag, name: node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.textContent || '' };
          });
          const ref = nextRef?.() ?? `e${++sequence}`;
          const line = `- ${JSON.stringify(summary.role).slice(1, -1)} ${JSON.stringify(summary.name.trim())} [ref=${ref}]\n`;
          bytes += new TextEncoder().encode(line).byteLength;
          if (bytes > maxSnapshotBytes) throw new Error('Snapshot byte limit exceeded');
          pending.set(ref, { handle, frame });
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
    const entry = refs.get(ref);
    if (!entry) throw new Error(`Unknown or stale snapshot ref: ${ref}; snapshot again`);
    const { handle } = entry;
    let connected = false;
    try { connected = await handle.evaluate(node => node.isConnected && (!node.ownerDocument || node.ownerDocument.defaultView?.document === node.ownerDocument)); }
    catch { /* Detached frames and destroyed execution contexts are stale. */ }
    if (!connected || refs.get(ref) !== entry) throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
    return handle;
  };
  return { capture, resolve, invalidate };
}
