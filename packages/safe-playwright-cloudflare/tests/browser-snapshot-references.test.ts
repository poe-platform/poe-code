import { expect, test, vi } from 'vitest';
import type { PlaywrightPage } from '@poe-platform/safe-bash/playwright';
import { captureBrowserSnapshotReferences } from '../src/browser-snapshot-references';

function fixture() {
  const document = { defaultView: {} as { document: unknown } };
  document.defaultView.document = document;
  const node = () => ({ isConnected: true, ownerDocument: document });
  const original = node();
  const liveNodes = [original];
  const elements = new Map([['e1', original]]);
  const script = { document, parseSelector: (selector: string) => selector, querySelectorAll: () => liveNodes, _lastAriaSnapshotForQuery: { elements } };
  let dead = false;
  const injected = { evaluate: vi.fn(async (fn, arg) => {
    if (dead) throw new Error('Execution context destroyed');
    return fn(script, arg);
  }) };
  const handles: { node: ReturnType<typeof node>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const locator = vi.fn((selector: string) => ({ async elementHandles() {
    const target = selector.startsWith('css=*') ? liveNodes[Number(selector.split('nth=')[1])] : elements.get('e1');
    if (!target) return [];
    const handle = { node: target, dispose: vi.fn(async () => {}) };
    handles.push(handle);
    return [handle];
  } }));
  const frame = { locator };
  const adopt = vi.fn<() => Promise<{ dispose(): void | Promise<void> }> | null>(() => null);
  const context = { async injectedScript() { return injected; }, adoptIfNeeded: adopt };
  const page = { frames: () => [frame], mainFrame: () => frame, _connection: { toImpl(value: unknown) {
    return value === frame ? { seq: 0, async _utilityContext() { return context; } } : (value as { node: unknown }).node;
  } } } as unknown as PlaywrightPage;
  return { page, original, elements, liveNodes, node, handles, locator, injected, adopt, destroy() { dead = true; } };
}

test('bulk witnesses capture without element handles and reject a recycled native ref', async () => {
  const f = fixture();
  const batch = await captureBrowserSnapshotReferences(f.page, ['e1', 'missing'], { signal: new AbortController().signal, timeoutMs: 5000 });
  expect(f.locator).not.toHaveBeenCalled();
  expect(f.injected.evaluate).toHaveBeenCalledTimes(1);
  expect(await batch.connected()).toEqual([true, false]);
  const replacement = f.node();
  f.elements.set('e1', replacement);
  f.original.isConnected = false;
  f.liveNodes.splice(0, 1, replacement);
  expect(await batch.connected()).toEqual([false, false]);
  expect(await batch.resolve(0)).toBeNull();
  expect(f.handles[0]!.dispose).toHaveBeenCalledOnce();
  f.elements.set('e1', f.original);
  f.original.isConnected = true;
  f.liveNodes.splice(0, 1, f.original);
  const handle = await batch.resolve(0);
  expect(handle).toBe(f.handles[1]);
  expect(f.handles[1]!.dispose).not.toHaveBeenCalled();
  await handle!.dispose();
  f.destroy();
  expect(await batch.connected()).toEqual([false, false]);
  expect(await batch.resolve(0)).toBeNull();
  expect(f.handles[2]!.dispose).toHaveBeenCalledOnce();
});

test('an external native snapshot changing aria IDs does not lose a connected original node', async () => {
  const f = fixture();
  const batch = await captureBrowserSnapshotReferences(f.page, ['e1'], { signal: new AbortController().signal, timeoutMs: 5000 });
  f.elements.delete('e1');
  f.elements.set('e2', f.original);
  expect(await batch.connected()).toEqual([true]);
  const handle = await batch.resolve(0);
  expect(handle).toBe(f.handles[0]);
  expect(f.locator).toHaveBeenLastCalledWith('css=* >> nth=0');
  await handle!.dispose();
});

test('adopted-handle cleanup failure also disposes the client candidate', async () => {
  const f = fixture();
  const batch = await captureBrowserSnapshotReferences(f.page, ['e1'], { signal: new AbortController().signal, timeoutMs: 5000 });
  f.adopt.mockResolvedValueOnce(Object.assign(f.original, { async dispose() { throw new Error('adopted cleanup failed'); } }));
  await expect(batch.resolve(0)).rejects.toThrow('adopted cleanup failed');
  expect(f.handles[0]!.dispose).toHaveBeenCalledOnce();
});

test('cancellation during bulk identity capture returns no batch or element resources', async () => {
  const f = fixture();
  const abort = new AbortController();
  f.injected.evaluate.mockImplementationOnce(async () => { abort.abort(new Error('cancelled')); return [1]; });
  await expect(captureBrowserSnapshotReferences(f.page, ['e1'], { signal: abort.signal, timeoutMs: 5000 })).rejects.toThrow('cancelled');
  expect(f.locator).not.toHaveBeenCalled();
});

test('cancellation interrupts a pending native identity read', async () => {
  const f = fixture();
  const abort = new AbortController();
  let finish!: (value: number[]) => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  f.injected.evaluate.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const operation = captureBrowserSnapshotReferences(f.page, ['e1'], { signal: abort.signal, timeoutMs: 5000 });
  await pending;
  abort.abort(new Error('cancelled in flight'));
  const settled = await Promise.race([operation.then(() => 'fulfilled', () => 'rejected'), new Promise(resolve => setTimeout(() => resolve('pending'), 20))]);
  finish([1]);
  await expect(operation).rejects.toThrow('cancelled in flight');
  expect(settled).toBe('rejected');
  expect(f.locator).not.toHaveBeenCalled();
});

for (const timeoutMs of [0, 5]) test(`bulk capture respects timeout=${timeoutMs}`, async () => {
  const f = fixture();
  let finish!: (value: number[]) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.injected.evaluate.mockImplementationOnce(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
  const operation = captureBrowserSnapshotReferences(f.page, ['e1'], { signal: new AbortController().signal, timeoutMs });
  const result = operation.then(() => 'fulfilled', error => error.name);
  await started;
  if (timeoutMs) expect(await result).toBe('TimeoutError');
  else expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('pending'), 10))])).toBe('pending');
  finish([1]);
  if (!timeoutMs) expect(await result).toBe('fulfilled');
});
