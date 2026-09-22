import { expect, it, vi } from 'vitest';
import { createEffectStore } from './effects.js';
import { Volume } from 'memfs';

it('observes a settled receipt once before validating and retaining its ordered bytes', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  let observations = 0;
  const receipt = { operation: 'write' as const, object: 'output', position: '0', count: 2,
    get bytes() { return ++observations === 1 ? [0, 255] : [256, 1]; } };
  try {
    store.record(receipt);
    expect(observations).toBe(1);
    expect(store.inspect().effects).toEqual([{ sequence: 0, operation: 'write', object: 'output', position: '0', count: 2, bytes: [0, 255] }]);
  } finally { await store.close(); }
});

it('owns ordered bytes before a later receipt accessor changes the source buffer', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const bytes = [0, 255];
  try {
    store.record({ operation: 'write', object: 'output', bytes,
      get count() { bytes[1] = 256; return 2; },
    });
    expect(store.inspect().effects).toEqual([{ sequence: 0, operation: 'write', object: 'output', count: 2, bytes: [0, 255] }]);
  } finally { await store.close(); }
});

it.each([0n, 1n])('checks retained freshness before completing an empty range at %s', async position => {
  const store = createEffectStore({ maxEffects: 1, maxFrameBytes: 1 });
  const identity = {}; let version = '1';
  const read = vi.fn(async () => Uint8Array.of(7));
  store.retain('output', { identity, async freshness() {
    const observed = version;
    return { identity, version: observed, async assertCurrent() {
      if (observed !== version) throw new Error('Output content changed');
    } };
  }, async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
  store.record({ operation: 'created', object: 'output', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  try {
    const guard = await store.freshness('output');
    expect(await new Response(store.download('output', position, position, undefined, guard)).arrayBuffer()).toHaveProperty('byteLength', 0);
    version = '2';
    await expect(new Response(store.download('output', position, position, undefined, guard)).arrayBuffer()).rejects.toThrow('Output content changed');
    expect(read).not.toHaveBeenCalled();
    expect(store.inspect().native).toEqual({ state: 'exited', exitCode: 1 });
  } finally { await store.close(); }
});

it('drains empty-range freshness validation before closing the retained output', async () => {
  const store = createEffectStore({ maxEffects: 1, maxFrameBytes: 1 });
  const identity = {}; let block = false;
  let entered!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const close = vi.fn(async () => {});
  const read = vi.fn(async () => new Uint8Array());
  store.retain('output', { identity, async freshness() {
    return { identity, version: '1', async assertCurrent(signal) {
      if (!block) return;
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    } };
  }, async stat() { return { type: 'file', size: 0n }; }, read, close });
  store.record({ operation: 'created', object: 'output', path: [47, 97] });
  try {
    const guard = await store.freshness('output');
    block = true;
    const reader = store.download('output', 0n, 0n, undefined, guard).getReader();
    const interrupted = expect(reader.read()).rejects.toThrow('Effect retention closed');
    await validating;
    expect(close).not.toHaveBeenCalled();
    await store.close();
    await interrupted;
    reader.releaseLock();
    expect(close).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  } finally { await store.close(); }
});

it('qualifies interrupted range downloads by retained identity and content version', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const identity = {}; let version = '1';
  const bytes = Uint8Array.of(0, 255, 2);
  store.retain('segment', { identity, async freshness() {
    const observed = version;
    return { identity, version: observed, async assertCurrent() {
      if (observed !== version) throw new Error('Output content changed');
    } };
  }, async stat() { return { type: 'file', size: 3n }; },
  async read(position, count) { return bytes.slice(Number(position), Number(position) + count); }, async close() {} });
  store.record({ operation: 'created', object: 'segment', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  try {
    const guard = await store.freshness('segment');
    expect(guard).toMatchObject({ identity, version: '1' });
    expect(await store.stat('segment', undefined, guard)).toMatchObject({ size: '3' });
    const reader = store.download('segment', 0n, 3n, undefined, guard).getReader();
    expect((await reader.read()).value).toEqual(Uint8Array.of(0));
    await reader.cancel('consumer closed'); reader.releaseLock();
    expect(new Uint8Array(await new Response(store.download('segment', 1n, 3n, undefined, guard)).arrayBuffer())).toEqual(Uint8Array.of(255, 2));
    version = '2'; bytes[1] = 7;
    await expect(store.stat('segment', undefined, guard)).rejects.toThrow('Output content changed');
    await expect(new Response(store.download('segment', 1n, 3n, undefined, guard)).arrayBuffer()).rejects.toThrow('Output content changed');
    expect(store.inspect().native).toEqual({ state: 'exited', exitCode: 1 });
  } finally { await store.close(); }
});

it('rejects range freshness from another retained file or invocation', async () => {
  const stores = [createEffectStore({ maxEffects: 2, maxFrameBytes: 1 }), createEffectStore({ maxEffects: 2, maxFrameBytes: 1 })];
  const read = vi.fn(async () => Uint8Array.of(7));
  for (const store of stores) for (const object of ['a', 'b']) {
    const identity = {};
    store.retain(object, { identity, async freshness() { return { identity, version: '1', async assertCurrent() {} }; },
      async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
    store.record({ operation: 'created', object, path: [47, object.charCodeAt(0)] });
  }
  try {
    const guard = await stores[0].freshness('a');
    for (const [store, object] of [[stores[0], 'b'], [stores[1], 'a']] as const) {
      await expect(store.stat(object, undefined, guard)).rejects.toThrow('another retained file');
      await expect(new Response(store.download(object, 0n, 1n, undefined, guard)).arrayBuffer()).rejects.toThrow('another retained file');
    }
    expect(read).not.toHaveBeenCalled();
  } finally { await Promise.all(stores.map(store => store.close())); }
});

it('does not expose untouched retained inputs through the output retrieval API', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 });
  const read = vi.fn(async () => Uint8Array.of(7));
  store.retain('prior', { async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
  store.record({ operation: 'open', object: 'prior', path: [47, 112] });
  try {
    await expect(store.stat('prior')).rejects.toThrow('Not an invocation output');
    const reader = store.download('prior', 0n, 1n).getReader();
    await expect(reader.read()).rejects.toThrow('Not an invocation output');
    reader.releaseLock();
    expect(read).not.toHaveBeenCalled();
    store.record({ operation: 'write', object: 'prior', position: '0', bytes: [7], count: 1 });
    expect(await store.stat('prior')).toMatchObject({ size: '1' });
    const output = store.download('prior', 0n, 1n).getReader();
    expect((await output.read()).value).toEqual(Uint8Array.of(7));
    await output.cancel();
  } finally { await store.close(); }
});

it('retires an idle aborted download before another consumer resumes the retained output', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const bytes = Uint8Array.of(0, 255, 2);
  const close = vi.fn(async () => {});
  store.retain('output', { async stat() { return { type: 'file', size: 3n }; },
    async read(position, count) { return bytes.slice(Number(position), Number(position) + count); }, close });
  store.record({ operation: 'created', object: 'output', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  try {
    const abort = new AbortController();
    const reader = store.download('output', 0n, 3n, abort.signal).getReader();
    expect((await reader.read()).value).toEqual(bytes.slice(0, 1));
    abort.abort(new Error('consumer interrupted'));
    await expect(reader.read()).rejects.toThrow('consumer interrupted');
    reader.releaseLock();
    const resumed = store.download('output', 1n, 3n).getReader();
    expect((await resumed.read()).value).toEqual(bytes.slice(1, 2));
    expect((await resumed.read()).value).toEqual(bytes.slice(2));
    expect((await resumed.read()).done).toBe(true);
    resumed.releaseLock();
    expect(close).not.toHaveBeenCalled();
    expect(store.inspect().native).toEqual({ state: 'exited', exitCode: 1 });
  } finally { await store.close(); }
  expect(close).toHaveBeenCalledOnce();
});

it('resumes canonical retrieval through recreated adapters only for the same destination authority', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const identity = Symbol('destination');
  const guard = { identity: {}, version: '1', async assertCurrent() {} };
  store.retain('image', { identity: guard.identity, async freshness() { return guard; }, async stat() { return { type: 'file', size: 2n }; },
    async read(position, count) { return Uint8Array.of(0, 255).slice(Number(position), Number(position) + count); }, async close() {} });
  store.record({ operation: 'created', object: 'image', path: [47, 119, 47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  let quota = true;
  const destination = () => ({ identity, async mkdir() {}, async open() {
    const fd = volume.openSync('/out/a', volume.existsSync('/out/a') ? 'r+' : 'w+');
    return { async write(position: bigint, bytes: Uint8Array) { if (quota && position > 0n) throw new Error('EDQUOT'); return volume.writeSync(fd, bytes, 0, quota ? 1 : bytes.length, Number(position)); },
      async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } });
  try {
    const first = await store.retrieve([47, 119], destination());
    expect(first).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
    expect(first.transfer.cursor.offsets.get('a')).toBe(1n);
    quota = false;
    const resumed = await store.retrieve([47, 119], destination(), first.transfer.cursor);
    expect(resumed).toMatchObject({ native: first.native, transfer: { state: 'complete' } });
    expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([0, 255]));
    expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  } finally { await store.close(); }
});

it('preserves unidentifiable settled writes and transfers known files after native cancellation', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const volume = Volume.fromJSON({ '/download/prior': 'unrelated' });
  store.record({ operation: 'write', position: '0', bytes: [0, 255], count: 2, callbackId: 'unlocated', stage: 'native-write' });
  store.retain('segment', { async stat() { return { type: 'file', size: 0n }; }, async read() { return new Uint8Array(); }, async close() {} });
  store.record({ operation: 'created', object: 'segment', path: bytes('/work/segment.ts') });
  store.settle({ state: 'cancelled', error: 'later cancellation' });
  try {
    expect(store.inspectTree(bytes('/work')).unresolvedEffects).toEqual(['0']);
    const result = await store.retrieve(bytes('/work'), { async mkdir() {}, async open(path) {
      volume.writeFileSync('/download/' + new TextDecoder().decode(path), '');
      return { async write() { return 0; }, async truncate() {}, async close() {} };
    } });
    expect(result).toMatchObject({ native: { state: 'cancelled', error: 'later cancellation' },
      manifest: { effects: [{ sequence: 0, operation: 'write', bytes: [0, 255], count: 2, callbackId: 'unlocated', stage: 'native-write' }, { sequence: 1, operation: 'created' }] },
      transfer: { state: 'failed' } });
    expect(result.transfer.cursor.completed).toEqual(new Set(['segment.ts']));
    expect(volume.readdirSync('/download')).toEqual(['prior', 'segment.ts']);
  } finally { await store.close(); }
});

it('keeps a settled rename with missing namespace names downloadable without reconstructing its former name', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 2 });
  const path = (value: string) => Array.from(new TextEncoder().encode(value));
  store.retain('image', { async stat() { return { type: 'file', size: 2n }; },
    async read(position, length) { return Uint8Array.of(0, 255).slice(Number(position), Number(position) + length); }, async close() {} });
  store.record({ operation: 'created', object: 'image', path: path('/work/intermediate.png') });
  store.record({ operation: 'rename', object: 'image', moved: true });
  store.settle({ state: 'cancelled', error: 'later cancellation' });
  try {
    expect(store.inspectTree(path('/work'))).toMatchObject({ files: [], retainedIdentities: ['image'],
      unlocatedIdentities: ['image'], unresolvedEffects: ['1'] });
    expect(Array.from(new Uint8Array(await new Response(store.download('image', 1n, 2n)).arrayBuffer()))).toEqual([255]);
    const open = vi.fn();
    const result = await store.retrieve(path('/work'), { async mkdir() {}, open });
    expect(result).toMatchObject({ native: { state: 'cancelled', error: 'later cancellation' }, transfer: { state: 'failed' } });
    expect(open).not.toHaveBeenCalled();
  } finally { await store.close(); }
});

it('reports unlocated settled output retention failure after transferring independent files', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 2 });
  store.record({ operation: 'write', object: 'missing', position: '0', bytes: [255], count: 1 });
  store.failRetrieval('missing', new Error('retention quota'));
  store.retain('known', { async stat() { return { type: 'file', size: 0n }; }, async read() { return new Uint8Array(); }, async close() {} });
  store.record({ operation: 'created', object: 'known', path: [47, 119, 47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  try {
    expect(store.inspectTree([47, 119]).unlocatedIdentities).toEqual(['missing']);
    const result = await store.retrieve([47, 119], { async mkdir() {}, async open(path) {
      volume.writeFileSync('/out/' + new TextDecoder().decode(path), '');
      return { async write() { return 0; }, async truncate() {}, async close() {} };
    } });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' },
      manifest: { retrievalFailures: [{ object: 'missing', error: 'retention quota' }] } });
    expect(result.transfer.cursor.completed).toEqual(new Set(['a']));
    expect(volume.readFileSync('/out/a', 'utf8')).toBe('');
    expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  } finally { await store.close(); }
});

it.each(['write', 'truncate'] as const)('closes an acquired output when %s admission fails without undoing canonical writes', async method => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const path = (value: string) => Array.from(new TextEncoder().encode(value));
  const failure = new Error('destination operation admission failed');
  const close = vi.fn(async () => {});
  const replacedClose = vi.fn(async () => {});
  const read = vi.fn(async () => Uint8Array.of(7));
  store.retain('output', { async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
  store.record({ operation: 'write', path: path('/work/output'), object: 'output', bytes: [7], count: 1, position: '0' });
  store.settle({ state: 'exited', exitCode: 1 });
  const file = { async write() { return 1; }, async truncate() {}, close };
  Object.defineProperty(file, method, { get() { file.close = replacedClose; throw failure; } });
  try {
    const result = await store.retrieve(path('/work'), { async mkdir() {}, async open() { return file; } });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: failure } });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(replacedClose).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(store.inspect().effects).toMatchObject([{ operation: 'write', bytes: [7], count: 1 }]);
  } finally { await store.close(); }
});

it('retrieves later retained files when an earlier settled output retain failed', async () => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  const path = (name: string) => Array.from(new TextEncoder().encode('/work/' + name));
  store.record({ operation: 'created', path: path('missing'), object: 'missing' });
  store.failRetrieval('missing', new Error('retention quota'));
  store.retain('known', { async stat() { return { type: 'file', size: 0n }; },
    async read() { return new Uint8Array(); }, async close() {} });
  store.record({ operation: 'created', path: path('known'), object: 'known' });
  store.settle({ state: 'cancelled', error: 'later cancellation' });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  try {
    const result = await store.retrieve(Array.from(new TextEncoder().encode('/work')), {
      async mkdir() {}, async open(relative) {
        volume.writeFileSync('/out/' + new TextDecoder().decode(relative), '');
        return { async write() { return 0; }, async truncate() {}, async close() {} };
      },
    });
    expect(result).toMatchObject({ native: { state: 'cancelled' }, transfer: { state: 'failed' },
      manifest: { retrievalFailures: [{ object: 'missing', error: 'retention quota' }] } });
    expect(result.transfer.cursor.completed).toEqual(new Set(['known']));
    expect(store.inspectTree(Array.from(new TextEncoder().encode('/work')))).toMatchObject({
      retainedIdentities: ['known'], unavailablePaths: [{ path: path('missing'), relativePath: Array.from(new TextEncoder().encode('missing')) }],
    });
    expect(volume.existsSync('/out/missing')).toBe(false);
    expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  } finally { await store.close(); }
});

it('retrieves retained frames using the configured bound after native failure', async () => {
  const bytes = new Uint8Array(1048577).fill(255);
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: bytes.length });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const read = vi.fn(async (position: bigint, length: number) => bytes.slice(Number(position), Number(position) + length));
  store.retain('output', { async stat() { return { type: 'file', size: BigInt(bytes.length) }; }, read, async close() {} });
  store.record({ operation: 'created', path: Array.from(new TextEncoder().encode('/work/output')), object: 'output' });
  store.settle({ state: 'exited', exitCode: 1 });
  try {
    const result = await store.retrieve(Array.from(new TextEncoder().encode('/work')), {
      async mkdir() {},
      async open(path) {
        const fd = volume.openSync('/out/' + new TextDecoder().decode(path), 'w+');
        return {
          async write(position, fragment) { return volume.writeSync(fd, fragment, 0, fragment.length, Number(position)); },
          async truncate(size) { volume.ftruncateSync(fd, Number(size)); },
          async close() { volume.closeSync(fd); },
        };
      },
    });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
    expect(read.mock.calls.map(([, length]) => length)).toEqual([bytes.length]);
    expect((volume.readFileSync('/out/output') as Buffer).equals(Buffer.from(bytes))).toBe(true);
    expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  } finally { await store.close(); }
});

it('retrieves independent outputs and exposes partial inspection when a later rename outcome is unavailable', async () => {
  const store = createEffectStore({ maxEffects: 6, maxFrameBytes: 2 });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  for (const object of ['safe', 'moved']) {
    store.retain(object, { async stat() { return { type: 'file', size: 1n }; },
      async read() { return Uint8Array.of(255); }, async close() {} });
    store.record({ operation: 'created', path: bytes('/work/' + object), object });
  }
  store.record({ operation: 'rename', path: bytes('/work/moved'), destination: bytes('/work/replaced') });
  store.settle({ state: 'failed', error: 'later native error' });
  const tree = store.inspectTree(bytes('/work'));
  expect(tree.files.map(file => file.object)).toEqual(['safe']);
  expect(tree.unresolvedEffects).toEqual(['2']);
  expect(tree.unlocatedIdentities).toEqual(['moved']);
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await store.retrieve(bytes('/work'), { async mkdir() {}, async open(path) {
    const name = '/out/' + new TextDecoder().decode(path);
    return { async write(_position, value) { volume.writeFileSync(name, value); return value.length; },
      async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ native: { state: 'failed', error: 'later native error' }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['safe']));
  expect(volume.readFileSync('/out/safe')).toEqual(Buffer.from([255]));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(volume.existsSync('/out/moved')).toBe(false);
  expect(volume.existsSync('/out/replaced')).toBe(false);
  await store.close();
});

it('keeps identity-only uncertain renames downloadable without reconstructing stale canonical paths', async () => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const close = vi.fn(async () => {});
  store.retain('image', { async stat() { return { type: 'file', size: 2n }; },
    async read(position, length) { return Uint8Array.of(0, 255).slice(Number(position), Number(position) + length); }, close });
  store.record({ operation: 'created', object: 'image', path: bytes('/work/intermediate.png') });
  store.record({ operation: 'rename', object: 'image' });
  store.record({ operation: 'write', object: 'image', path: bytes('/work/intermediate.png'), position: '0', bytes: [0, 255], count: 2 });
  store.settle({ state: 'cancelled', error: 'native cancellation' });
  try {
    expect(store.inspectTree(bytes('/work'))).toMatchObject({ files: [], retainedIdentities: ['image'], unlocatedIdentities: ['image'], unresolvedEffects: ['1'] });
    const reader = store.download('image', 1n, 2n).getReader();
    expect((await reader.read()).value).toEqual(Uint8Array.of(255));
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
    const open = vi.fn();
    const result = await store.retrieve(bytes('/work'), { async mkdir() {}, open });
    expect(result).toMatchObject({ native: { state: 'cancelled', error: 'native cancellation' }, transfer: { state: 'failed' } });
    expect(open).not.toHaveBeenCalled();
    expect(result.manifest.effects).toHaveLength(3);
  } finally { await store.close(); }
  expect(close).toHaveBeenCalledOnce();
});

it('keeps namespace observations in inspection without replaying opens as canonical mutations', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 });
  store.retain('untouched', { async stat() { return { type: 'file', size: 0n }; }, async read() { return new Uint8Array(); }, async close() {} });
  store.record({ operation: 'mkdir', path: [47, 97] });
  store.record({ operation: 'open', object: 'untouched', path: [47, 97, 47, 98] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const applied: string[] = [];
  const result = await store.reconstruct({ async apply(effect) { applied.push(effect.operation); } });
  expect(result).toMatchObject({ native: { state: 'cancelled' }, transfer: { state: 'complete', nextSequence: 2 } });
  expect(result.manifest.effects.map(effect => effect.operation)).toEqual(['mkdir', 'open']);
  expect(result.manifest.outputs).toEqual([]);
  expect(applied).toEqual(['mkdir']);
  await store.close();
});

it('pins canonical tree destination capabilities before retained host work and partial writes', async () => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  const volume = Volume.fromJSON({ '/download/prior': 'unrelated' });
  const redirected = vi.fn(async (): Promise<never> => { throw new Error('redirected destination'); });
  const fd = volume.openSync('/download/file', 'w+');
  const truncate = vi.fn(async (size: bigint) => { volume.ftruncateSync(fd, Number(size)); });
  const close = vi.fn(async () => { volume.closeSync(fd); });
  const file = { async write(position: bigint, bytes: Uint8Array) {
    file.write = redirected; file.truncate = redirected; file.close = redirected;
    return volume.writeSync(fd, bytes, 0, 1, Number(position));
  }, truncate, close };
  const open = vi.fn(async () => file);
  const destination = { async mkdir() {}, open };
  store.retain('file', { async stat() {
    destination.open = redirected;
    return { type: 'file', size: 2n };
  }, async read(position, length) { return Uint8Array.of(0, 255).slice(Number(position), Number(position) + length); }, async close() {} });
  store.record({ operation: 'created', object: 'file', path: [47, 102, 105, 108, 101] });
  store.settle({ state: 'exited', exitCode: 1 });
  const result = await store.retrieve([47], destination);
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
  expect(volume.readFileSync('/download/file')).toEqual(Buffer.from([0, 255]));
  expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  expect(redirected).not.toHaveBeenCalled();
  expect(truncate).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  await store.close();
});

it('pins the reconstruction consumer while independently settling ordered effects', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  store.record({ operation: 'mkdir', path: [47, 97] });
  store.record({ operation: 'mkdir', path: [47, 98] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const applied: number[] = [];
  const redirected = vi.fn(async () => { throw new Error('redirected consumer'); });
  const destination = { async apply(effect: { sequence: number }) {
    applied.push(effect.sequence); destination.apply = redirected;
  } };
  expect(await store.reconstruct(destination)).toMatchObject({ native: { state: 'cancelled' }, transfer: { state: 'complete', nextSequence: 2 } });
  expect(applied).toEqual([0, 1]); expect(redirected).not.toHaveBeenCalled();
  await store.close();
});

it('retrieves settled regular outputs despite an unsupported symlink produced before native failure', async () => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  const path = (name: string) => Array.from(new TextEncoder().encode('/work/' + name));
  store.retain('image', { async stat() { return { type: 'file', size: 2n }; },
    async read(position, length) { return Uint8Array.of(0, 255).slice(Number(position), Number(position) + length); }, async close() {} });
  store.record({ operation: 'created', object: 'image', path: path('intermediate.png') });
  store.record({ operation: 'symlink', path: path('alias'), target: [105, 110, 112, 117, 116] });
  store.settle({ state: 'exited', exitCode: 1 });
  const tree = store.inspectTree(Array.from(new TextEncoder().encode('/work')));
  expect(tree.files).toHaveLength(1);
  expect(tree.unavailablePaths).toEqual([{ path: path('alias'), relativePath: [97, 108, 105, 97, 115] }]);
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await store.retrieve(Array.from(new TextEncoder().encode('/work')), {
    async mkdir() {}, async open(path) {
      const fd = volume.openSync('/out/' + new TextDecoder().decode(path), 'w+');
      return { async write(position, bytes) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
        async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    },
  });
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['intermediate.png']));
  expect(volume.readFileSync('/out/intermediate.png')).toEqual(Buffer.from([0, 255]));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  await store.close();
});

it.each(['exited', 'failed', 'cancelled'] as const)('keeps the %s native receipt immutable when a later transfer fails', async state => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  store.record({ operation: 'mkdir', path: [47, 111, 117, 116] });
  const native = state === 'exited' ? { state, exitCode: 1 } : { state, error: 'native failure' };
  store.settle(native);
  expect(() => store.settle({ state: 'failed', error: 'destination read-only' })).toThrow('Native settlement already recorded');
  const result = await store.reconstruct({ async apply() { throw new Error('destination read-only'); } });
  expect(result).toMatchObject({ native, manifest: { native, effects: [{ operation: 'mkdir' }] }, transfer: { state: 'failed', nextSequence: 0 } });
  await store.close();
});

it('cancels destination IO on owner closure without rolling back an earlier completed file', async () => {
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 1 });
  for (const object of ['first', 'second']) {
    store.retain(object, { async stat() { return { type: 'file', size: 1n }; }, async read() { return Uint8Array.of(255); }, async close() {} });
    store.record({ operation: 'created', object, path: Array.from(new TextEncoder().encode('/' + object)) });
  }
  store.settle({ state: 'exited', exitCode: 1 });
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let received: AbortSignal | undefined;
  const closed: string[] = [];
  const transfer = store.retrieve([47], { async mkdir() {}, async open(path) {
    const name = new TextDecoder().decode(path);
    const fd = volume.openSync('/out/' + name, 'w+');
    return { async write(position, bytes, signal) {
      if (name === 'second') { received = signal; entered(); await pending; signal?.throwIfAborted(); }
      return volume.writeSync(fd, bytes, 0, bytes.length, Number(position));
    }, async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); closed.push(name); } };
  } });
  await writing;
  const retirement = store.close();
  try { expect(received?.aborted).toBe(true); }
  finally { finish(); }
  const [result] = await Promise.all([transfer, retirement]);
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', path: 'second' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['first']));
  expect(volume.readFileSync('/out/first')).toEqual(Buffer.from([255]));
  expect(volume.readFileSync('/out/second')).toEqual(Buffer.alloc(0));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(closed).toEqual(['first', 'second']);
});

it('propagates retained owner closure to an admitted reconstruction consumer', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  store.record({ operation: 'mkdir', path: [47, 100] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  let entered!: () => void;
  const applying = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let received: AbortSignal | undefined;
  const transfer = store.reconstruct({ async apply(_effect, signal) { received = signal; entered(); await pending; } });
  await applying;
  await store.close();
  try { expect(received?.aborted).toBe(true); }
  finally { finish(); }
  expect(await transfer).toMatchObject({ native: { state: 'cancelled', error: 'native cancelled' },
    transfer: { state: 'failed', nextSequence: 1 } });
});

it('aborts a pending tree retrieval when its retained owner closes, preserving native failure', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const pending = new Promise<Uint8Array>(resolve => { finish = () => resolve(Uint8Array.of(255)); });
  const close = vi.fn(async () => {});
  store.retain('a', { async stat() { return { type: 'file', size: 1n }; }, async read() { entered(); return pending; }, close });
  store.record({ operation: 'created', object: 'a', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const write = vi.fn(async () => 1); const destinationClose = vi.fn(async () => {});
  const transfer = store.retrieve([47], { async mkdir() {}, async open() {
    return { write, async truncate() {}, close: destinationClose };
  } });
  await reading;
  const retirement = store.close();
  // Cleanup still owns the admitted backend read until it settles.
  finish();
  const [result] = await Promise.all([transfer, retirement]);
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: expect.any(Error) } });
  expect(destinationClose).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('settles idle downloads when their retained owner closes', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const close = vi.fn(async () => {});
  store.retain('a', { async stat() { return { type: 'file', size: 2n }; }, async read() { return Uint8Array.of(255); }, close });
  store.record({ operation: 'created', object: 'a', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const manifest = store.inspect();
  const reader = store.download('a', 0n, 2n).getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(255));
  const closed = expect(reader.closed).rejects.toThrow('Effect retention closed');
  await store.close();
  await closed;
  reader.releaseLock();
  expect(close).toHaveBeenCalledOnce();
  expect(manifest.native).toEqual({ state: 'exited', exitCode: 1 });
});

it.each([false, true])('settles an aborted output consumer without another pull (started=%s)', async started => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const read = vi.fn(async () => Uint8Array.of(255));
  store.retain('a', { async stat() { return { type: 'file', size: 2n }; }, read, async close() {} });
  store.record({ operation: 'created', object: 'a', path: [47, 97] });
  const abort = new AbortController();
  const reason = new Error('Consumer closed');
  const reader = store.download('a', 0n, 2n, abort.signal).getReader();
  if (started) expect((await reader.read()).value).toEqual(Uint8Array.of(255));
  let failure: unknown;
  const closed = reader.closed.catch(error => { failure = error; });
  abort.abort(reason);
  await Promise.resolve();
  await Promise.resolve();
  expect(failure).toBe(reason);
  await closed;
  reader.releaseLock();
  expect(read).toHaveBeenCalledTimes(started ? 1 : 0);
  const resumed = store.download('a', started ? 1n : 0n, 2n).getReader();
  expect((await resumed.read()).value).toEqual(Uint8Array.of(255));
  await resumed.cancel();
  resumed.releaseLock();
  await store.close();
});

it('rejects an already cancelled output consumer before acquiring a retained read', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const read = vi.fn(async () => Uint8Array.of(1));
  store.retain('a', { async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
  const abort = new AbortController(); const reason = new Error('Consumer closed'); abort.abort(reason);
  expect(() => store.download('a', 0n, 1n, abort.signal)).toThrow(reason);
  expect(read).not.toHaveBeenCalled();
  await store.close();
});

it.each([[-1n, 1n], [2n, 1n], [0n, 9223372036854775808n]])('rejects invalid output ranges before acquiring retained reads (%s, %s)', async (start, end) => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const read = vi.fn(async () => Uint8Array.of(1));
  store.retain('a', { async stat() { return { type: 'file', size: 1n }; }, read, async close() {} });
  expect(() => store.download('a', start, end)).toThrow('Unrepresentable file range');
  expect(read).not.toHaveBeenCalled();
  await store.close();
});

it('keeps a retained no-op rename receipt without promoting an untouched input to output', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.retain('prior', { async stat() { return { type: 'file', size: 0n }; }, async read() { return new Uint8Array(); }, async close() {} });
  store.record({ operation: 'rename', object: 'prior', path: [47, 119, 47, 97], destination: [47, 119, 47, 98], moved: false });
  store.settle({ state: 'exited', exitCode: 1 });
  expect(store.inspect().effects).toHaveLength(1);
  expect(store.inspectTree([47, 119])).toMatchObject({ files: [], retainedIdentities: [] });
  await store.close();
});

it.each([false, true])('pins output authority at retention before lazy download (download=%s)', async download => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const close = vi.fn(async () => {});
  const replacement = vi.fn(async () => {});
  const resource = {
    bytes: Uint8Array.of(1),
    async stat() { return { type: 'file' as const, size: BigInt(this.bytes.length) }; },
    async read(position: bigint, length: number) { return this.bytes.slice(Number(position), Number(position) + length); },
    close,
  };
  store.retain('output', resource);
  store.record({ operation: 'created', object: 'output', path: [47, 119, 47, 97] });
  resource.bytes = Uint8Array.of(0, 255);
  resource.stat = async () => ({ type: 'file', size: 0n });
  resource.read = async () => Uint8Array.of(9);
  resource.close = replacement;
  if (download) {
    expect(await store.stat('output')).toMatchObject({ size: '2' });
    const reader = store.download('output', 0n, 2n).getReader();
    expect((await reader.read()).value).toEqual(Uint8Array.of(0, 255));
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
  }
  await store.close();
  expect(close).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it('keeps an unretained settled link visible after native cancellation', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'link', destination: [47, 119, 47, 97] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  expect(store.inspectTree([47, 119])).toMatchObject({ files: [],
    unavailablePaths: [{ path: [47, 119, 47, 97], relativePath: [97] }] });
  const open = vi.fn(async () => { throw new Error('No retained link identity'); });
  expect(await store.retrieve([47, 119], { async mkdir() {}, open })).toMatchObject({
    manifest: { effects: [{ operation: 'link', sequence: 0 }] },
    native: { state: 'cancelled', error: 'native cancelled' }, transfer: { state: 'failed' },
  });
  expect(open).not.toHaveBeenCalled();
  await store.close();
});

it('stops suffix writes after owner closure and keeps the settled partial receipt', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.retain('a', {
    async stat() { return { type: 'file', size: 2n }; },
    async read() { return Uint8Array.of(0, 255); },
    async close() {},
  });
  store.record({ operation: 'created', object: 'a', path: [47, 119, 47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const write = vi.fn(async () => { await store.close(); return 1; });
  const truncate = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const result = await store.retrieve([47, 119], {
    async mkdir() {}, async open() { return { write, truncate, close }; },
  });
  expect(write).toHaveBeenCalledOnce();
  expect(truncate).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.offsets.get('a')).toBe(1n);
});

it('stops reconstruction after owner closure while preserving the admitted settlement', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 2 });
  store.record({ operation: 'mkdir', path: [47, 119, 47, 97] });
  store.record({ operation: 'mkdir', path: [47, 119, 47, 98] });
  store.settle({ state: 'exited', exitCode: 1 });
  const applied: number[] = [];
  const result = await store.reconstruct({ async apply(effect) {
    applied.push(effect.sequence);
    await store.close();
  } });
  expect(applied).toEqual([0]);
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', nextSequence: 1 } });
  expect(result.manifest.effects).toHaveLength(2);
});

it.each([1, 2])('stops directory retrieval after owner closure without rolling back completed directories (count=%s)', async count => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 2 });
  store.record({ operation: 'mkdir', path: [47, 119, 47, 97] });
  if (count === 2) store.record({ operation: 'mkdir', path: [47, 119, 47, 98] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const result = await store.retrieve([47, 119], {
    async mkdir(path) {
      volume.mkdirSync('/out/' + new TextDecoder().decode(path));
      await store.close();
    },
    async open() { throw new Error('No file outputs'); },
  });
  expect(volume.existsSync('/out/a')).toBe(true);
  expect(volume.existsSync('/out/b')).toBe(false);
  expect(result).toMatchObject({ native: { state: 'cancelled', error: 'native cancelled' }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.directories).toEqual(new Set(['a']));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
});

it('drains an admitted freshness check before closing its retained output', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const close = vi.fn(async () => {});
  store.retain('a', {
    async freshness(signal) {
      entered.resolve(); await finish.promise; signal?.throwIfAborted();
      return { identity: {}, version: '1', async assertCurrent() {} };
    },
    async stat() { return { type: 'file', size: 0n }; },
    async read() { return new Uint8Array(); }, close,
  });
  store.record({ operation: 'created', object: 'a', path: [47, 119, 47, 97] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const open = vi.fn(async () => { throw new Error('closed owner'); });
  const retrieval = store.retrieve([47, 119], { async mkdir() {}, open });
  await entered.promise;
  const retirement = store.close();
  expect(close).not.toHaveBeenCalled();
  finish.resolve();
  expect(await retrieval).toMatchObject({ native: { state: 'cancelled', error: 'native cancelled' }, transfer: { state: 'failed' } });
  await retirement;
  expect(open).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});

it('rejects freshness for a different retained identity before mutating the destination', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.retain('a', {
    identity: {},
    async freshness() { return { identity: {}, version: '1', async assertCurrent() {} }; },
    async stat() { return { type: 'file', size: 0n }; },
    async read() { return new Uint8Array(); },
    async close() {},
  });
  store.record({ operation: 'created', object: 'a', path: [47, 119, 47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const open = vi.fn(async () => ({ async write() { return 0; }, async truncate() {}, async close() {} }));
  const result = await store.retrieve([47, 119], { async mkdir() {}, open });
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: expect.any(TypeError) } });
  expect(open).not.toHaveBeenCalled();
  await store.close();
});

it('keeps produced identities visible when retention fails and transfer cannot retrieve them', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'created', object: 'missing', path: [47, 119, 47, 97] });
  store.failRetrieval('missing', new Error('retention quota'));
  store.settle({ state: 'exited', exitCode: 0 });
  expect(store.inspect().outputs).toEqual(['missing']);
  const result = await store.retrieve([47, 119], { async mkdir() {}, async open() { throw new Error('no retain'); } });
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 0 }, transfer: { state: 'failed' }, manifest: { outputs: ['missing'] } });
  await store.close();
});

it('preserves inspected settlement receipts when a reconstruction consumer mutates its input', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'write', object: 'a', path: [47, 97], position: '0', bytes: [0, 255], count: 2 });
  store.settle({ state: 'exited', exitCode: 1 });
  const result = await store.reconstruct({ async apply(effect) { effect.bytes![0] = 7; effect.path![1] = 98; } });
  expect(result.manifest.effects[0]).toMatchObject({ bytes: [0, 255], path: [47, 97] });
  expect(store.inspect()).toEqual(result.manifest);
  await store.close();
});

it('returns partial canonical inspection together with cancellation and remaining transfer failure', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'mkdir', path: [47, 119, 47, 100] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const manifest = store.inspect();
  const destination = { async mkdir() { throw new Error('EROFS'); }, async open() { throw new Error('no files'); } };
  expect(await store.retrieve([47, 119], destination)).toMatchObject({ manifest, native: manifest.native, transfer: { state: 'failed' } });
  expect(await store.reconstruct({ async apply() { throw new Error('EDQUOT'); } })).toMatchObject({ manifest, native: manifest.native, transfer: { state: 'failed', nextSequence: 0 } });
  await store.close();
});

it('retires every output retain even when one close throws synchronously', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  const failure = new Error('retain close failed');
  const first = vi.fn((): Promise<void> => { throw failure; }); const second = vi.fn(async () => {});
  for (const [object, close] of [['a', first], ['b', second]] as const) store.retain(object, {
    stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(), close,
  });
  await expect(store.close()).rejects.toThrow(AggregateError);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  await expect(store.close()).rejects.toThrow(AggregateError);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
});

it('reports an interrupted retained output range without changing native settlement and allows suffix resume', async () => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  let interrupted = true;
  const bytes = Uint8Array.of(0, 255, 2, 3);
  store.retain('a', { stat: async () => ({ type: 'file', size: 4n }),
    read: async (position, length) => interrupted && position >= 2n ? new Uint8Array() : bytes.slice(Number(position), Number(position) + length),
    close: async () => {} });
  store.record({ operation: 'created', object: 'a', path: [47, 97] });
  store.settle({ state: 'exited', exitCode: 1 });
  const reader = store.download('a', 0n, 4n).getReader();
  expect((await reader.read()).value).toEqual(bytes.slice(0, 2));
  await expect(reader.read()).rejects.toThrow('Output range interrupted');
  reader.releaseLock();
  expect(store.inspect().native).toEqual({ state: 'exited', exitCode: 1 });
  interrupted = false;
  const resumed = store.download('a', 2n, 4n).getReader();
  expect((await resumed.read()).value).toEqual(bytes.slice(2));
  expect((await resumed.read()).done).toBe(true);
  resumed.releaseLock();
  await store.close();
});

it.each(['write', 'append'] as const)('keeps zero-byte %s receipts without promoting an untouched retained input to output', async operation => {
  const store = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  store.retain('prior', { stat: async () => ({ type: 'file', size: 1n }), read: async () => Uint8Array.of(7), close: async () => {} });
  store.record({ operation, object: 'prior', path: [47, 119, 47, 97], bytes: [], count: 0, ...(operation === 'write' ? { position: '0' } : {}) });
  store.settle({ state: 'exited', exitCode: 1 });
  expect(store.inspect().effects).toEqual([expect.objectContaining({ operation, count: 0, sequence: 0 })]);
  expect(store.inspect().outputs).toEqual([]);
  const open = vi.fn(async () => { throw new Error('Unchanged input is not output'); });
  expect((await store.retrieve([47, 119], { async mkdir() {}, open })).transfer.state).toBe('complete');
  expect(open).not.toHaveBeenCalled();
  await store.close();
});

it('does not report retained but untouched files as job outputs', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.retain('untouched', { stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(), close: async () => {} });
  expect(store.inspect().outputs).toEqual([]);
  store.record({ operation: 'metadata', object: 'untouched', path: [47, 97], changes: { mode: 0o600 } });
  expect(store.inspect().outputs).toEqual(['untouched']);
  await store.close();
});

it('refuses ledger reuse before outputs from another invocation can be admitted', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.settle({ state: 'running' });
  expect(() => store.settle({ state: 'running' })).toThrow('Effect invocation already started');
  store.record({ operation: 'created', path: [47, 97], object: 'a' });
  store.settle({ state: 'exited', exitCode: 0 });
  expect(() => store.settle({ state: 'running' })).toThrow('Effect invocation already started');
  expect(store.inspect().native).toEqual({ state: 'exited', exitCode: 0 });
  await store.close();
});

it('retrieves the canonical output tree with byte paths and preserves native failure separately', async () => {
  const store = createEffectStore({ maxEffects: 10, maxFrameBytes: 2 });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const bytes = Uint8Array.of(0, 255, 1);
  const path = [47, 119, 47, 255];
  const freshness = { identity: {}, version: '1', assertCurrent: vi.fn(async () => {}) };
  store.retain('a', { identity: freshness.identity, freshness: vi.fn().mockResolvedValue(freshness), stat: async () => ({ type: 'file', size: 3n }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close: async () => {} });
  store.record({ operation: 'created', object: 'a', path });
  store.record({ operation: 'rename', path, destination: [47, 119, 47, 100, 47, 255], moved: true });
  store.settle({ state: 'failed', error: 'later native error' });
  expect(store.inspectTree([47, 119])).toMatchObject({
    files: [{ path: [47, 119, 47, 100, 47, 255], relativePath: [100, 47, 255], object: 'a' }],
    directories: [{ path: [47, 119, 47, 100], relativePath: [100] }],
    retainedIdentities: ['a'], detachedIdentities: [], unlocatedIdentities: [],
    manifest: { native: { state: 'failed', error: 'later native error' } },
  });
  let quota = true;
  const destination = {
    async mkdir(path: Uint8Array) { volume.mkdirSync('/out/' + String.fromCharCode(...path)); },
    async open(path: Uint8Array) {
      const name = '/out/' + String.fromCharCode(...path);
      const fd = volume.openSync(name, volume.existsSync(name) ? 'r+' : 'w+');
      return { async write(position: bigint, value: Uint8Array) { if (quota && position > 0n) throw new Error('EDQUOT'); return volume.writeSync(fd, value, 0, quota ? 1 : value.length, Number(position)); }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    },
  };
  const first = await store.retrieve([47, 119], destination);
  expect(first.native).toEqual({ state: 'failed', error: 'later native error' });
  expect(first.transfer.state).toBe('failed');
  expect(first.transfer.cursor.offsets.get('d/ÿ')).toBe(1n);
  quota = false;
  const resumed = await store.retrieve([47, 119], destination, first.transfer.cursor);
  expect(resumed.transfer.state).toBe('complete');
  expect(volume.readFileSync('/out/d/ÿ')).toEqual(Buffer.from(bytes));
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  expect(store.inspect().outputs).toEqual(['a']);
  await store.close();
});

it.each([
  { bytes: [0, 256], count: 2 },
  { bytes: [0, -1], count: 2 },
  { bytes: [0, 1.5], count: 2 },
  { bytes: new Array<number>(1), count: 1 },
  { bytes: [0, 1, 2], count: 3 },
  { bytes: [0, 1], count: 1 },
  { bytes: [0], count: undefined },
  { bytes: undefined, count: 1 },
])('rejects invalid settled byte receipts without consuming a sequence: %j', async receipt => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  expect(() => store.record({ operation: 'write', object: 'a', position: '0', ...receipt })).toThrow(TypeError);
  expect(store.inspect().effects).toEqual([]);
  store.record({ operation: 'write', object: 'a', position: '0', bytes: [255], count: 1 });
  expect(store.inspect().effects).toEqual([expect.objectContaining({ sequence: 0, bytes: [255], count: 1 })]);
  await store.close();
});

it('does not replay a canonical no-op rename as a namespace mutation', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'rename', path: [47, 97], destination: [47, 98], moved: false });
  const destination = { apply: vi.fn(async () => {}) };
  expect((await store.reconstruct(destination)).transfer).toMatchObject({ state: 'complete', nextSequence: 1, cursor: { nextSequence: 1 } });
  expect(destination.apply).not.toHaveBeenCalled();
  await store.close();
});
it('requires a known canonical rename outcome before reconstruction', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  store.record({ operation: 'rename', path: [47, 97], destination: [47, 98] });
  const destination = { apply: vi.fn(async () => {}) };
  expect((await store.reconstruct(destination)).transfer).toMatchObject({ state: 'failed', nextSequence: 0 });
  expect(destination.apply).not.toHaveBeenCalled();
  await store.close();
});

it('keeps ordered partial writes, retained ranges and independent native/transfer outcomes', async () => {
  const close = vi.fn(async () => {});
  const bytes = Uint8Array.of(0, 255, 2, 3);
  const store = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
  store.record({ operation: 'created', path: [47, 97], object: 'a' });
  store.retain('a', { stat: async () => ({ type: 'file', size: 4n }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close });
  store.record({ operation: 'write', object: 'a', position: '0', bytes: [0, 255], count: 2 });
  store.record({ operation: 'rename', path: [47, 97], destination: [47, 98], object: 'a' });
  store.record({ operation: 'unlink', path: [47, 98], object: 'a' });
  store.settle({ state: 'exited', exitCode: 1 });
  const reader = store.download('a', 1n, 4n).getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(255, 2));
  await reader.cancel();
  const resume = store.download('a', 3n, 4n).getReader();
  expect((await resume.read()).value).toEqual(Uint8Array.of(3));
  const sink = { apply: vi.fn(async () => { throw new Error('EROFS'); }) };
  const result = await store.reconstruct(sink);
  expect(result.native).toEqual({ state: 'exited', exitCode: 1 });
  expect(result.transfer.state).toBe('failed');
  expect(store.inspect().effects.map(e => e.sequence)).toEqual([0, 1, 2, 3]);
  await store.close(); expect(close).toHaveBeenCalledOnce();
});

it('reconstruction resumes at the last receipt without rolling back completed files', async () => {
  const store = createEffectStore({ maxEffects: 10, maxFrameBytes: 2 });
  store.record({ operation: 'mkdir', path: [47, 100] });
  store.record({ operation: 'created', path: [47, 100, 47, 97], object: 'a' });
  store.record({ operation: 'created', path: [47, 100, 47, 98], object: 'b' });
  store.settle({ state: 'cancelled', error: 'cancelled' });
  const applied: number[] = []; let quota = true;
  const destination = { async apply(effect: { sequence: number }) { if (effect.sequence === 2 && quota) throw new Error('EDQUOT'); applied.push(effect.sequence); } };
  const first = await store.reconstruct(destination);
  expect(first.transfer).toMatchObject({ state: 'failed', nextSequence: 2 });
  quota = false;
  expect((await store.reconstruct(destination, first.transfer.nextSequence)).transfer.state).toBe('complete');
  expect(applied).toEqual([0, 1, 2]);
});

it('keeps repeated owner closure pending until retained resources settle', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  let finish!: () => void;
  store.retain('a', { stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(), close: async () => { await new Promise<void>(r => { finish = r; }); } });
  let completed = 0;
  const first = store.close().then(() => completed++);
  const second = store.close().then(() => completed++);
  await vi.waitFor(() => expect(finish).toBeDefined(), { interval: 1 });
  expect(completed).toBe(0); finish(); await Promise.all([first, second]); expect(completed).toBe(2);
});

it('binds replay progress to the invocation and destination before resuming settled effects', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 });
  const other = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 });
  for (const owner of [store, other]) {
    owner.record({ operation: 'mkdir', path: [47, 100] });
    owner.record({ operation: 'created', path: [47, 100, 47, 97], object: 'a' });
    owner.settle({ state: 'exited', exitCode: 1 });
  }
  const identity = {}; const applied: number[] = []; let quota = true;
  const apply = vi.fn(async (effect: { sequence: number }) => {
    if (quota && effect.sequence === 1) throw new Error('EDQUOT');
    applied.push(effect.sequence);
  });
  try {
    const first = await store.reconstruct({ identity, apply });
    expect(first.transfer).toMatchObject({ state: 'failed', cursor: { nextSequence: 1 } });
    quota = false;
    const unrelated = vi.fn();
    expect((await store.reconstruct({ apply: unrelated }, first.transfer.cursor)).transfer.state).toBe('failed');
    expect((await other.reconstruct({ identity, apply: unrelated }, first.transfer.cursor)).transfer.state).toBe('failed');
    expect(unrelated).not.toHaveBeenCalled();
    const resumed = await store.reconstruct({ identity, apply }, first.transfer.cursor);
    expect(resumed).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete', cursor: { nextSequence: 2 } } });
    expect(applied).toEqual([0, 1]);
  } finally { await Promise.all([store.close(), other.close()]); }
});

it('rejects unbound replay progress without applying a suffix to an empty destination', async () => {
  const store = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  store.record({ operation: 'mkdir', path: [47, 100] });
  store.record({ operation: 'created', path: [47, 100, 47, 97], object: 'a' });
  const apply = vi.fn();
  try {
    const result = await store.reconstruct({ apply }, { nextSequence: 1 });
    expect(result.transfer.state).toBe('failed');
    expect(apply).not.toHaveBeenCalled();
  } finally { await store.close(); }
});

it('acknowledges skipped observations and completed effects before consumer closure', async () => {
  const store = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 });
  store.record({ operation: 'open', path: [47, 97], object: 'a' });
  store.record({ operation: 'rename', path: [47, 97], destination: [47, 98], moved: false });
  store.record({ operation: 'mkdir', path: [47, 100] });
  store.settle({ state: 'cancelled', error: 'native cancelled' });
  const abort = new AbortController(); const applied: number[] = []; const identity = {};
  try {
    const first = await store.reconstruct({ identity, async apply(effect) {
      applied.push(effect.sequence); abort.abort(new Error('consumer closed'));
    } }, 0, abort.signal);
    expect(first).toMatchObject({ native: { state: 'cancelled', error: 'native cancelled' }, transfer: {
      state: 'failed', nextSequence: 3, cursor: { nextSequence: 3 }, error: expect.objectContaining({ message: 'consumer closed' }) } });
    const apply = vi.fn();
    expect((await store.reconstruct({ identity, apply }, first.transfer.cursor)).transfer.state).toBe('complete');
    expect(apply).not.toHaveBeenCalled(); expect(applied).toEqual([2]);
  } finally { await store.close(); }
});
