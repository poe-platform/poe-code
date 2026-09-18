import type { PlaywrightPage, PlaywrightElementHandle, PlaywrightSnapshotHandle, PlaywrightSnapshotJSONCapture } from './adapter.js';
import { createFrameSnapshot } from './frame-snapshot.js';
import { captureNativePlaywrightSnapshot } from './native-snapshot.js';
import { captureNativePlaywrightJSON } from './native-json-snapshot.js';

export interface SnapshotLimits { readonly maxSnapshotBytes: number; readonly maxSnapshotRefs: number }

interface SnapshotResource { dispose(): Promise<void> }
type SnapshotReference = {
  readonly kind: 'capsule';
  readonly capsule: PlaywrightSnapshotHandle;
  readonly slot: number;
  native?: PlaywrightElementHandle;
} | { readonly kind: 'native'; readonly page: PlaywrightPage; readonly ref: string; native?: PlaywrightElementHandle };

class SnapshotStaleCaptureError extends Error {
  constructor() { super('Snapshot stale during capture'); }
}

async function captureStable<Result, Options extends { timeout?: number; root?: PlaywrightElementHandle }>(capture: (options: Options) => Promise<Result>, options: Options, signal?: AbortSignal): Promise<Result> {
  const timeout = options.timeout ?? 5000;
  const deadline = timeout === 0 ? undefined : Date.now() + timeout;
  try { return await capture(options); }
  catch (error) {
    // Retry only the read; a root handle may belong to the document that navigated away.
    if (!(error instanceof SnapshotStaleCaptureError) || options.root) throw error;
    signal?.throwIfAborted();
    const remaining = deadline === undefined ? 0 : deadline - Date.now();
    if (deadline !== undefined && remaining <= 0) throw error;
    return capture({ ...options, timeout: remaining });
  }
}

export function createSnapshotEngine(limits: SnapshotLimits, nextRef?: () => string) {
  for (const value of [limits?.maxSnapshotBytes, limits?.maxSnapshotRefs]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid snapshot limit');
  const { maxSnapshotBytes, maxSnapshotRefs } = limits;
  let sequence = 0;
  let epoch = 0;
  const retirements = new Set<Promise<void>>();
  const work = new Set<Promise<unknown>>();
  let actions = 0;
  const deferredHandles = new Set<SnapshotResource>();
  const resources = new Set<SnapshotResource>();
  const refs = new Map<string, SnapshotReference>();
  const withReferences = <Result>(action: () => Promise<Result>): Promise<Result> => {
    const operation = (async () => {
      actions++;
      let result!: Result;
      let failure: { error: unknown } | undefined;
      try { result = await action(); }
      catch (error) { failure = { error }; }
      actions--;
      if (actions === 0) {
        const handles = [...deferredHandles];
        deferredHandles.clear();
        try { await retire(handles); }
        catch (error) {
          if (failure) throw new AggregateError([failure.error, error], 'Snapshot action and cleanup failed');
          throw error;
        }
      }
      if (failure) throw failure.error;
      return result;
    })();
    work.add(operation);
    void operation.then(() => work.delete(operation), () => work.delete(operation));
    return operation;
  };
  const retire = async (handles: readonly SnapshotResource[]) => {
    const tasks = [...new Set(handles)].map(handle => Promise.resolve().then(() => handle.dispose()));
    for (const task of tasks) { retirements.add(task); void task.then(() => retirements.delete(task), () => {}); }
    const results = await Promise.allSettled([...retirements]);
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'Snapshot handle disposal failed');
  };
  const invalidate = async (drainActions = false) => {
    epoch++;
    const handles = [...resources];
    resources.clear();
    refs.clear();
    if (actions) {
      for (const handle of handles) deferredHandles.add(handle);
      await retire([]);
    } else await retire(handles);
    if (drainActions) {
      await Promise.allSettled([...work]);
      await retire([]);
    }
  };
  const capture = async (page: PlaywrightPage, signal?: AbortSignal, options: { depth?: number; boxes?: boolean; root?: PlaywrightElementHandle; timeout?: number } = {}): Promise<string> => captureStable(async options => {
    signal?.throwIfAborted();
    if (!page.ariaSnapshot && !page._snapshotForAI && (options.root || options.depth || options.boxes)) throw new Error('Native snapshot options unsupported by this browser');
    if (page.ariaSnapshot || page._snapshotForAI) {
      await invalidate();
      const capturedEpoch = epoch;
      const captured = await captureNativePlaywrightSnapshot(page, { maxBytes: maxSnapshotBytes, maxRefs: maxSnapshotRefs,
        nextRef: nextRef ?? (() => `e${++sequence}`), ...(signal ? { signal } : {}),
        ...options,
      });
      signal?.throwIfAborted();
      if (capturedEpoch !== epoch) throw new SnapshotStaleCaptureError();
      for (const [issued, ref] of captured.refs) refs.set(issued, { kind: 'native', page, ref });
      return captured.text;
    }
    if (typeof page.frames !== 'function') throw new Error('Snapshot engine unsupported: public frame evaluation required');
    const frames = page.frames();
    if (frames.some(frame => typeof frame.evaluateHandle !== 'function')) throw new Error('Snapshot engine unsupported: public frame evaluation required');
    await invalidate();
    const capturedEpoch = epoch;
    const acquired = new Set<SnapshotResource>();
    const pending = new Map<string, SnapshotReference>();
    let text = '';
    let bytes = 0;
    try {
      for (const frame of frames) {
        signal?.throwIfAborted();
        const capsule = await frame.evaluateHandle!(createFrameSnapshot, {
          maxSnapshotBytes: maxSnapshotBytes - bytes,
          maxSnapshotRefs: maxSnapshotRefs - pending.size,
        });
        acquired.add(capsule);
        signal?.throwIfAborted();
        const admission = await capsule.evaluate(value => ({ status: value.status, count: value.count }), undefined);
        if (admission.status === 'ref-limit' || admission.count > maxSnapshotRefs - pending.size) throw new PlaywrightResourceLimitError('Snapshot ref limit exceeded');
        if (admission.status !== 'ok' || !Number.isSafeInteger(admission.count) || admission.count < 0) throw new Error('Snapshot capture failed');
        const frameRefs: string[] = [];
        for (let slot = 0; slot < admission.count; slot++) {
          const ref = nextRef?.() ?? `e${++sequence}`;
          frameRefs.push(ref);
          pending.set(ref, { kind: 'capsule', capsule, slot });
        }
        signal?.throwIfAborted();
        const rendered = await capsule.evaluate((value, frameRefs) => value.render(frameRefs), frameRefs);
        if (rendered.status === 'byte-limit') throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
        if (rendered.status !== 'ok' || typeof rendered.text !== 'string') throw new Error('Snapshot capture failed');
        if (rendered.text.length > maxSnapshotBytes - bytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
        bytes += new TextEncoder().encode(rendered.text).byteLength;
        if (bytes > maxSnapshotBytes) throw new PlaywrightResourceLimitError('Snapshot byte limit exceeded');
        text += rendered.text;
      }
      signal?.throwIfAborted();
      if (capturedEpoch !== epoch) throw new SnapshotStaleCaptureError();
      for (const resource of acquired) resources.add(resource);
      for (const [ref, reference] of pending) refs.set(ref, reference);
      return text;
    } catch (error) {
      try { await retire([...acquired]); }
      catch (cleanup) {
        throw new AggregateError([error, ...(cleanup instanceof AggregateError ? cleanup.errors : [cleanup])], 'Snapshot capture and cleanup failed');
      }
      throw error;
    }
  }, options, signal);
  const resolve = async (ref: string): Promise<PlaywrightElementHandle> => {
    const reference = refs.get(ref);
    if (!reference) throw new Error(`Unknown or stale snapshot ref: ${ref}; snapshot again`);
    const capturedEpoch = epoch;
    if (reference.kind === 'native') {
      if (!reference.native) {
        const locator = reference.page.locator(`aria-ref=${reference.ref}`);
        if (!locator.elementHandle) throw new Error('Native snapshot target resolution unavailable');
        let handle: PlaywrightElementHandle | null;
        try { handle = await locator.elementHandle({ timeout: 30000 }); }
        catch { throw new Error(`Snapshot ref stale: ${ref}; snapshot again`); }
        if (!handle || capturedEpoch !== epoch) {
          if (handle) await retire([handle]);
          throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
        }
        resources.add(handle); reference.native = handle;
      }
      const connected = await reference.native.evaluate(node => node.isConnected);
      if (!connected || capturedEpoch !== epoch) throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
      return reference.native;
    }
    let connected = false;
    try {
      connected = await reference.capsule.evaluate((capsule, slot) => {
        const node = capsule.nodes[slot];
        return !!node && node.isConnected && (!node.ownerDocument || node.ownerDocument.defaultView?.document === node.ownerDocument);
      }, reference.slot);
    } catch { connected = false; }
    if (!connected || capturedEpoch !== epoch) throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
    if (!reference.native) {
      const handle = await reference.capsule.evaluateHandle((capsule, slot) => capsule.nodes[slot], reference.slot);
      const native = handle.asElement();
      if (!native || capturedEpoch !== epoch) {
        await retire([handle]);
        throw new Error(`Snapshot ref stale: ${ref}; snapshot again`);
      }
      resources.add(handle);
      reference.native = native;
    }
    return reference.native;
  };
  const captureJSON = async (page: PlaywrightPage, signal?: AbortSignal, options: { depth?: number; boxes?: boolean; root?: PlaywrightElementHandle; timeout?: number; captureJSON?: PlaywrightSnapshotJSONCapture } = {}) => captureStable(async options => {
    await invalidate();
    const capturedEpoch = epoch;
    const captured = await captureNativePlaywrightJSON(page, { maxBytes: maxSnapshotBytes, maxRefs: maxSnapshotRefs,
      nextRef: nextRef ?? (() => `e${++sequence}`), ...(signal ? { signal } : {}), ...options });
    signal?.throwIfAborted();
    if (capturedEpoch !== epoch) throw new SnapshotStaleCaptureError();
    for (const [issued, ref] of captured.refs) refs.set(issued, { kind: 'native', page, ref });
    return captured.tree;
  }, options, signal);
  return { capture, captureJSON, resolve, invalidate, withReferences, nativeSelector(ref: string): string | undefined {
    const reference = refs.get(ref);
    return reference?.kind === 'native' ? `aria-ref=${reference.ref}` : undefined;
  } };
}
import { PlaywrightResourceLimitError } from './resource-limit.js';
