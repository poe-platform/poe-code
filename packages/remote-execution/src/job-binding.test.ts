import { createEndpointAccess } from './endpoint.js';
import { BytePath } from '@poe-code/safe-fs/contracts/object';
import { expect, it, vi } from 'vitest';
import { createEffectStore } from './effects.js';
import { captureJobSource, assertNativeProcessView, assertRequiredReadiness, createJobBinding } from './job-binding.js';

const b = (s: string) => Array.from(new TextEncoder().encode(s));
const binding = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: b('/work'), originalArgv: [b('relative'), b('/absolute'), []] };
it.each([
  ['entries', 'state'], ['readiness', 'state'], ['entries', 'slot'], ['readiness', 'slot'],
  ['entries', 'ledger'], ['readiness', 'ledger'],
] as const)('rejects required %s %s hidden behind a replacement accessor during admission', async (field, target) => {
  const f = fixture();
  const record = f.ready[field][0];
  const replacement = vi.fn(() => target === 'state' ? 'pending'
    : target === 'slot' ? { state: 'pending' } : [{ state: 'pending' }]);
  Object.defineProperty(f.ready.readiness, '1', { enumerable: true, configurable: true,
    value: { kind: 'speculative', identity: 'nested-playlist', get state() {
      Object.defineProperty(target === 'state' ? record : target === 'slot' ? f.ready[field] : f.ready,
        target === 'state' ? 'state' : target === 'slot' ? '0' : field,
        { configurable: true, get: replacement });
      return 'failed';
    } },
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
});
it.each(['entries', 'readiness', 'directoryRevision', 'cwd'] as const)('rejects workspace %s replaced during readiness capture', async field => {
  const f = fixture();
  Object.defineProperty(f.ready.readiness[0], 'state', { get() {
    Reflect.set(f.ready, field, field === 'entries' ? [{ state: 'pending' }]
      : field === 'readiness' ? [{ kind: 'required', identity: 'replacement', state: 'pending' }]
      : field === 'cwd' ? b('/other-session') : 'stale');
    return 'complete';
  } });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});
it('rejects required readiness revoked by a later advisory metadata observation', async () => {
  const f = fixture();
  const required = f.ready.readiness[0];
  Object.assign(f.ready, { readiness: [required, {
    kind: 'speculative', identity: 'nested-playlist', get state() {
      Object.assign(required, { state: 'pending' });
      return 'failed';
    },
  }] });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('readiness');
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).not.toHaveBeenCalled();
});
it('rejects a starting entry revoked while readiness metadata is captured', async () => {
  const f = fixture();
  Object.defineProperty(f.ready.readiness[0], 'state', { get() {
    f.ready.entries[0].state = 'pending';
    return 'complete';
  } });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});
it('rejects a late-file path extended while copying authenticated callback identity', async () => {
  const f = fixture();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    const path = b('lists/nested');
    let observations = 0;
    Object.defineProperty(path, '0', { get() {
      if (++observations === 2) path.push(...b('/child.m3u8'));
      return 108;
    } });
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'late-open', fileId: 'child', stage: 'playlist-open', operation: 'open', path }))
      .rejects.toMatchObject({ code: 'EINVAL' });
    expect(f.source.objects.open).not.toHaveBeenCalled();
    // Failed frame admission leaves no replay receipt. A complete retry with
    // the same callback ID may acquire the actual nested dependency once.
    const complete = { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'late-open', fileId: 'child', stage: 'playlist-open', operation: 'open',
      path: b('lists/nested/child.m3u8') };
    const opened = await input.access(f.credential, complete);
    expect(await input.access(f.credential, complete)).toEqual(opened);
    expect(f.source.objects.open).toHaveBeenCalledOnce();
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
});
it('rejects an extended callback payload before canonical writes or replay admission', async () => {
  const f = fixture();
  const write = vi.fn(async () => 1);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native-write' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open',
      access: 'write', path: b('output') });
    const bytes = [7];
    let observations = 0;
    Object.defineProperty(bytes, '0', { get() {
      if (++observations === 2) bytes.push(8);
      return 7;
    } });
    const request = { ...common, callbackId: 'write', operation: 'write', handle: opened.handle, position: '0', bytes };
    await expect(input.access(f.credential, request)).rejects.toMatchObject({ code: 'EINVAL' });
    expect(write).not.toHaveBeenCalled();
    const complete = { ...request, bytes: [7, 8] };
    expect(await input.access(f.credential, complete)).toBe(1);
    expect(await input.access(f.credential, complete)).toBe(1);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(0n, Uint8Array.of(7, 8), expect.anything());
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('rejects argv appended while owning the admitted process description', async () => {
  const f = fixture();
  f.prepare.mockImplementation(async input => ({ ...f.ready, ...input }));
  const argv = [b('relative')];
  let observations = 0;
  Object.defineProperty(argv, '0', { get() {
    if (++observations === 3) argv.push(b('/another-session/input'));
    return b('relative');
  } });
  await expect(f.runtime.execute({ ...binding, originalArgv: argv }, new AbortController().signal))
    .rejects.toThrow('octets');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});
it('rejects argument octets appended while owning the admitted process description', async () => {
  const f = fixture();
  f.prepare.mockImplementation(async input => ({ ...f.ready, ...input }));
  const arg = [97];
  let observations = 0;
  Object.defineProperty(arg, '0', { get() {
    if (++observations === 3) arg.push(98);
    return 97;
  } });
  await expect(f.runtime.execute({ ...binding, originalArgv: [arg] }, new AbortController().signal))
    .rejects.toThrow('octets');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});
it.each([
  ['entries', 'prepare'], ['readiness', 'prepare'],
  ['entries', 'validate'], ['readiness', 'validate'],
] as const)('rejects required %s appended while capturing starting-tree admission after %s', async (field, stage) => {
  const f = fixture();
  const records = f.ready[field];
  const state = field === 'entries' ? 'applied' : 'complete';
  const mutate = () => Object.defineProperty(records[0], 'state', { get() {
    records.push(field === 'entries' ? { state: 'pending' } as never
      : { kind: 'required', identity: 'late-starting-tree', state: 'pending' } as never);
    return state;
  } });
  if (stage === 'prepare') mutate();
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    maxCallbacks: 2, maxHandles: 1, prepare: f.prepare, run: f.run,
    validate: async () => { if (stage === 'validate') mutate(); },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
});
it.each(['description', 'workspace'] as const)('owns only indexed process octets from the %s without acquiring speculative array extensions', async stage => {
  const f = fixture();
  const invocation = structuredClone(binding);
  Object.assign(f.ready, structuredClone(binding));
  const speculative = vi.fn(() => { throw new Error('late dependency unavailable'); });
  const view = stage === 'description' ? invocation : f.ready;
  for (const carrier of [view.cwd, view.originalArgv, ...view.originalArgv]) {
    Object.defineProperty(carrier, 'dependency', { enumerable: true, get: speculative });
  }
  await expect(f.runtime.execute(invocation, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(speculative).not.toHaveBeenCalled();
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ invocation: binding }));
});
it('leaves private scratch acquisition outside authenticated late-file callback admission and replay', async () => {
  const f = fixture();
  const scratch = vi.fn(() => { throw new Error('unqualified scratch authority'); });
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'nested-open',
      fileId: 'playlist-child', stage: 'playlist-open', operation: 'open', path: b('lists/nested/child') };
    Object.defineProperty(request, 'scratchRoot', { enumerable: true, get: scratch });
    const opened = await input.access(f.credential, request);
    expect(await input.access(f.credential, request)).toEqual(opened);
    return { exitCode: 0 };
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(scratch).not.toHaveBeenCalled();
  expect(f.source.objects.open).toHaveBeenCalledOnce();
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
});
it('admits logical cwd from indexed octets without invoking a dependency iterator', () => {
  const iterator = vi.fn(() => { throw new Error('speculative dependency access'); });
  const cwd = b('/work');
  Object.defineProperty(cwd, Symbol.iterator, { value: iterator });
  expect(() => assertNativeProcessView(cwd, binding.originalArgv)).not.toThrow();
  expect(iterator).not.toHaveBeenCalled();
});

it('rejects invalid indexed cwd octets even when an iterator supplies Unicode', () => {
  const cwd = [47, 255];
  Object.defineProperty(cwd, Symbol.iterator, { value: function* () { yield* b('/work'); } });
  expect(() => assertNativeProcessView(cwd, binding.originalArgv)).toThrow('Lossless Unicode logical cwd required');
});

it('rejects a source policy facet substituted after invocation admission', async () => {
  const f = fixture();
  const fs = Object.assign(f.source, { capabilities: { snapshotRmdir: true } });
  const admitted = captureJobSource(fs);
  fs.capabilities = { snapshotRmdir: false };
  await expect(f.runtime.execute(binding, new AbortController().signal, fs, admitted))
    .rejects.toThrow('Job source capability mismatch');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});
it('observes live policy changes on the admitted facet at late native access', async () => {
  const f = fixture();
  const rmdir = vi.fn(async () => {});
  const fs = Object.assign(f.source, { capabilities: { snapshotRmdir: false }, rmdir });
  const admitted = captureJobSource(fs);
  const runtime = f.runtime;
  f.run.mockImplementation(async (input: any) => {
    fs.capabilities.snapshotRmdir = true;
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'remove', fileId: 'nested', stage: 'native-rmdir', operation: 'rmdir',
      path: b('lists/nested') })).rejects.toMatchObject({ code: 'ENOTSUP' });
    return { exitCode: 0 };
  });
  await expect(runtime.execute(binding, new AbortController().signal, fs, admitted))
    .resolves.toEqual({ exitCode: 0 });
  expect(rmdir).not.toHaveBeenCalled();
});
it.each([-1, 0.5, NaN, Infinity, '0'])('rejects malformed required manifest index %j before native admission', async index => {
  const f = fixture();
  f.ready.entries = [{ index, state: 'applied' }] as never;
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});

it('keeps speculative and metadata-only manifest identity accessors outside admission', async () => {
  const f = fixture();
  const advisory = vi.fn(() => { throw new Error('late playlist denied'); });
  for (const kind of ['metadata-only', 'speculative']) {
    f.ready.entries.push(Object.defineProperty({ kind, state: 'pending' }, 'index', { get: advisory }) as never);
  }
  await expect(f.runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(advisory).not.toHaveBeenCalled();
  expect(f.run).toHaveBeenCalledOnce();
});

it.each(['replace', 'remove', 'duplicate'] as const)('rejects %s of required manifest entry identity during validation', async change => {
  const f = fixture();
  const entries = [{ index: 0, state: 'applied' }, { index: 1, state: 'applied' }];
  f.ready.entries = entries;
  const release = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    maxCallbacks: 2, maxHandles: 1, prepare: f.prepare, release, run: f.run,
    validate: async () => {
      if (change === 'replace') entries[1].index = 2;
      if (change === 'remove') Reflect.deleteProperty(entries[1], 'index');
      if (change === 'duplicate') entries[1].index = 0;
    },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it('pins canonical open authority when the binding is issued, while reads remain live', async () => {
  const f = fixture();
  let content = 1;
  const canonicalOpen = f.source.objects.open;
  canonicalOpen.mockImplementation(async () => ({ identity: {}, type: 'file', close: async () => {}, read: async () => Uint8Array.of(content) }));
  const runtime = f.runtime;
  const scratch = vi.fn(async () => { throw new Error('scratch authority'); });
  f.source.objects.open = scratch;
  content = 9;
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'child', stage: 'playlist-open' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('lists/nested/child') });
    expect(await input.access(f.credential, { ...common, callbackId: 'read', operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 })).toEqual(Uint8Array.of(9));
    return { exitCode: 0 };
  });
  await expect(runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(canonicalOpen).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});
it('retains the bound source facet before execution can substitute scratch authority', async () => {
  const f = fixture();
  const canonicalOpen = f.source.objects.open;
  canonicalOpen.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  const runtime = f.runtime;
  const scratch = vi.fn(async () => { throw new Error('scratch authority'); });
  f.source.objects = { open: scratch } as never;
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'late-open', fileId: 'child', stage: 'playlist-open', operation: 'open', path: b('nested/child') });
    return { exitCode: 0 };
  });
  await expect(runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(canonicalOpen).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});
it('validates indexed readiness independently of a driver iterator', () => {
  const readiness = [{ kind: 'required' as const, identity: 'tree', state: 'pending' as const }];
  Object.defineProperty(readiness, Symbol.iterator, { value: function* () {
    yield { kind: 'required', identity: 'tree', state: 'complete' };
  } });
  expect(() => assertRequiredReadiness(readiness)).toThrow('Incomplete required readiness');
});
it.each(['entries', 'readiness'] as const)('does not let a driver iterator hide incomplete required %s', async field => {
  const f = fixture();
  const records = field === 'entries'
    ? [{ state: 'pending', kind: 'required' }]
    : [{ identity: 'tree', state: 'pending', kind: 'required' }];
  Object.defineProperty(records, Symbol.iterator, { value: function* () {
    yield field === 'entries' ? { state: 'applied', kind: 'required' }
      : { identity: 'tree', state: 'complete', kind: 'required' };
  } });
  Object.assign(f.ready, { [field]: records });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
});

it.each(['entries', 'readiness'] as const)('refuses inherited required %s slots instead of admitting another tree', async field => {
  const f = fixture();
  const records = new Array(1);
  Object.setPrototypeOf(records, Object.assign(Object.create(Array.prototype), {
    0: field === 'entries' ? { state: 'applied', kind: 'required' }
      : { identity: 'tree', state: 'complete', kind: 'required' },
  }));
  Object.assign(f.ready, { [field]: records });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
});
it('does not reread an incomplete required entry into speculative work', async () => {
  const f = fixture();
  let observations = 0;
  f.ready.entries.push(Object.defineProperty({ state: 'pending' }, 'kind', {
    enumerable: true, get: () => ++observations === 1 ? 'required' : 'speculative',
  }) as never);
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('stale job materialization');
  expect(observations).toBe(1);
  expect(f.run).not.toHaveBeenCalled();
});
it('captures only admission metadata from entry and readiness records, leaving speculative acquisition deferred', async () => {
  const f = fixture();
  const speculative = vi.fn(() => { throw new Error('late playlist unavailable'); });
  f.ready.entries.push(Object.defineProperty({ state: 'pending', kind: 'speculative' }, 'dependency', { enumerable: true, get: speculative }) as never);
  f.ready.readiness.push(Object.defineProperty({ kind: 'speculative', identity: 'nested-playlist', state: 'failed' }, 'failure', { enumerable: true, get: speculative }) as never);
  const validate = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    maxCallbacks: 2, maxHandles: 1, prepare: f.prepare, validate, run: f.run });
  await expect(runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(speculative).not.toHaveBeenCalled();
  expect(validate).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.run.mock.calls[0][0].readiness).toContainEqual({ kind: 'speculative', identity: 'nested-playlist', state: 'failed' });
});
it('does not acquire private staging while capturing the job description', async () => {
  const f = fixture();
  const input = { ...binding };
  const scratch = vi.fn(() => { throw new Error('speculative staging unavailable'); });
  Object.defineProperty(input, 'scratchRoot', { enumerable: true, get: scratch });
  await expect(f.runtime.execute(input, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(scratch).not.toHaveBeenCalled();
  expect(f.prepare.mock.calls[0][0]).toEqual(binding);
  expect(f.run).toHaveBeenCalledOnce();
});
it.each(['read', 'write'] as const)('does not inspect retained IO outside canonical %s admission', async access => {
  const f = fixture();
  const close = vi.fn(async () => {});
  const object = { identity: {}, type: 'file', close,
    read: async () => Uint8Array.of(0, 255), write: async () => 1 };
  const forbidden = vi.fn(() => { throw new Error('IO right not admitted'); });
  for (const operation of access === 'read' ? ['write', 'append', 'truncate'] : ['read']) {
    Object.defineProperty(object, operation, { get: forbidden });
  }
  f.source.objects.open.mockResolvedValue(object);
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'file', stage: 'native-io' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('file'), access });
    const request = { ...common, handle: opened.handle, position: '0' };
    if (access === 'read') {
      expect(await input.access(f.credential, { ...request, callbackId: 'read', operation: 'read', maxBytes: 2 })).toEqual(Uint8Array.of(0, 255));
      await expect(input.access(f.credential, { ...request, callbackId: 'denied', operation: 'write', bytes: [1] })).rejects.toMatchObject({ code: 'EBADF' });
    } else {
      expect(await input.access(f.credential, { ...request, callbackId: 'write', operation: 'write', bytes: [1] })).toBe(1);
      await expect(input.access(f.credential, { ...request, callbackId: 'denied', operation: 'read', maxBytes: 1 })).rejects.toMatchObject({ code: 'EBADF' });
    }
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(forbidden).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('recovers a lost callback with reordered wire fields without reopening its canonical file', async () => {
  const f = fixture();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'open',
      fileId: 'nested-child', stage: 'playlist-open', operation: 'open', path: b('lists/nested/child') };
    const opened = await input.access(f.credential, request);
    const replay = Object.fromEntries(Object.entries(request).reverse());
    expect(await input.access(f.credential, replay)).toEqual(opened);
    await expect(input.access(f.credential, { ...replay, stage: 'other-stage' })).rejects.toThrow('Callback identity conflict');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).toHaveBeenCalledOnce();
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
});
it.each(['write', 'append'] as const)('replays a lost %s acknowledgement across equivalent binary carriers without repeating canonical work', async operation => {
  const f = fixture();
  const mutate = vi.fn(async () => 2);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: mutate, append: mutate });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native-write' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('nested/output'), access: 'write' });
    const request = { ...common, callbackId: 'mutation', operation, handle: opened.handle, position: '0', bytes: Uint8Array.of(1, 255) };
    expect(await input.access(f.credential, request)).toBe(2);
    expect(await input.access(f.credential, { ...request, bytes: [1, 255] })).toBe(2);
    await expect(input.access(f.credential, { ...request, bytes: [1, 254] })).rejects.toThrow('Callback identity conflict');
    await expect(input.access(f.credential, { ...request, stage: 'other-stage' })).rejects.toThrow('Callback identity conflict');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(mutate).toHaveBeenCalledOnce();
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
});
it.each([1, 2])('refuses oversized directory carriers before allocating execution transfer copies (%i entries)', async count => {
  const f = fixture();
  const carriers = Array.from({ length: count }, () => new Uint8Array(Math.floor(1048576 / count) + 1).fill(97));
  const carrier = carriers.at(-1)!;
  const names = carriers.map(name => new BytePath(name));
  Object.assign(f.source.objects, { readdir: async () => names.map(name => ({ name, type: 'file' })) });
  f.run.mockImplementation(async (input: any) => {
    const constructor = globalThis.Uint8Array;
    let copies = 0;
    globalThis.Uint8Array = new Proxy(constructor, { construct(target, args) {
      if (args[0] === carrier) copies++;
      return Reflect.construct(target, args);
    } });
    try {
      await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
        callbackId: 'list', fileId: 'directory', stage: 'native-readdir', operation: 'readdir', path: b('.') }))
        .rejects.toMatchObject({ code: 'EFBIG', syscall: 'readdir' });
      expect(copies).toBe(0);
    } finally { globalThis.Uint8Array = constructor; }
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('rejects the first observed stale workspace revision without rereading it into readiness', async () => {
  const f = fixture();
  let observations = 0;
  Object.defineProperty(f.ready, 'directoryRevision', { enumerable: true, get() {
    return ++observations === 1 ? 'stale' : binding.directoryRevision;
  } });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('stale job materialization');
  expect(observations).toBe(1);
  expect(f.run).not.toHaveBeenCalled();
});

it('refuses inherited process octets and argv slots before materialization acquisition', async () => {
  const slot = Array<number[]>(1);
  Object.setPrototypeOf(slot, Object.assign(Object.create(Array.prototype), { 0: b('input') }));
  const octets = Array<number>(1);
  Object.setPrototypeOf(octets, Object.assign(Object.create(Array.prototype), { 0: 97 }));
  for (const originalArgv of [slot, [octets]]) {
    expect(() => assertNativeProcessView(binding.cwd, originalArgv)).toThrow('octets');
    const f = fixture();
    await expect(f.runtime.execute({ ...binding, originalArgv }, new AbortController().signal)).rejects.toThrow('octets');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  }
});

it('returns live retained metadata without exposing canonical authority tokens', async () => {
  const f = fixture();
  const identity = {};
  let size = 1n;
  f.source.objects.open.mockResolvedValue({ identity, type: 'file', close: async () => {},
    stat: async () => ({ type: 'file', size: size++, identityScope: Symbol('canonical authority'), dev: 1, ino: 2 }),
  });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'input', stage: 'native-fstat' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('input') });
    expect(await input.access(f.credential, { ...common, callbackId: 'stat-1', operation: 'stat', handle: opened.handle })).toEqual({ type: 'file', size: 1n });
    expect(await input.access(f.credential, { ...common, callbackId: 'stat-2', operation: 'stat', handle: opened.handle })).toEqual({ type: 'file', size: 2n });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('refuses a retrieval retain for another object without undoing canonical write progress', async () => {
 const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
 const foreignRead = vi.fn(async () => Uint8Array.of(99)); const foreignClose = vi.fn(async () => {});
 const f = fixture(effects, async () => ({ identity: {}, stat: async () => ({ type: 'file', size: 1n }), read: foreignRead, close: foreignClose }));
 let content = 0;
 f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {},
  write: async (_position: bigint, bytes: Uint8Array) => { content = bytes[0]; return 1; } });
 f.run.mockImplementation(async (input: any) => {
  let n = 0;
  const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
   callbackId: String(++n), fileId: 'out', stage: 'native-output', ...op });
  const opened = await access({ operation: 'open', path: b('out'), access: 'write' });
  await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [7] });
  return { exitCode: 1 };
 });
 try {
  expect(await f.runtime.execute(binding, new AbortController().signal)).toEqual({ exitCode: 1 });
  expect(content).toBe(7);
  const snapshot = effects.inspect();
  expect(snapshot.retrievalFailures).toEqual([{ object: snapshot.effects[0].object, error: 'Output retain identity does not match canonical object' }]);
  expect(foreignClose).toHaveBeenCalledOnce();
  await expect(effects.download(snapshot.outputs[0], 0n, 1n).getReader().read()).rejects.toThrow('unavailable');
  expect(foreignRead).not.toHaveBeenCalled();
 } finally { await effects.close(); }
 expect(foreignClose).toHaveBeenCalledOnce();
});
it('rejects a competing manifest revision observed during live admission', async () => {
  const f = fixture();
  let entered!: () => void; let finish!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const release = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    maxCallbacks: 2, maxHandles: 1, prepare: f.prepare, release, run: f.run,
    validate: async () => { entered(); await gate; },
  });
  const execution = runtime.execute(binding, new AbortController().signal);
  const rejected = expect(execution).rejects.toThrow('stale job materialization');
  await validating;
  f.ready.manifestRevision = 'competing-manifest'; f.ready.directoryRevision = 'competing-directory';
  expect(f.run).not.toHaveBeenCalled();
  finish(); await rejected;
  expect(f.run).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0]).toMatchObject({ manifestRevision: 'r', directoryRevision: 'd' });
});
it.each(['unlink', 'rename'] as const)('retires delayed alias-open path hints across %s without reopening the object', async operation => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  let entered!: () => void; let finish!: () => void;
  const opening = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const write = vi.fn(async () => 1);
  f.source.objects.open.mockImplementation(async () => { entered(); await gate; return { identity: {}, type: 'file', close: async () => {}, write }; });
  Object.assign(f.source.objects, { unlink: async () => {}, rename: async () => ({ moved: true }) });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'shared', stage: 'native-io', ...op });
    const acquisition = access({ operation: 'open', path: b('alias-parent/file'), access: 'write' });
    await opening;
    try { await access({ operation, path: b('real-parent/file'), destination: b('moved') }); }
    finally { finish(); }
    const opened = await acquisition;
    await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [2] });
    return { exitCode: 0 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(effects.inspect().effects.at(-1)?.path).toBeUndefined();
    expect(write).toHaveBeenCalledOnce(); expect(f.source.objects.open).toHaveBeenCalledOnce();
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.run).toHaveBeenCalledOnce();
  } finally { finish(); await effects.close(); }
});
it.each(['unlink', 'rename'] as const)('detaches retained pathname hints when %s uses another source alias', async operation => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
  const f = fixture(effects);
  const identity = {};
  let content = Uint8Array.of(1);
  f.source.objects.open.mockImplementation(async () => ({ identity, type: 'file', close: async () => {},
    read: async () => content.slice(), write: async (_position: bigint, bytes: Uint8Array) => { content = bytes.slice(); return bytes.length; },
  }));
  Object.assign(f.source.objects, { unlink: async () => {}, rename: async () => ({ moved: true }) });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'shared', stage: 'native-io', ...op });
    const reader = await access({ operation: 'open', path: b('/work/real-parent/file') });
    const writer = await access({ operation: 'open', path: b('symlink-parent/file'), access: 'write' });
    expect(reader.object).toBe(writer.object);
    await access({ operation, path: b('real-parent/file'), destination: b('moved') });
    await access({ operation: 'write', handle: writer.handle, position: '0', bytes: [2] });
    expect(await access({ operation: 'read', handle: reader.handle, position: '0', maxBytes: 1 })).toEqual(Uint8Array.of(2));
    return { exitCode: 0 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(effects.inspect().effects.at(-1)).toMatchObject({ operation: 'write', object: expect.any(String) });
    expect(effects.inspect().effects.at(-1)?.path).toBeUndefined();
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.run).toHaveBeenCalledOnce();
  } finally { await effects.close(); }
});
it.each(['receipt', 'identity'] as const)('closes a canonical create retain when its %s observation fails', async field => {
  const f = fixture();
  const failure = new Error('canonical admission observation failed');
  const close = vi.fn(async () => {});
  const acquired = { identity: {}, type: 'file', creation: 'truncated', close };
  Object.defineProperty(acquired, field === 'receipt' ? 'creation' : 'identity', { get() { throw failure; } });
  const create = vi.fn(async () => acquired);
  Object.assign(f.source.objects, { create });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'create',
      fileId: 'out', stage: 'native-open-output', operation: 'create', path: b('out'), access: 'write' };
    await expect(input.access(f.credential, request)).rejects.toBe(failure);
    await expect(input.access(f.credential, request)).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(create).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it('pins canonical retain cleanup before observing a rejected object identity', async () => {
  const f = fixture();
  const close = vi.fn(async () => {});
  const replacement = vi.fn(async () => {});
  const acquired = { type: 'file', close, get identity() { acquired.close = replacement; return null; } };
  f.source.objects.open.mockResolvedValue(acquired);
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'in', stage: 'native-open-input', operation: 'open', path: b('in') }))
      .rejects.toMatchObject({ code: 'ENOTSUP' });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(close).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it('keeps completed canonical truncation and its stage when retain admission and cleanup fail', async () => {
  const effects = createEffectStore({ maxEffects: 4, maxFrameBytes: 2 });
  const f = fixture(effects);
  const admission = new Error('retained identity unavailable');
  const cleanup = new Error('canonical close failed');
  let content = Uint8Array.of(1, 2);
  const close = vi.fn(async () => { throw cleanup; });
  Object.assign(f.source.objects, { create: async () => {
    content = new Uint8Array();
    return { get identity() { throw admission; }, type: 'file', creation: 'truncated', close };
  } });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'create',
      fileId: 'out', stage: 'native-open-output', operation: 'create', path: b('out'), access: 'write' };
    await expect(input.access(f.credential, request)).rejects.toMatchObject({
      cause: admission, errors: [admission, cleanup],
    });
    expect(content).toEqual(new Uint8Array());
    expect(effects.inspect().effects).toMatchObject([
      { operation: 'truncate', path: b('/work/out'), length: '0', stage: 'native-open-output', callbackId: 'create' },
    ]);
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(content).toEqual(new Uint8Array());
  expect(close).toHaveBeenCalledOnce();
  await effects.close();
});

it.each(['required', 'metadata-only', 'speculative'] as const)('rejects duplicate starting-tree work classified as %s before admission', async kind => {
  const f = fixture();
  Object.assign(f.ready, { readiness: [
    { kind: 'required', identity: 'tree', state: 'complete' },
    { kind, identity: 'tree', state: kind === 'required' ? 'complete' : 'failed' },
  ] });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('Incomplete required readiness');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.source.objects.open).not.toHaveBeenCalled();
});
it.each([null, [], { randomAccessWrite: 'yes' }, { readOnly: 1 }])('refuses malformed canonical capabilities %j at their native query stage', async capabilities => {
  const f = fixture();
  Object.assign(f.source, { capabilitiesFor: async () => capabilities });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'capabilities', fileId: 'f', stage: 'native-capabilities', operation: 'capabilities', path: b('mount/file') }))
      .rejects.toMatchObject({ code: 'EIO', syscall: 'capabilities' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('allows canonical namespace observation to wait for a concurrent native writer', async () => {
  const f = fixture();
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const stat = vi.fn(async () => { entered(); await gate; return { type: 'file', size: 1 }; });
  Object.assign(f.source, { stat });
  f.source.objects.open.mockImplementation(async () => { finish(); return { identity: {}, type: 'file', close: async () => {} }; });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-io' };
    const reading = input.access(f.credential, { ...common, callbackId: 'stat', operation: 'path-stat', path: b('live') });
    await started;
    const writing = input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', access: 'write', path: b('live') });
    try {
      await Promise.resolve(); await Promise.resolve();
      expect(f.source.objects.open).toHaveBeenCalledOnce();
    } finally { finish(); await Promise.allSettled([reading, writing]); }
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('authorizes the captured callback session before canonical acquisition', async () => {
  const f = fixture();
  f.run.mockImplementation(async (input: any) => {
    let observations = 0;
    const request = { operation: 'open', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'f', stage: 'native-open', path: b('input'),
      get sessionId() { return ++observations === 1 ? 's' : 'foreign'; } };
    await expect(input.access(f.credential, request)).rejects.toThrow('Unauthorized file callback');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).not.toHaveBeenCalled();
});
it('rejects path octets that change during callback retention before canonical acquisition', async () => {
  const f = fixture();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    let observations = 0;
    const path = [1];
    Object.defineProperty(path, 0, { enumerable: true, get() { return ++observations === 1 ? 65 : 0; } });
    await expect(input.access(f.credential, { operation: 'open', sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'f', stage: 'native-open', path })).rejects.toThrow('Invalid native octets');
    expect(f.source.objects.open).not.toHaveBeenCalled();
    await expect(input.access(f.credential, { operation: 'open', sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'f', stage: 'native-open', path: b('input') })).resolves.toHaveProperty('handle');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).toHaveBeenCalledOnce();
});
it('retains admitted object identity, type and operations when the backend changes its public handle', async () => {
  const f = fixture();
  const identity = {};
  const close = vi.fn(async () => {});
  const replacementRead = vi.fn(async () => Uint8Array.of(9));
  const replacementClose = vi.fn(async () => {});
  const object = { identity, type: 'file', close,
    read: async () => Uint8Array.of(1), stat: async () => ({ type: 'file', size: 1n }) };
  f.source.objects.open.mockResolvedValue(object);
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      fileId: 'f', stage: 'native-read', callbackId: String(++sequence), ...operation });
    const opened = await access({ operation: 'open', path: b('input') });
    Object.assign(object, { identity: {}, type: 'directory', read: replacementRead, close: replacementClose });
    expect(await access({ operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 })).toEqual(Uint8Array.of(1));
    expect(await access({ operation: 'stat', handle: opened.handle })).toEqual({ type: 'file', size: 1n });
    await access({ operation: 'close', handle: opened.handle });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(close).toHaveBeenCalledOnce();
  expect(replacementRead).not.toHaveBeenCalled();
  expect(replacementClose).not.toHaveBeenCalled();
});
it.each([undefined, null, 'wire-token', 1, false])('refuses a primitive or absent callback credential (%j)', credential => {
  const f = fixture();
  expect(() => createJobBinding({ ...binding, fs: f.source, credential: credential as never,
    prepare: f.prepare, run: f.run, maxCallbacks: 2, maxHandles: 1,
  })).toThrow('Callback credential capability required');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});
it('records the revalidated readiness classifications at process admission without sharing the driver record', async () => {
  const f = fixture();
  const readiness: import('./job-binding.js').ReadinessWork[] = [
    { kind: 'required', identity: 'starting-tree', state: 'complete' },
    { kind: 'metadata-only', identity: 'inventory', state: 'complete' },
    { kind: 'speculative', identity: 'nested/playlist', state: 'pending' },
  ];
  const runtime = createJobBinding({ ...binding, fs: f.source, credential: f.credential,
    maxCallbacks: 2, maxHandles: 1,
    prepare: async () => ({ ...f.ready, readiness }),
    validate: async () => { readiness[2].state = 'failed'; },
    run: async input => {
      expect(input.readiness).toEqual(readiness);
      expect(input.readiness).not.toBe(readiness);
      input.readiness[0].identity = 'changed-by-runner';
      expect(readiness[0].identity).toBe('starting-tree');
      return { exitCode: 0 };
    },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
});
it.each(['success', 'validation-failure'] as const)('releases the original private workspace capability after %s', async outcome => {
  const f = fixture();
  const reservation = new WeakSet([f.ready]);
  const release = vi.fn(async (_workspace: import('./job-binding.js').ReadyJobWorkspace, acquired: import('./job-binding.js').ReadyJobWorkspace) => {
    if (!reservation.delete(acquired)) throw new Error('Unknown workspace reservation');
  });
  const failure = new Error('live input changed');
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, release, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => { if (outcome === 'validation-failure') throw failure; },
  });
  const execution = runtime.execute(binding, new AbortController().signal);
  if (outcome === 'success') await expect(execution).resolves.toEqual({ exitCode: 0 });
  else await expect(execution).rejects.toBe(failure);
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][1]).toBe(f.ready);
  expect(reservation.has(f.ready)).toBe(false);
});
it('does not launch when cancellation is observed while reading revalidated readiness', async () => {
  const f = fixture();
  const controller = new AbortController();
  const reason = new Error('starting-tree lease cancelled');
  const release = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, release, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => {
      const readiness = f.ready.readiness;
      Object.defineProperty(f.ready, 'readiness', { get() {
        controller.abort(reason);
        return readiness;
      } });
    },
  });
  await expect(runtime.execute(binding, controller.signal)).rejects.toBe(reason);
  expect(f.run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it.each(['exited', 'failed'] as const)('keeps the effect barrier open until delayed canonical writes drain after native %s', async outcome => {
  const effects = createEffectStore({ maxEffects: 2, maxFrameBytes: 4 });
  const f = fixture(effects);
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let visible = new Uint8Array();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {},
    write: async (_position: bigint, bytes: Uint8Array) => {
      entered(); await gate; visible = bytes.slice(0, 1); return 1;
    },
  });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-write' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('output'), access: 'write' });
    void input.access(f.credential, { ...common, callbackId: 'write', operation: 'write', handle: opened.handle, position: '0', bytes: Uint8Array.of(255, 0) });
    await started;
    if (outcome === 'failed') throw new Error('native failed');
    return { exitCode: 1 };
  });
  const execution = f.runtime.execute(binding, new AbortController().signal).catch(error => error);
  await started;
  // Let the native result reach the binding while canonical IO remains blocked.
  await new Promise<void>(resolve => { queueMicrotask(() => queueMicrotask(resolve)); });
  try {
    expect(effects.inspect()).toMatchObject({ native: { state: 'running' }, effects: [{ operation: 'open' }], outputs: [] });
    expect(visible.length).toBe(0);
  } finally { finish(); await execution; }
  expect(effects.inspect()).toMatchObject({ native: { state: outcome }, effects: [{ operation: 'open' }, { operation: 'write', count: 1, bytes: [255], stage: 'native-write' }] });
  expect(visible).toEqual(Uint8Array.of(255));
  await effects.close();
});
it.each(['sparse', 'classification', 'state'] as const)('rejects malformed %s entries introduced during live validation', async malformed => {
  const f = fixture();
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => {
      if (malformed === 'sparse') f.ready.entries.length++;
      else f.ready.entries.push({ kind: malformed === 'classification' ? 'optional' : 'speculative', state: malformed === 'state' ? 'ready' : 'pending' } as never);
    },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});

it.each([true, false, undefined])('retains rename movement receipt %j when its callback reply is lost', async moved => {
  const f = fixture();
  const rename = vi.fn(async () => moved === undefined ? undefined : { moved });
  Object.assign(f.source.objects, { rename });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'rename', fileId: 'output', stage: 'native-rename', operation: 'rename', path: b('a'), destination: b('b') };
    await input.access(f.credential, request);
    expect(await input.access(f.credential, request)).toEqual(moved === undefined ? undefined : { moved });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(rename).toHaveBeenCalledOnce();
});
it.each([
  { kind: 'file', fails: false }, { kind: 'file', fails: true },
  { kind: 'descriptor', fails: false }, { kind: 'descriptor', fails: true },
] as const)('counts delayed $kind close against combined canonical retain capacity (failure=$fails)', async ({ kind, fails }) => {
  const f = fixture(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const error = Object.assign(new Error('canonical close failed'), { code: 'EIO', syscall: 'close' });
  const close = async () => { entered(); await gate; if (fails) throw error; };
  let opens = 0;
  f.source.objects.open.mockImplementation(async () => ({ identity: {}, type: 'file',
    close: ++opens === 1 && kind === 'file' ? close : async () => {},
  }));
  const acquire = vi.fn(async () => ({ identity: {}, close }));
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 10, maxHandles: 1, handles: { acquire }, run: async input => {
      let n = 0;
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-close' };
      const opened = await input.access(f.credential, { ...common, callbackId: String(++n), ...(kind === 'file'
        ? { operation: 'open' as const, path: b('file') }
        : { operation: 'descriptor-acquire' as const, fd: 3, rights: [] }) }) as { handle: string };
      const closing = input.access(f.credential, { ...common, callbackId: String(++n), handle: opened.handle,
        operation: kind === 'file' ? 'close' : 'descriptor-close' });
      const outcome = closing.catch(cause => cause);
      await started;
      try {
        await expect(input.access(f.credential, { ...common, callbackId: String(++n), operation: 'open', path: b('other') }))
          .rejects.toMatchObject({ code: 'EMFILE' });
        await expect(input.access(f.credential, { ...common, callbackId: String(++n), operation: 'descriptor-acquire', fd: 4, rights: [] }))
          .rejects.toMatchObject({ code: 'EMFILE' });
      } finally { release(); await outcome; }
      expect(await outcome).toBe(fails ? error : undefined);
      await input.access(f.credential, { ...common, callbackId: String(++n), operation: 'open', path: b('other') });
      return { exitCode: 1 };
    },
  });
  await runtime.execute(binding, new AbortController().signal);
});
it('preserves EMFILE on a late open and recovers capacity after closing a retained handle', async () => {
  const f = fixture();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 5, maxHandles: 1, run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'playlist', stage: 'demuxer-open' };
      const first = await input.access(f.credential, { ...common, callbackId: 'first', operation: 'open', path: b('root.m3u8') }) as { handle: string };
      await expect(input.access(f.credential, { ...common, callbackId: 'late', operation: 'open', path: b('nested/child.m3u8') })).rejects.toMatchObject({ code: 'EMFILE', syscall: 'open' });
      expect(f.source.objects.open).toHaveBeenCalledOnce();
      await input.access(f.credential, { ...common, callbackId: 'close', operation: 'close', handle: first.handle });
      await input.access(f.credential, { ...common, callbackId: 'retry', operation: 'open', path: b('nested/child.m3u8') });
      return { exitCode: 0 };
    },
  });
  await runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).toHaveBeenCalledTimes(2);
});
it('refuses a global snapshot-marker backend without probing directory contents', async () => {
  const f = fixture();
  const rmdir = vi.fn(); const readdir = vi.fn();
  Object.assign(f.source, { capabilities: { snapshotRmdir: true }, rmdir });
  Object.assign(f.source.objects, { readdir });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'remove', fileId: 'd', stage: 'native-rmdir', operation: 'rmdir', path: b('d') }))
      .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'rmdir', path: '/work/d' });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(rmdir).not.toHaveBeenCalled(); expect(readdir).not.toHaveBeenCalled();
});
it('refuses snapshot-marker directory removal at the selected mount without recording a native removal', async () => {
  const effects = createEffectStore({ maxEffects: 3, maxFrameBytes: 100 });
  const f = fixture(effects);
  const rmdir = vi.fn(async () => {});
  const capabilitiesFor = vi.fn(async (path: string) => ({ snapshotRmdir: path === '/work/weak' }));
  Object.assign(f.source, { rmdir, capabilitiesFor });
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'directory',
      stage: 'native-rmdir', operation: 'rmdir' };
    await expect(input.access(f.credential, { ...request, callbackId: 'weak', path: b('weak') }))
      .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'rmdir' });
    await input.access(f.credential, { ...request, callbackId: 'strong', path: b('strong') });
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(rmdir).toHaveBeenCalledExactlyOnceWith('/work/strong', { signal: expect.any(AbortSignal) });
    expect(capabilitiesFor).toHaveBeenCalledWith('/work/weak', { signal: expect.any(AbortSignal), allowDirectory: true });
    expect(effects.inspect().effects).toMatchObject([{ operation: 'rmdir', path: b('/work/strong'), stage: 'native-rmdir' }]);
    expect(effects.inspect().effects).toHaveLength(1);
  } finally { await effects.close(); }
});
it.each([
  ['file', 'EPERM'], ['directory', 'EPERM'],
  ['file', 'EROFS'], ['directory', 'EROFS'],
] as const)('delegates metadata on a read-opened retained %s and preserves canonical %s', async (type, code) => {
  const effects = createEffectStore({ maxEffects: 5, maxFrameBytes: 100 });
  const f = fixture(effects);
  const denied = Object.assign(new Error('metadata denied'), { code, syscall: 'fchmod', path: '/work/object' });
  let mode = 0o600;
  const metadata = vi.fn(async (changes: { mode?: number }) => {
    if (changes.mode === 0o777) throw denied;
    if (changes.mode !== undefined) mode = changes.mode;
  });
  f.source.objects.open.mockResolvedValue({ identity: {}, type, close: async () => {}, metadata });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, {
      sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence),
      fileId: 'object', stage: 'native-fchmod', ...operation,
    });
    const opened = await access({ operation: 'open', path: b('object'), access: 'read' });
    await access({ operation: 'metadata', handle: opened.handle, changes: { mode: 0o640 } });
    expect(mode).toBe(0o640);
    await expect(access({ operation: 'metadata', handle: opened.handle, changes: { mode: 0o777 } })).rejects.toBe(denied);
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(mode).toBe(0o640);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toMatchObject([
      { operation: 'metadata', changes: { mode: 0o640 }, stage: 'native-fchmod' },
    ]);
    expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toHaveLength(1);
  } finally { await effects.close(); }
});
it('creates canonical symlinks with literal targets, replays once, and preserves backend refusal', async () => {
  const effects = createEffectStore({ maxEffects: 5, maxFrameBytes: 100 }); const f = fixture(effects);
  const denied = Object.assign(new Error('read-only'), { code: 'EROFS', syscall: 'symlink' });
  const symlink = vi.fn(async (_target, destination) => { if (destination === '/work/readonly') throw denied; });
  Object.assign(f.source, { symlink });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'link', fileId: 'link', stage: 'native-symlink', operation: 'symlink', path: b('link'), target: b('../live/./playlist') };
    await input.access(f.credential, common); await input.access(f.credential, common);
    await expect(input.access(f.credential, { ...common, callbackId: 'refused', path: b('readonly') })).rejects.toBe(denied);
    await expect(input.access(f.credential, { ...common, callbackId: 'invalid-byte', target: [255] })).rejects.toMatchObject({ code: 'EILSEQ', syscall: 'symlink' });
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(symlink).toHaveBeenCalledTimes(2);
    expect(symlink).toHaveBeenNthCalledWith(1, '../live/./playlist', '/work/link', { signal: expect.any(AbortSignal) });
    expect(effects.inspect().effects).toMatchObject([{ operation: 'symlink', path: b('/work/link'), target: b('../live/./playlist'), stage: 'native-symlink' }]);
  } finally { await effects.close(); }
});
it('queries creation and directory capabilities at the actual native stage', async () => {
  const f = fixture();
  const capabilitiesFor = vi.fn(async (_path, options) => options.create ? { readOnly: true } : { read: true });
  Object.assign(f.source, { capabilitiesFor });
  f.run.mockImplementation(async (input: any) => {
    const result = await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'policy', fileId: 'out', stage: 'native-create-policy', operation: 'capabilities',
      path: b('missing/out'), create: true, allowDirectory: true });
    expect(result).toEqual({ readOnly: true });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(capabilitiesFor).toHaveBeenCalledWith('/work/missing/out', { create: true, allowDirectory: true, signal: expect.any(AbortSignal) });
});

it.each([{ operation: 'mkdir', mode: -1 }, { operation: 'capabilities', create: 'yes' }, { operation: 'capabilities', allowDirectory: 1 }, { operation: 'symlink', target: [0] }])('refuses invalid namespace admission %j before canonical work', async invalid => {
  const f = fixture(); const mkdir = vi.fn(); const capabilitiesFor = vi.fn(); const symlink = vi.fn();
  Object.assign(f.source, { mkdir, capabilitiesFor, symlink });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'invalid', fileId: 'f', stage: 'native-admission', path: b('path'), ...invalid })).rejects.toThrow();
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(mkdir).not.toHaveBeenCalled(); expect(capabilitiesFor).not.toHaveBeenCalled(); expect(symlink).not.toHaveBeenCalled();
});

it('preserves explicit native directory creation mode', async () => {
  const f = fixture(); const mkdir = vi.fn(async () => {});
  Object.assign(f.source, { mkdir });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'mkdir', fileId: 'dir', stage: 'native-mkdir', operation: 'mkdir', path: b('dir'), mode: 0o750 });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(mkdir).toHaveBeenCalledWith('/work/dir', { mode: 0o750, signal: expect.any(AbortSignal) });
});

it('links the retained object after unlink without reopening its former pathname and preserves EXDEV', async () => {
  const effects = createEffectStore({ maxEffects: 5, maxFrameBytes: 2 }); const f = fixture(effects);
  const exdev = Object.assign(new Error('cross mount'), { code: 'EXDEV', syscall: 'link' });
  const link = vi.fn(async (destination: BytePath) => { if (destination.bytes().at(-1) === 255) throw exdev; });
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', link, close: async () => {} });
  Object.assign(f.source.objects, { unlink: vi.fn(async () => {}) });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'retained', stage: 'native-link', ...operation });
    const opened = await access({ operation: 'open', path: b('old') });
    await access({ operation: 'unlink', path: b('old') });
    const request = { operation: 'link', handle: opened.handle, destination: b('new') };
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'link-once', fileId: 'retained', stage: 'native-link', ...request };
    await input.access(f.credential, common); await input.access(f.credential, common);
    await expect(access({ ...request, destination: [255] })).rejects.toBe(exdev);
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(f.source.objects.open).toHaveBeenCalledOnce(); expect(link).toHaveBeenCalledTimes(2);
    expect(link.mock.calls[0][0].bytes()).toEqual(Uint8Array.from(b('/work/new')));
    expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toMatchObject([{ operation: 'unlink' }, { operation: 'link', destination: b('/work/new'), stage: 'native-link' }]);
  } finally { await effects.close(); }
});
it.each(['write', 'append'] as const)('admits %s receipt bytes before canonical mutation when transfer and effect bounds differ', async operation => {
  const effects = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const f = fixture(effects);
  let content = Uint8Array.of(9);
  const mutate = vi.fn(async (...args: unknown[]) => {
    content = new Uint8Array((operation === 'write' ? args[1] : args[0]) as Uint8Array);
    return content.length;
  });
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: mutate, append: mutate });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'f', stage: 'native-write', ...op });
    const opened = await access({ operation: 'open', path: b('out'), access: 'write' });
    await expect(access({ operation, handle: opened.handle, position: '0', bytes: Uint8Array.of(0, 255) })).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
    expect(content).toEqual(Uint8Array.of(9));
    expect(await access({ operation, handle: opened.handle, position: '0', bytes: Uint8Array.of(255) })).toBe(1);
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(content).toEqual(Uint8Array.of(255));
    expect(effects.inspect()).toMatchObject({ native: { state: 'exited', exitCode: 1 }, effects: [{ operation: 'open' }, { operation, count: 1, bytes: [255] }] });
  } finally { await effects.close(); }
});
it('releases unused effect capacity after a canonical quota refusal', async () => {
  const effects = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 }); const f = fixture(effects);
  const quota = Object.assign(new Error('quota'), { code: 'EDQUOT', syscall: 'write' });
  let content = new Uint8Array(); let calls = 0;
  f.source.objects.open.mockImplementation(async () => ({ identity: {}, type: 'file', close: async () => {},
    write: async (_position: bigint, bytes: Uint8Array) => {
      if (!calls++) throw quota;
      content = bytes.slice(); return bytes.length;
    },
  }));
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-write' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('out'), access: 'write' });
    const write = { ...common, operation: 'write', handle: opened.handle, position: '0', bytes: Uint8Array.of(255) };
    await expect(input.access(f.credential, { ...write, callbackId: 'refused' })).rejects.toBe(quota);
    expect(await input.access(f.credential, { ...write, callbackId: 'retry' })).toBe(1);
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(content).toEqual(Uint8Array.of(255));
    expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toMatchObject([{ operation: 'write', count: 1 }]);
  } finally { await effects.close(); }
});
it('keeps delayed canonical write receipt capacity reserved across concurrent opens', async () => {
  const effects = createEffectStore({ maxEffects: 2, maxFrameBytes: 1 });
  const f = fixture(effects);
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delay = new Promise<void>(resolve => { release = resolve; });
  let content = Uint8Array.of(9);
  f.source.objects.open.mockImplementation(async () => ({ identity: {}, type: 'file', close: async () => {},
    write: async (_position: bigint, bytes: Uint8Array) => { entered(); await delay; content = bytes.slice(); return bytes.length; },
  }));
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++sequence), fileId: 'out', stage: 'native-io', ...operation });
    const opened = await access({ operation: 'open', path: b('out'), access: 'write' });
    const write = access({ operation: 'write', handle: opened.handle, position: '0', bytes: [255] });
    await started;
    try {
      await expect(access({ operation: 'open', path: b('other') })).rejects.toThrow('Effect receipt capacity');
      expect(f.source.objects.open).toHaveBeenCalledTimes(1);
    } finally { release(); await Promise.allSettled([write]); }
    expect(await write).toBe(1);
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(content).toEqual(Uint8Array.of(255));
    expect(effects.inspect()).toMatchObject({ native: { state: 'exited', exitCode: 1 }, effects: [
      { operation: 'open' }, { operation: 'write', count: 1, bytes: [255], stage: 'native-io' },
    ] });
  } finally { await effects.close(); }
});

it('reserves effect capacity before concurrent canonical mutations', async () => {
  const effects = createEffectStore({ maxEffects: 3, maxFrameBytes: 1 }); const f = fixture(effects);
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delay = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  f.source.objects.open.mockImplementation(async () => ({ identity: {}, type: 'file', close: async () => {},
    write: async () => { writes++; entered(); await delay; return 1; },
  }));
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'f', stage: 'native-write', ...op });
    const a = await access({ operation: 'open', path: b('a'), access: 'write' });
    const other = await access({ operation: 'open', path: b('b'), access: 'write' });
    const first = access({ operation: 'write', handle: a.handle, position: '0', bytes: [1] });
    await started;
    const second = access({ operation: 'write', handle: other.handle, position: '0', bytes: [2] });
    const refused = expect(second).rejects.toThrow('Effect receipt capacity');
    try {
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
      expect(writes).toBe(1);
    } finally { release(); await Promise.allSettled([first, second]); await refused; }
    expect(await first).toBe(1);
    return { exitCode: 0 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toMatchObject([{ operation: 'write', count: 1 }]);
  } finally { await effects.close(); }
});
it('retires file correlation identity after all canonical retains have closed', async () => {
  const f = fixture(); const identity = {};
  f.source.objects.open.mockImplementation(async () => ({ identity, type: 'file', close: async () => {} }));
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'f', stage: 'native-open', ...op });
    const first = await access({ operation: 'open', path: b('file') });
    const alias = await access({ operation: 'open', path: b('alias') });
    expect(first.object).toBe(alias.object);
    await access({ operation: 'close', handle: first.handle });
    const retained = await access({ operation: 'open', path: b('file') });
    expect(retained.object).toBe(alias.object);
    await access({ operation: 'close', handle: alias.handle });
    await access({ operation: 'close', handle: retained.handle });
    const reopened = await access({ operation: 'open', path: b('replacement') });
    expect(reopened.object).not.toBe(first.object);
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('allows a writer to unblock an independent live reader in the same native job', async () => {
  const f = fixture();
  let release!: () => void;
  const changed = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let content = Uint8Array.of(1);
  const identity = {};
  f.source.objects.open.mockImplementation(async () => ({ identity, type: 'file', close: async () => {},
    read: async () => { entered(); await changed; return content; },
    write: async (_position: bigint, bytes: Uint8Array) => { content = bytes.slice(); release(); return bytes.length; },
  }));
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: String(++n), fileId: 'live', stage: 'native-io', ...op });
    const reader = await access({ operation: 'open', path: b('live'), access: 'read' });
    const writer = await access({ operation: 'open', path: b('live'), access: 'write' });
    const read = access({ operation: 'read', handle: reader.handle, position: '0', maxBytes: 1 });
    await reading;
    let acknowledged = false;
    const write = access({ operation: 'write', handle: writer.handle, position: '0', bytes: Uint8Array.of(255) })
      .then((count: number) => { acknowledged = true; return count; });
    try {
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
      expect(acknowledged).toBe(true);
      expect(await write).toBe(1);
      expect(await read).toEqual(Uint8Array.of(255));
    } finally { release(); await Promise.allSettled([read, write]); }
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(content).toEqual(Uint8Array.of(255));
});
it.each([{ cwd: [47, 255] }, { cwd: [47, 0xc0, 0xaf] }, { cwd: [47, 0xed, 0xa0, 0x80] }])('rejects a non-Unicode logical cwd before materialization', async ({ cwd }) => {
  const f = fixture();
  f.prepare.mockImplementation(async input => ({ ...f.ready, ...input }));
  await expect(f.runtime.execute({ ...binding, cwd }, new AbortController().signal)).rejects.toThrow('cwd');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});
it('preserves Unicode cwd spelling and independent non-UTF8 argv/filename admission', async () => {
  const f = fixture();
  const invocation = { ...binding, cwd: b('/work/e\u0301/🎬'), originalArgv: [[255], [47, 255], []] };
  f.prepare.mockImplementation(async input => ({ ...f.ready, ...input }));
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    expect(input.invocation).toEqual(invocation);
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'open', fileId: 'byte-file', stage: 'native-open', operation: 'open', path: [255] });
    return { exitCode: 0 };
  });
  await f.runtime.execute(invocation, new AbortController().signal);
  expect(f.source.objects.open.mock.calls[0][0].bytes()).toEqual(Uint8Array.from([...invocation.cwd, 47, 255]));
});
it.each([{ size: 9007199254740992 }, { type: 'directory' }, { mode: 65536 }, { mtimeNs: 9007199254740992 }])('rejects unqualified retained metadata %j at stat without fabricating precision or type', async invalid => {
  const f = fixture();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {},
    stat: async () => ({ type: 'file', size: 1n, ...invalid }),
  });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-stat' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('file') });
    await expect(input.access(f.credential, { ...common, callbackId: 'stat', operation: 'stat', handle: opened.handle }))
      .rejects.toMatchObject({ code: 'EIO', syscall: 'stat' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it.each([undefined, 'w', 'wx', 'a', 'ax'] as const)('refuses native creation flag %j without a qualified canonical creation primitive', async flag => {
  const f = fixture(); const create = vi.fn(async () => ({ identity: {}, type: 'file', close: async () => {} }));
  Object.assign(f.source, { create });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'exclusive', fileId: 'out', stage: 'native-open', operation: 'create', path: b('out'), flag }))
      .rejects.toMatchObject({ code: 'ENOTSUP', syscall: 'create' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(create).not.toHaveBeenCalled();
});
it.each(['w', 'wx', 'a', 'ax'] as const)('forwards canonical %s creation disposition and mode without a pathname preflight', async flag => {
  const f = fixture();
  const create = vi.fn(async (_path: BytePath, _options: unknown) => ({ identity: {}, type: 'file', creation: 'created', close: async () => {} }));
  const stat = vi.fn(); Object.assign(f.source.objects, { create }); Object.assign(f.source, { stat });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'create', fileId: 'out', stage: 'native-open', operation: 'create', path: b('out'),
      flag, mode: 0o640, access: 'readwrite' });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(create).toHaveBeenCalledWith(expect.any(BytePath), { flag, mode: 0o640, access: 'readwrite', signal: expect.any(AbortSignal) });
  expect(create.mock.calls[0][0].bytes()).toEqual(Uint8Array.from(b('/work/out')));
  expect(stat).not.toHaveBeenCalled();
});
it('acknowledges early canonical truncation on acquisition and preserves it after command failure', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  let content = Uint8Array.of(1, 2, 3);
  Object.assign(f.source.objects, { create: async () => {
    content = new Uint8Array();
    return { identity: {}, type: 'file', creation: 'truncated', close: async () => {} };
  } });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'out', stage: 'native-open', operation: 'create', path: b('out'), flag: 'w', access: 'write' });
    expect(content.length).toBe(0);
    expect(effects.inspect().effects).toMatchObject([{ operation: 'truncate', length: '0', stage: 'native-open' }]);
    throw new Error('later decoding failure');
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('later decoding failure');
  expect(content.length).toBe(0);
  await effects.close();
});
it.each([
  ['w', 'opened'], ['wx', 'opened'], ['wx', 'truncated'],
  ['a', 'truncated'], ['ax', 'opened'], ['ax', 'truncated'],
] as const)('refuses a contradictory canonical %s acquisition receipt (%s) without undoing settled effects', async (flag, creation) => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  let content = Uint8Array.of(1, 2);
  const close = vi.fn(async () => {});
  const stat = vi.fn();
  Object.assign(f.source.objects, { create: async () => {
    if (creation === 'truncated') content = new Uint8Array();
    return { identity: {}, type: 'file', creation, stat, close };
  } });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'out', stage: 'native-open', operation: 'create', path: b('out'), flag }))
      .rejects.toMatchObject({ code: 'EIO', syscall: 'create' });
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(content).toEqual(creation === 'truncated' ? new Uint8Array() : Uint8Array.of(1, 2));
    expect(effects.inspect().effects).toEqual(creation === 'truncated'
      ? [expect.objectContaining({ operation: 'truncate', length: '0', stage: 'native-open', path: b('/work/out') })] : []);
    expect(close).toHaveBeenCalledOnce();
    expect(stat).not.toHaveBeenCalled();
  } finally { await effects.close(); }
});
it('preserves the existing output and exact open error when canonical exclusive creation refuses it', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  const content = Uint8Array.of(1, 2, 3); const exists = Object.assign(new Error('exists'), { code: 'EEXIST', syscall: 'open', path: '/work/out' });
  Object.assign(f.source.objects, { create: async () => { throw exists; } });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'open', fileId: 'out', stage: 'native-open', operation: 'create', path: b('out'), flag: 'wx' })).rejects.toBe(exists);
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(content).toEqual(Uint8Array.of(1, 2, 3)); expect(effects.inspect().effects).toEqual([]);
  await effects.close();
});
it.each(['open', 'rename', 'path-stat'] as const)('validates %s paths before copying a callback into replay storage', async operation => {
  const f = fixture();
  f.run.mockImplementation(async (input: any) => {
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'bad-path',
      fileId: 'f', stage: 'native-open', operation, path: b('valid'), destination: b('valid') };
    if (operation === 'rename') request.destination = [0]; else request.path = [0];
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      await expect(input.access(f.credential, request)).rejects.toThrow('octets');
      expect(clone.mock.calls.some(([value]) => value === request)).toBe(false);
    } finally { clone.mockRestore(); }
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).not.toHaveBeenCalled();
});
it('validates original argv before retaining an invocation copy', async () => {
  const f = fixture(); const input = { ...binding, originalArgv: [[0]] };
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    await expect(f.runtime.execute(input, new AbortController().signal)).rejects.toThrow('octets');
    expect(clone.mock.calls.some(([value]) => value === input)).toBe(false);
  } finally { clone.mockRestore(); }
  expect(f.prepare).not.toHaveBeenCalled();
});
it('pins retained namespace methods before preparation can substitute scratch access', async () => {
  const f = fixture();
  const admitted = f.source.objects.open;
  admitted.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  const scratch = vi.fn(async () => { throw new Error('scratch authority'); });
  f.prepare.mockImplementation(async () => { f.source.objects.open = scratch; return f.ready; });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'late', fileId: 'nested', stage: 'native-open', operation: 'open', path: b('lists/nested/part.ts') });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(admitted).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});
it('uses the retained canonical append primitive and preserves partial progress after failure', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  let content = Uint8Array.of(1); const quota = Object.assign(new Error('quota'), { code: 'ENOSPC' });
  const append = vi.fn(async (bytes: Uint8Array) => {
    if (content.length === 2) throw quota;
    content = Uint8Array.of(...content, bytes[0]); return 1;
  });
  const stat = vi.fn(); const write = vi.fn();
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, append, stat, write });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'f', stage: 'native-append', ...operation });
    const file = await access({ operation: 'open', path: b('log'), access: 'write' });
    expect(await access({ operation: 'append', handle: file.handle, bytes: Uint8Array.of(2, 3) })).toBe(1);
    await expect(access({ operation: 'append', handle: file.handle, bytes: Uint8Array.of(3) })).rejects.toBe(quota);
    throw new Error('later failure');
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toMatchObject({ message: 'later failure' });
  expect(content).toEqual(Uint8Array.of(1, 2));
  expect(stat).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')).toMatchObject([{ operation: 'append', bytes: [2], count: 1, stage: 'native-append' }]);
  await effects.close();
});
it('refuses retained append when only pathname append or positional write is available', async () => {
  const f = fixture(); const write = vi.fn(); const appendFile = vi.fn();
  Object.assign(f.source, { appendFile });
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-append' };
    const file = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('log'), access: 'write' });
    await expect(input.access(f.credential, { ...common, callbackId: 'append', operation: 'append', handle: file.handle, bytes: Uint8Array.of(1) })).rejects.toMatchObject({ code: 'ENOTSUP' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(write).not.toHaveBeenCalled(); expect(appendFile).not.toHaveBeenCalled();
});
it('does not attribute retained writes to a replacement opened at the same pathname', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  const oldIdentity = {}; const replacementIdentity = {}; let identity = oldIdentity;
  const writes: object[] = [];
  f.source.objects.open.mockImplementation(async () => {
    const retained = identity;
    return { identity: retained, type: 'file', close: async () => {}, write: async () => { writes.push(retained); return 1; } };
  });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'f', stage: 'native-access', ...operation });
    const old = await access({ operation: 'open', path: b('out'), access: 'write' });
    identity = replacementIdentity;
    const replacement = await access({ operation: 'open', path: b('out'), access: 'write' });
    expect(old.object).not.toBe(replacement.object);
    await access({ operation: 'write', handle: old.handle, position: '0', bytes: [1] });
    await access({ operation: 'write', handle: replacement.handle, position: '0', bytes: [2] });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(writes).toEqual([oldIdentity, replacementIdentity]);
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')[0].path).toBeUndefined();
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')[1].path).toEqual(b('/work/out'));
  await effects.close();
});
it.each(['rename', 'unlink'] as const)('does not infer %s identity from a former open pathname', async operation => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, read: async () => Uint8Array.of(1) });
  Object.assign(f.source.objects, { rename: async () => ({ moved: true }), unlink: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (request: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'f', stage: 'native-access', ...request });
    const retained = await access({ operation: 'open', path: b('out') });
    // An external job may replace out after this open. Namespace operations do
    // not return a qualified object identity, so its former occupant is unknown.
    await access({ operation, path: b('out'), ...(operation === 'rename' ? { destination: b('new') } : {}) });
    expect(await access({ operation: 'read', handle: retained.handle, position: '0', maxBytes: 1 })).toEqual(Uint8Array.of(1));
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open')[0].object).toBeUndefined();
  await effects.close();
});
it('keeps both retained aliases attached after a same-object rename', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 });
  Object.assign(f.source.objects, { rename: async () => ({ moved: false }) });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'f', stage: 'native-access', ...operation });
    const a = await access({ operation: 'open', path: b('a'), access: 'write' });
    const alias = await access({ operation: 'open', path: b('alias'), access: 'write' });
    await access({ operation: 'rename', path: b('a'), destination: b('alias') });
    await access({ operation: 'write', handle: a.handle, position: '0', bytes: [1] });
    await access({ operation: 'write', handle: alias.handle, position: '0', bytes: [2] });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open').slice(1).map(effect => effect.path)).toEqual([b('/work/a'), b('/work/alias')]);
  await effects.close();
});
it.each([false, true])('uses one canonical rename receipt for effects, paths and replay (moved=%s)', async moved => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 });
  const observe = vi.fn(() => observe.mock.calls.length === 1 ? moved : !moved);
  const rename = vi.fn(async () => ({ get moved() { return observe(); } }));
  Object.assign(f.source.objects, { rename });
  f.run.mockImplementation(async (input: any) => {
    const base = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-access' };
    const opened = await input.access(f.credential, { ...base, callbackId: 'open', operation: 'open', path: b('a'), access: 'write' });
    const request = { ...base, callbackId: 'rename', operation: 'rename', path: b('a'), destination: b('alias') };
    expect(await input.access(f.credential, request)).toEqual({ moved });
    expect(await input.access(f.credential, request)).toEqual({ moved });
    await input.access(f.credential, { ...base, callbackId: 'write', operation: 'write', handle: opened.handle, position: '0', bytes: [1] });
    return { exitCode: 1 };
  });
  try {
    await f.runtime.execute(binding, new AbortController().signal);
    expect(observe).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledOnce();
    expect(effects.inspect().effects.find(effect => effect.operation === 'rename')?.moved).toBe(moved);
    expect(effects.inspect().effects.find(effect => effect.operation === 'write')?.path).toEqual(moved ? undefined : b('/work/a'));
  } finally { await effects.close(); }
});

it('drops uncertain retained path associations when rename has no canonical receipt', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockImplementation(async () => ({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 }));
  Object.assign(f.source.objects, { rename: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId: 'f', stage: 'native-access', ...operation });
    const source = await access({ operation: 'open', path: b('source/child'), access: 'write' });
    const displaced = await access({ operation: 'open', path: b('destination/child'), access: 'write' });
    await access({ operation: 'rename', path: b('source'), destination: b('destination') });
    await access({ operation: 'write', handle: source.handle, position: '0', bytes: [1] });
    await access({ operation: 'write', handle: displaced.handle, position: '0', bytes: [2] });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open').slice(1).map(effect => effect.path)).toEqual([undefined, undefined]);
  expect(effects.inspect().effects.filter(effect => effect.operation !== 'open').slice(1).every(effect => typeof effect.object === 'string')).toBe(true);
  await effects.close();
});
it('refuses missing argv entries and octets before preparing an execution namespace', async () => {
  const argument = Array<number>(3); argument[0] = 47; argument[2] = 97;
  for (const originalArgv of [Array(1), [argument]]) {
    const f = fixture();
    await expect(f.runtime.execute({ ...binding, originalArgv } as never, new AbortController().signal)).rejects.toThrow('octets');
    expect(f.prepare).not.toHaveBeenCalled();
  }
});
it('refuses missing binary write octets without synthesizing zero bytes in canonical storage', async () => {
  const f = fixture(); const write = vi.fn(async () => 2);
  const bytes = Array<number>(3); bytes[0] = 1; bytes[2] = 2;
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-write' };
    const file = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('out'), access: 'write' });
    await expect(input.access(f.credential, { ...common, callbackId: 'write', operation: 'write', handle: file.handle, position: '0', bytes })).rejects.toMatchObject({ code: 'EINVAL' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal); expect(write).not.toHaveBeenCalled();
});
it('observes canonical pathname and symlink metadata at each actual stat stage', async () => {
  const f = fixture(); let size = 1;
  const metadata = { mode: 0o755, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  const stat = vi.fn(async () => ({ type: 'directory', size: size++, ...metadata }));
  const lstat = vi.fn(async () => ({ type: 'symlink', size: 6, ...metadata }));
  Object.assign(f.source, { stat, lstat });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (operation: string) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'dir', stage: operation, callbackId: String(++n), operation, path: b('link/../directory') });
    expect(await access('path-stat')).toEqual({ type: 'directory', size: 1, ...metadata });
    expect(await access('path-stat')).toEqual({ type: 'directory', size: 2, ...metadata });
    expect(await access('path-lstat')).toEqual({ type: 'symlink', size: 6, ...metadata });
    expect(stat).toHaveBeenCalledWith('/work/link/../directory', expect.anything());
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
it('keeps backend authority tokens out of pathname metadata replies', async () => {
  const f = fixture();
  const metadata = { mode: 0o755, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  Object.assign(f.source, { stat: async () => ({ type: 'directory', size: 0, ...metadata, identityScope: Symbol('private authority'), dev: 1, ino: 2 }) });
  f.run.mockImplementation(async (input: any) => {
    expect(await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'd', stage: 'stat', callbackId: 'stat', operation: 'path-stat', path: b('.') })).toEqual({ type: 'directory', size: 0, ...metadata });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});
function fixture(effects?: ReturnType<typeof createEffectStore>, retainOutput?: import('./job-binding.js').JobBindingOptions['retainOutput']) {
  const source = { objects: { open: vi.fn() } };
  const credential = {};
  const ready = { ...binding, state: 'ready' as const, entries: [{ state: 'applied' }], readiness: [{ kind: 'required' as const, identity: 'tree', state: 'complete' as const }] };
  const prepare = vi.fn(async () => ready);
  const run = vi.fn(async () => ({ exitCode: 0 }));
  // Configure the source before issuing authority. Tests of post-issuance
  // replacement explicitly read runtime before substituting their source.
  let runtime: ReturnType<typeof createJobBinding> | undefined;
  return { get runtime() {
    return runtime ??= createJobBinding({ ...binding, fs: source as never, credential, prepare, run, maxCallbacks: 20, maxHandles: 10, effects, retainOutput });
  }, source, credential, ready, prepare, run };
}
it('requires complete matching readiness before process admission', async () => {
  for (const change of [{ sessionId: 'other' }, { directoryRevision: 'other' }, { state: 'applying' }, { entries: [{ state: 'pending' }] }, { readiness: [] }]) {
    const f = fixture(); Object.assign(f.ready, change);
    await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
    expect(f.run).not.toHaveBeenCalled();
  }
});

it('keeps identical relative paths bound to each authenticated session source', async () => {
  const observed: number[] = [];
  for (const [sessionId, value] of [['one', 1], ['two', 2]] as const) {
    const invocation = { ...binding, sessionId };
    const credential = {};
    const open = vi.fn(async (path: import('@poe-code/safe-fs/contracts/object').BytePath) => {
      expect(path.bytes()).toEqual(Uint8Array.from(b('/work/input')));
      return { identity: {}, type: 'file', read: async () => Uint8Array.of(value), close: async () => {} };
    });
    const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open } } as never, maxCallbacks: 10, maxHandles: 2,
      prepare: async input => ({ ...input, state: 'ready', entries: [{ state: 'applied' }], readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }] }),
      run: async input => {
        const common = { sessionId, epoch: 'e', jobId: input.jobId, fileId: 'input', stage: 'native-open' };
        await expect(input.access(credential, { ...common, sessionId: sessionId === 'one' ? 'two' : 'one', callbackId: 'foreign', operation: 'open', path: b('input') })).rejects.toThrow('Unauthorized');
        const opened = await input.access(credential, { ...common, callbackId: 'open', operation: 'open', path: b('input') }) as { handle: string };
        const bytes = await input.access(credential, { ...common, callbackId: 'read', operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 }) as Uint8Array;
        observed.push(bytes[0]);
        return { exitCode: 0 };
      },
    });
    await expect(runtime.execute({ ...invocation, sessionId: 'foreign' }, new AbortController().signal)).rejects.toThrow('authority');
    expect(open).not.toHaveBeenCalled();
    await runtime.execute(invocation, new AbortController().signal);
    expect(open).toHaveBeenCalledOnce();
  }
  expect(observed).toEqual([1, 2]);
});
it('snapshots original names, waits for required materialization and drains cancellation', async () => {
  const f = fixture(); const abort = new AbortController(); let release!: () => void;
  f.prepare.mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return f.ready; });
  const running = f.runtime.execute(binding, abort.signal);
  expect(f.run).not.toHaveBeenCalled(); abort.abort(new Error('stop')); release();
  await expect(running).rejects.toThrow('stop'); expect(f.run).not.toHaveBeenCalled();
});
it('releases late materialization and preserves cancellation even when its record cannot be cloned', async () => {
  const f = fixture(); const controller = new AbortController();
  const reason = new Error('canceled during materialization');
  const acquired = { ...f.ready, privateCapability: () => {} };
  const prepare = vi.fn(async () => { controller.abort(reason); return acquired; });
  const release = vi.fn(async (_workspace: import('./job-binding.js').ReadyJobWorkspace) => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential, prepare, release,
    maxCallbacks: 2, maxHandles: 1, run: f.run });
  await expect(runtime.execute(binding, controller.signal)).rejects.toBe(reason);
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0]).toBe(acquired);
  expect(f.run).not.toHaveBeenCalled();
});

it('releases acquired materialization when admission cannot snapshot its public record', async () => {
  const f = fixture(); const acquired = { ...f.ready, readiness: [{ ...f.ready.readiness[0], identity: (() => {}) as never }] };
  const release = vi.fn(async (_workspace: import('./job-binding.js').ReadyJobWorkspace) => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential, prepare: async () => acquired, release,
    maxCallbacks: 2, maxHandles: 1, run: f.run });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toMatchObject({ name: 'DataCloneError' });
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0]).toBe(acquired);
  expect(f.run).not.toHaveBeenCalled();
});
it('authenticates late nested dependencies and replays lost callbacks without reopening', async () => {
  const f = fixture(); const identity = {}; const close = vi.fn(async () => {});
  f.source.objects.open.mockResolvedValue({ identity, type: 'file', close, read: async () => new Uint8Array([7]), stat: async () => ({ type: 'file', size: 1n }) });
  f.run.mockImplementation(async (input: any) => {
    expect(input.invocation.originalArgv).toEqual(binding.originalArgv);
    const request = { jobId: input.jobId, sessionId: 's', epoch: 'e', callbackId: 'c1', fileId: 'playlist-child', stage: 'native-open', operation: 'open', path: b('lists/nested/part.ts') };
    await expect(input.access({}, request)).rejects.toThrow();
    const first = await input.access(f.credential, request);
    expect(await input.access(f.credential, request)).toEqual(first);
    expect(f.source.objects.open).toHaveBeenCalledTimes(1);
    expect(f.source.objects.open.mock.calls[0][0].bytes()).toEqual(Uint8Array.from(b('/work/lists/nested/part.ts')));
    await expect(input.access(f.credential, { ...request, path: b('other') })).rejects.toThrow();
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal); expect(close).toHaveBeenCalledTimes(1);
});

it('keeps retained identity through aliases, rename/unlink and canonical writes visible to other readers', async () => {
  const f = fixture(); const identity = {}; let value = new Uint8Array([1]);
  // Manifest occurrences remain distinct even when native opens retain one
  // source object through both spellings.
  f.ready.entries = [{ index: 0, state: 'applied' }, { index: 1, state: 'applied' }] as never;
  const names = new Set(['/work/a', '/work/alias']);
  const open = f.source.objects.open;
  open.mockImplementation(async (path) => {
    if (!names.has(new TextDecoder().decode(path.bytes()))) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { identity, type: 'file', close: async () => {}, read: async () => value.slice(), write: async (_offset: bigint, bytes: Uint8Array) => { value = bytes.slice(); return bytes.length; }, stat: async () => ({ type: 'file', size: BigInt(value.length) }) };
  });
  Object.assign(f.source.objects, {
    rename: async () => { names.delete('/work/a'); names.add('/work/new'); },
    unlink: async () => { names.delete('/work/new'); },
  });
  f.run.mockImplementation(async (input: any) => {
    let sequence = 0;
    const access = (operation: object, fileId = 'a') => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++sequence), fileId, stage: 'native-access', ...operation });
    const a = await access({ operation: 'open', path: b('a'), access: 'readwrite' });
    const alias = await access({ operation: 'open', path: b('alias') }, 'alias');
    expect(a.object).toBe(alias.object);
    await access({ operation: 'rename', path: b('a'), destination: b('new') });
    await access({ operation: 'unlink', path: b('new') });
    await access({ operation: 'write', handle: a.handle, position: '0', bytes: [9] });
    expect(await access({ operation: 'read', handle: alias.handle, position: '0', maxBytes: 1 }, 'alias')).toEqual(new Uint8Array([9]));
    expect(value).toEqual(new Uint8Array([9]));
    await expect(access({ operation: 'open', path: b('a') })).rejects.toMatchObject({ code: 'ENOENT' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('keeps speculative failures advisory and requires every declared starting-tree item', async () => {
  const f = fixture();
  f.ready.readiness.push({ kind: 'speculative', identity: 'late-missing-child', state: 'failed' } as never);
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.run).toHaveBeenCalledTimes(1);
  f.ready.readiness.push({ kind: 'required', identity: 'cwd', state: 'pending' } as never);
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('Incomplete');
  expect(f.run).toHaveBeenCalledTimes(1);
});

it('admits classified advisory entries without accessing them before native execution', async () => {
  const f = fixture();
  Object.assign(f.ready, { entries: [
    { state: 'applied', kind: 'required' },
    { state: 'failed', kind: 'speculative' },
    { state: 'pending', kind: 'metadata-only' },
  ] });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.source.objects.open).not.toHaveBeenCalled();
});

it.each([
  { state: 'pending', kind: 'required' },
  { state: 'failed' },
  { state: 'pending', kind: 'optional' },
  { state: 'invalid', kind: 'speculative' },
])('refuses incomplete or unclassified starting entries %j', async entry => {
  const f = fixture();
  Object.assign(f.ready, { entries: [entry] });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});

it('discovers nested playlists at native access time and never repeats a write after a lost reply', async () => {
  const f = fixture(); const files = new Map([['/work/root.m3u8', 'nested/child.m3u8'], ['/work/nested/child.m3u8', 'segment.ts'], ['/work/nested/segment.ts', 'old']]);
  let writes = 0;
  f.source.objects.open.mockImplementation(async path => {
    const name = new TextDecoder().decode(path.bytes());
    if (!files.has(name)) throw Object.assign(new Error(name), { code: 'ENOENT' });
    return { identity: {}, type: 'file', close: async () => {}, stat: async () => ({ type: 'file', size: 1n }), read: async () => new TextEncoder().encode(files.get(name)), write: async (_offset: bigint, bytes: Uint8Array) => { writes++; files.set(name, new TextDecoder().decode(bytes)); return bytes.length; } };
  });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const request = (fileId: string, operation: object) => ({ sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId, stage: 'demuxer-open', ...operation });
    const access = (fileId: string, op: object) => input.access(f.credential, request(fileId, op));
    const root = await access('root', { operation: 'open', path: b('root.m3u8') });
    const childName = await access('root', { operation: 'read', handle: root.handle, position: '0', maxBytes: 100 });
    const child = await access('child', { operation: 'open', path: Array.from(childName) });
    const leaf = await access('child', { operation: 'read', handle: child.handle, position: '0', maxBytes: 100 });
    // A canonical change after discovery must be seen by the later native open.
    files.set('/work/nested/segment.ts', 'live');
    const segment = await access('segment', { operation: 'open', path: [...b('nested/'), ...leaf], access: 'readwrite' });
    expect(new TextDecoder().decode(await access('segment', { operation: 'read', handle: segment.handle, position: '0', maxBytes: 100 }))).toBe('live');
    const write = request('segment', { operation: 'write', handle: segment.handle, position: '0', bytes: b('published') });
    await input.access(f.credential, write); // acknowledgement lost by the transport
    expect(await input.access(f.credential, write)).toBe(9);
    expect(files.get('/work/nested/segment.ts')).toBe('published');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(f.run).toHaveBeenCalledOnce(); expect(writes).toBe(1);
});

it('reports recovery identity when callback retention is gone rather than replaying a mutation', async () => {
  const f = fixture(); let retry!: () => Promise<unknown>; let jobId = '';
  f.run.mockImplementation(async (input: any) => {
    jobId = input.jobId;
    retry = () => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId, callbackId: 'lost', fileId: 'output', stage: 'native-write', operation: 'unlink', path: b('output') });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  await expect(retry()).rejects.toMatchObject({ outcome: 'unknown', sessionId: 's', epoch: 'e', jobId });
});

it('drains owned handles and retains the original failure when cleanup also fails', async () => {
  const f = fixture(); const original = new Error('native failure'); const cleanup = new Error('close failed');
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => { throw cleanup; } });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'open', fileId: 'f', stage: 'native-open', operation: 'open', path: b('file') });
    throw original;
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toMatchObject({ cause: original });
});

it.each([{ bytes: [1] }, { bytes: Uint8Array.of(1) }])('enforces open access even when a backend exposes extra object methods (%j)', async ({ bytes }) => {
  const f = fixture(); const write = vi.fn(async () => 1);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'f', stage: 'native-write', ...op });
    const opened = await access({ operation: 'open', path: b('file') });
    await expect(access({ operation: 'write', handle: opened.handle, position: '0', bytes })).rejects.toMatchObject({ code: 'EBADF' });
    expect(write).not.toHaveBeenCalled();
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('acknowledges delayed partial binary writes once and keeps them after command failure', async () => {
  const f = fixture(); let visible = new Uint8Array(); let finish!: () => void;
  const write = vi.fn(async (_position: bigint, bytes: Uint8Array) => {
    await new Promise<void>(resolve => { finish = resolve; });
    visible = bytes.slice(0, 1); return 1;
  });
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-write' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('file'), access: 'write' });
    const request = { ...common, callbackId: 'write', operation: 'write', handle: opened.handle, position: '9007199254740993', bytes: Uint8Array.of(255, 0) };
    let acknowledged = false;
    const pending = input.access(f.credential, request).then((count: number) => { acknowledged = true; return count; });
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(acknowledged).toBe(false); finish();
    expect(await pending).toBe(1);
    expect(await input.access(f.credential, request)).toBe(1);
    expect(write).toHaveBeenCalledWith(9007199254740993n, Uint8Array.of(255, 0), expect.anything());
    throw new Error('command failed');
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('command failed');
  expect(visible).toEqual(Uint8Array.of(255)); expect(write).toHaveBeenCalledOnce();
});

it('rejects invalid retained identities and oversized upstream reads, preserving short reads', async () => {
  const f = fixture(); const close = vi.fn(async () => {});
  f.source.objects.open.mockResolvedValueOnce({ identity: undefined, type: 'file', close });
  const read = vi.fn().mockResolvedValueOnce(Uint8Array.of(1, 2)).mockResolvedValueOnce(Uint8Array.of(3));
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close, read });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'f', stage: 'native-read', ...op });
    await expect(access({ operation: 'open', path: b('bad') })).rejects.toMatchObject({ code: 'ENOTSUP' });
    const opened = await access({ operation: 'open', path: b('good') });
    await expect(access({ operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 })).rejects.toMatchObject({ code: 'EIO' });
    expect(await access({ operation: 'read', handle: opened.handle, position: '0', maxBytes: 2 })).toEqual(Uint8Array.of(3));
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal); expect(close).toHaveBeenCalledTimes(2);
});

it('owns directory octets and ignores custom listing iterators at the remote boundary', async () => {
  const f = fixture();
  const bytes = Uint8Array.of(255, 128);
  const octetIterator = vi.fn(function* () { yield 47; });
  bytes[Symbol.iterator] = octetIterator;
  const entries = [{ name: new BytePath(bytes), type: 'file' }];
  const entryIterator = vi.fn(function* () { yield entries[0]!; yield entries[0]!; });
  entries[Symbol.iterator] = entryIterator;
  Object.assign(f.source.objects, { readdir: async () => entries });
  f.run.mockImplementation(async (input: any) => {
    expect(await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'list', fileId: 'directory', stage: 'native-readdir', operation: 'readdir', path: b('.') }))
      .toEqual([{ name: [255, 128], type: 'file' }]);
    expect(entryIterator).not.toHaveBeenCalled();
    expect(octetIterator).not.toHaveBeenCalled();
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('routes live directory listings without decoding byte names and preserves EXDEV', async () => {
  const f = fixture(); const exdev = Object.assign(new Error('different mount'), { code: 'EXDEV' });
  const readdir = vi.fn(async () => [{ name: new BytePath(Uint8Array.of(255)), type: 'file' }]);
  Object.assign(f.source.objects, { readdir, rename: async () => { throw exdev; } });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'directory', stage: 'native-readdir', ...op });
    expect(await access({ operation: 'readdir', path: b('directory') })).toEqual([{ name: [255], type: 'file' }]);
    expect(readdir.mock.calls[0][0].bytes()).toEqual(Uint8Array.from(b('/work/directory')));
    await expect(access({ operation: 'rename', path: b('a'), destination: b('mount/b') })).rejects.toBe(exdev);
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('queries canonical per-path capabilities and symlink targets only at native access', async () => {
  const f = fixture();
  const capabilitiesFor = vi.fn(async () => ({ readOnly: true, read: true, randomAccessWrite: false }));
  const readlink = vi.fn(async () => '../../live/playlist');
  Object.assign(f.source, { capabilitiesFor, readlink });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'link', stage: 'native-readlink', ...op });
    expect(readlink).not.toHaveBeenCalled(); expect(capabilitiesFor).not.toHaveBeenCalled();
    expect(await access({ operation: 'capabilities', path: b('readonly/link') })).toEqual({ readOnly: true, read: true, randomAccessWrite: false });
    expect(await access({ operation: 'readlink', path: b('readonly/link') })).toEqual(b('../../live/playlist'));
    expect(capabilitiesFor).toHaveBeenCalledWith('/work/readonly/link', expect.anything());
    await expect(access({ operation: 'readlink', path: [47, 255] })).rejects.toMatchObject({ code: 'EILSEQ' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('shares canonical visibility across simultaneous jobs, retains replaced objects and preserves quota progress', async () => {
  const f = fixture();
  const original = { identity: {}, bytes: Uint8Array.of(1, 2) };
  let pathname = original;
  let readerOpened!: () => void; const opened = new Promise<void>(resolve => { readerOpened = resolve; });
  let writerFinished!: () => void; const written = new Promise<void>(resolve => { writerFinished = resolve; });
  const quota = Object.assign(new Error('quota'), { code: 'EDQUOT' });
  f.source.objects.open.mockImplementation(async (_path, options) => {
    const retained = pathname;
    if (options.access === 'write') throw Object.assign(new Error('read-only mount'), { code: 'EROFS' });
    return {
      identity: retained.identity, type: 'file', close: async () => {},
      read: async (position: bigint, count: number) => retained.bytes.slice(Number(position), Number(position) + count),
      truncate: async (size: bigint) => { retained.bytes = retained.bytes.slice(0, Number(size)); },
      write: async (_position: bigint, bytes: Uint8Array) => {
        if (retained.bytes.length >= 1) throw quota;
        retained.bytes = bytes.slice(0, 1); return 1;
      },
    };
  });
  let jobs = 0;
  f.run.mockImplementation(async (input: any) => {
    const reader = jobs++ === 0; let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'shared', stage: reader ? 'native-read' : 'native-mogrify', ...op });
    if (reader) {
      const handle = await access({ operation: 'open', path: b('shared') }); readerOpened();
      await written;
      expect(await access({ operation: 'read', handle: handle.handle, position: '0', maxBytes: 4 })).toEqual(Uint8Array.of(255));
      const replacement = await access({ operation: 'open', path: b('shared') });
      expect(replacement.object).not.toBe(handle.object);
      expect(await access({ operation: 'read', handle: replacement.handle, position: '0', maxBytes: 4 })).toEqual(Uint8Array.of(9));
    } else {
      await opened;
      await expect(access({ operation: 'open', path: b('readonly'), access: 'write' })).rejects.toMatchObject({ code: 'EROFS' });
      const handle = await access({ operation: 'open', path: b('shared'), access: 'readwrite' });
      await access({ operation: 'truncate', handle: handle.handle, length: '0' });
      expect(original.bytes.length).toBe(0);
      expect(await access({ operation: 'write', handle: handle.handle, position: '0', bytes: [255, 0] })).toBe(1);
      await expect(access({ operation: 'write', handle: handle.handle, position: '1', bytes: [0] })).rejects.toBe(quota);
      pathname = { identity: {}, bytes: Uint8Array.of(9) }; writerFinished();
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  });
  expect(await Promise.all([f.runtime.execute(binding, new AbortController().signal), f.runtime.execute(binding, new AbortController().signal)])).toEqual([{ exitCode: 0 }, { exitCode: 1 }]);
  expect(original.bytes).toEqual(Uint8Array.of(255));
});

it('exposes settled live output effects after native failure without replaying rejected writes', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
  const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'passlog', stage: 'native-passlog', ...op });
    const file = await access({ operation: 'open', path: b('passlog'), access: 'write' });
    await access({ operation: 'write', handle: file.handle, position: '0', bytes: [255, 0] });
    throw new Error('later native failure');
  });
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toMatchObject({ message: 'later native failure', effects: { native: { state: 'failed' }, effects: [{ operation: 'open' }, { operation: 'write', count: 1 }] } });
  expect(effects.inspect().native).toEqual({ state: 'failed', error: 'later native failure' });
  expect(effects.inspect().effects).toMatchObject([{ operation: 'open' }, { operation: 'write', bytes: [255], count: 1, path: b('/work/passlog') }]);
});

it('records generated directories and empty files only from actual creation callbacks', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
  const f = fixture(effects);
  const mkdir = vi.fn(async () => {});
  const create = vi.fn(async () => ({ identity: {}, type: 'file', creation: 'created', close: async () => {} }));
  Object.assign(f.source, { mkdir }); Object.assign(f.source.objects, { create });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'hls', stage: 'native-create', ...op });
    await access({ operation: 'mkdir', path: b('hls') });
    await access({ operation: 'create', path: b('hls/empty.ts'), access: 'write' });
    return { exitCode: 1 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects).toMatchObject([{ operation: 'mkdir', path: b('/work/hls') }, { operation: 'created', path: b('/work/hls/empty.ts') }]);
  expect(mkdir).toHaveBeenCalledWith('/work/hls', expect.any(Object));
});

it('does not relink removed outputs when retained descriptors write after unlink', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 });
  Object.assign(f.source.objects, { unlink: async () => {} });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'intermediate', stage: 'native-write', ...op });
    const file = await access({ operation: 'open', path: b('intermediate'), access: 'write' });
    await access({ operation: 'unlink', path: b('intermediate') });
    await access({ operation: 'write', handle: file.handle, position: '0', bytes: [255] });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects.at(-1)?.path).toBeUndefined();
});

it('keeps retrieval retain failure separate from the native canonical write', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 });
  const f = fixture(effects, async () => { throw new Error('retention quota'); });
  const write = vi.fn(async () => 1);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native' };
    const file = await input.access(f.credential, { ...common, callbackId: '1', operation: 'open', path: b('a'), access: 'write' });
    await input.access(f.credential, { ...common, callbackId: '2', operation: 'write', handle: file.handle, position: '0', bytes: [255] });
    return { exitCode: 0 };
  });
  expect(await f.runtime.execute(binding, new AbortController().signal)).toEqual({ exitCode: 0 });
  expect(write).toHaveBeenCalledOnce();
  expect(effects.inspect().retrievalFailures).toMatchObject([{ error: 'retention quota' }]);
});

it('drops retained child path associations across a generated directory rename', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects);
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, write: async () => 1 });
  Object.assign(f.source.objects, { rename: async () => ({ moved: true }) });
  f.run.mockImplementation(async (input: any) => {
    let n = 0;
    const access = (op: object) => input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: String(++n), fileId: 'segment', stage: 'native', ...op });
    const file = await access({ operation: 'open', path: b('hls/segment.ts'), access: 'write' });
    await access({ operation: 'rename', path: b('hls'), destination: b('renamed') });
    await access({ operation: 'write', handle: file.handle, position: '0', bytes: [255] });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(effects.inspect().effects.at(-1)?.path).toBeUndefined();
  expect(effects.inspect().effects.at(-1)?.object).toBeTypeOf('string');
});

it('retains a completed creation receipt when cancellation races its acknowledgement', async () => {
  const effects = createEffectStore({ maxEffects: 20, maxFrameBytes: 2 }); const f = fixture(effects); const abort = new AbortController();
  const close = vi.fn(async () => {});
  Object.assign(f.source.objects, { create: async () => { abort.abort(new Error('cancelled')); return { identity: {}, type: 'file', creation: 'created', close }; } });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'create', fileId: 'empty', stage: 'native-create', operation: 'create', path: b('empty'), access: 'write' });
    return { exitCode: 0 };
  });
  await expect(f.runtime.execute(binding, abort.signal)).rejects.toMatchObject({ effects: { native: { state: 'cancelled' }, effects: [{ operation: 'created', path: b('/work/empty') }] } });
  expect(close).toHaveBeenCalledOnce();
});

it('owns canonical read replies in the replay ledger before a later read reuses the producer buffer', async () => {
 const f=fixture();const producer=Buffer.alloc(1);let value=7;
 f.source.objects.open.mockResolvedValue({identity:{},type:'file',close:async()=>{},read:async()=>{producer[0]=value++;return producer;}});
 f.run.mockImplementation(async (input:any)=>{
  const common={sessionId:'s',epoch:'e',jobId:input.jobId,fileId:'f',stage:'read'};
  const opened=await input.access(f.credential,{...common,callbackId:'open',operation:'open',path:b('live')});
  const request={...common,callbackId:'first',operation:'read',handle:opened.handle,position:'0',maxBytes:1};
  expect(await input.access(f.credential,request)).toEqual(Uint8Array.of(7));
  await input.access(f.credential,{...request,callbackId:'second'});
  expect(await input.access(f.credential,request)).toEqual(Uint8Array.of(7));
  return {exitCode:0};
 });
 await f.runtime.execute(binding,new AbortController().signal);
});

it('passes directory admission limits to canonical storage before listing allocation',async()=>{
 const f=fixture();const readdir=vi.fn(async (_path:unknown,options:any)=>{expect(options.maxEntries).toBe(4096);return [];});
 Object.assign(f.source.objects,{readdir});
 f.run.mockImplementation(async(input:any)=>{await input.access(f.credential,{sessionId:'s',epoch:'e',jobId:input.jobId,fileId:'d',stage:'listing',callbackId:'list',operation:'readdir',path:b('.')});return {exitCode:0};});
 await f.runtime.execute(binding,new AbortController().signal);
});

it('routes authenticated descriptor callbacks to caller leases without reopening a pathname',async()=>{
 const credential={};const close=vi.fn(async()=>{});const open=vi.fn();const acquire=vi.fn(async()=>({identity:{},read:async()=>({done:false as const,value:Uint8Array.of(255)}),close}));
 const runtime=createJobBinding({...binding,credential,fs:{objects:{open}},handles:{acquire},maxHandles:2,maxCallbacks:10,
 prepare:async input=>({...input,state:'ready',entries:[],readiness:[{kind:'required',identity:'fds',state:'complete'}]}),
 run:async input=>{
  const common={sessionId:'s',epoch:'e',jobId:input.jobId,fileId:'stdin',stage:'descriptor'};
  const opened=await input.access(credential,{...common,callbackId:'acquire',operation:'descriptor-acquire',fd:3,rights:['read']}) as {handle:string};
  await expect(input.access(credential,{...common,fileId:'foreign',callbackId:'foreign',operation:'descriptor-read',handle:opened.handle,maxBytes:8})).rejects.toMatchObject({code:'EBADF'});
  expect(await input.access(credential,{...common,callbackId:'read',operation:'descriptor-read',handle:opened.handle,maxBytes:8})).toEqual({done:false,value:Uint8Array.of(255)});
  return {exitCode:1};
 }});
 expect(await runtime.execute(binding,new AbortController().signal)).toEqual({exitCode:1});
 expect(open).not.toHaveBeenCalled();expect(acquire).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it('pins the supplied source capability while preparation and late accesses run', async () => {
  const f = fixture();
  const foreign = { open: vi.fn(async () => { throw new Error('foreign authority'); }) };
  const admitted = f.source.objects;
  admitted.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {} });
  f.prepare.mockImplementation(async () => {
    f.source.objects = foreign;
    return f.ready;
  });
  f.run.mockImplementation(async (input: any) => {
    await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'late', fileId: 'child', stage: 'native-open', operation: 'open', path: b('nested/child') });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(admitted.open).toHaveBeenCalledOnce();
  expect(foreign.open).not.toHaveBeenCalled();
});

it('rejects sparse readiness and entry records before native admission', async () => {
  for (const field of ['readiness', 'entries'] as const) {
    const f = fixture();
    f.ready[field].length = 2;
    await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow();
    expect(f.run).not.toHaveBeenCalled();
  }
});

it('pins canonical pathname methods before workspace preparation', async () => {
  const f = fixture();
  const metadata = { mode: 0o755, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  const stat = vi.fn(async () => ({ type: 'directory', size: 0, ...metadata }));
  const foreign = vi.fn(async () => { throw new Error('scratch authority'); });
  Object.assign(f.source, { stat });
  f.prepare.mockImplementation(async () => { Object.assign(f.source, { stat: foreign }); return f.ready; });
  f.run.mockImplementation(async (input: any) => {
    expect(await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'stat', fileId: 'cwd', stage: 'native-stat', operation: 'path-stat', path: b('.') })).toEqual({ type: 'directory', size: 0, ...metadata });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
  expect(stat).toHaveBeenCalledOnce(); expect(foreign).not.toHaveBeenCalled();
});

it('does not release a different binding when the driver mutates its ready record during execution', async () => {
  const f = fixture(); const release = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential, prepare: f.prepare, release,
    maxCallbacks: 10, maxHandles: 2, run: async () => { f.ready.directoryRevision = 'replacement'; return { exitCode: 0 }; } });
  await runtime.execute(binding, new AbortController().signal);
  expect(release.mock.calls[0][0].directoryRevision).toBe(binding.directoryRevision);
});

it('requires readiness identities to name actual work with strings', async () => {
  const f = fixture();
  f.ready.readiness[0].identity = 1 as never;
  await expect(f.runtime.execute(binding, new AbortController().signal)).rejects.toThrow('readiness');
  expect(f.run).not.toHaveBeenCalled();
});


it.each(['write', 'append', 'descriptor-write', 'read', 'descriptor-read'] as const)('rejects oversized %s frames before copying them into callback retention', async operation => {
  const f = fixture();
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, run: f.run, maxCallbacks: 2, maxHandles: 1, maxIoBytes: 2 });
  f.run.mockImplementation(async (input: any) => {
    const bytes = Uint8Array.of(1, 2, 3);
    const request = { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'oversized',
      fileId: 'f', stage: 'native-write', operation, handle: 'unused', position: '0', bytes, maxBytes: 3 };
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      await expect(input.access(f.credential, request)).rejects.toMatchObject({ code: 'EINVAL' });
      expect(clone.mock.calls.some(([value]) => value === request)).toBe(false);
    } finally { clone.mockRestore(); }
    return { exitCode: 0 };
  });
  await runtime.execute(binding, new AbortController().signal);
  expect(f.source.objects.open).not.toHaveBeenCalled();
});

it('returns the canonical directory type admitted before wire serialization', async () => {
  const f = fixture(); let reads = 0;
  Object.assign(f.source.objects, { readdir: async () => [{ name: new BytePath(Uint8Array.of(255)),
    get type() { return ++reads === 1 ? 'fifo' : 'block'; } }] });
  f.run.mockImplementation(async (input: any) => {
    expect(await input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'list', fileId: 'd', stage: 'native-readdir', operation: 'readdir', path: b('.') }))
      .toEqual([{ name: [255], type: 'fifo' }]);
    expect(reads).toBe(1);
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it.each(['kind', 'sparse', 'bytes'] as const)('refuses malformed canonical directory %s instead of advertising it to native callers', async malformed => {
  const f = fixture();
  const entries = malformed === 'sparse' ? new Array(1) : [{
    name: malformed === 'bytes' ? { bytes: () => [120] } : new BytePath(Uint8Array.of(120)),
    type: malformed === 'kind' ? 'unknown' : 'file',
  }];
  Object.assign(f.source.objects, { readdir: async () => entries });
  f.run.mockImplementation(async (input: any) => {
    await expect(input.access(f.credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'list', fileId: 'd', stage: 'native-readdir', operation: 'readdir', path: b('.') }))
      .rejects.toMatchObject({ code: 'EIO', syscall: 'readdir' });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it('rejects a job reused with another invocation source capability before preparation', async () => {
  const f = fixture();
  await expect(f.runtime.execute(binding, new AbortController().signal, { objects: { open: vi.fn() } } as never)).rejects.toThrow('source capability');
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});

it('owns canonical metadata replies before the source mutates its observation', async () => {
  const f = fixture(); const observation = { type: 'file', size: 1n };
  f.source.objects.open.mockResolvedValue({ identity: {}, type: 'file', close: async () => {}, stat: async () => observation });
  f.run.mockImplementation(async (input: any) => {
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-stat' };
    const opened = await input.access(f.credential, { ...common, callbackId: 'open', operation: 'open', path: b('input') });
    const request = { ...common, callbackId: 'stat', operation: 'stat', handle: opened.handle };
    expect(await input.access(f.credential, request)).toMatchObject({ size: 1n });
    observation.size = 9n;
    expect(await input.access(f.credential, request)).toMatchObject({ size: 1n });
    expect(await input.access(f.credential, { ...request, callbackId: 'fresh' })).toMatchObject({ size: 9n });
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});


it('admits private workspace capabilities and releases their binding snapshot', async () => {
  const f = fixture(); const privateCapability = () => {};
  const acquired = { ...f.ready, privateCapability };
  const release = vi.fn(async (_workspace: import('./job-binding.js').ReadyJobWorkspace) => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: async () => acquired, release, maxCallbacks: 2, maxHandles: 1, run: f.run });
  expect(await runtime.execute(binding, new AbortController().signal)).toEqual({ exitCode: 0 });
  expect(f.run).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0]).toMatchObject({ directoryRevision: binding.directoryRevision, privateCapability });
});

it('revalidates live required work and rechecks readiness after the validation barrier', async () => {
  const f = fixture(); const validate = vi.fn(async () => { f.ready.readiness[0].state = 'pending'; });
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, validate, maxCallbacks: 2, maxHandles: 1, run: f.run });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow('readiness');
  expect(validate).toHaveBeenCalledOnce(); expect(f.run).not.toHaveBeenCalled();
});


it('keeps speculative validation failures advisory without replacing required work', async () => {
  const f = fixture();
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => { f.ready.readiness.push({ kind: 'speculative', identity: 'nested/optional', state: 'failed' } as never); },
  });
  expect(await runtime.execute(binding, new AbortController().signal)).toEqual({ exitCode: 0 });
  expect(f.run).toHaveBeenCalledOnce();
});

it('rejects replacement of logically required work during live validation', async () => {
  const f = fixture();
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => { f.ready.readiness[0].identity = 'different-tree'; },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow('materialization');
  expect(f.run).not.toHaveBeenCalled();
});


it.each(['sessionId', 'epoch', 'buildId', 'sourceAuthorityId', 'bindingId'] as const)(
  'admits a single owned invocation snapshot when the caller changes %s on observation', async field => {
    const f = fixture();
    let observations = 0;
    const input = { ...binding };
    Object.defineProperty(input, field, { enumerable: true, get() {
      return ++observations <= 4 ? binding[field] : 'another-authority';
    } });
    f.prepare.mockImplementation(async admitted => ({ ...f.ready, ...admitted }));
    await f.runtime.execute(input, new AbortController().signal);
    expect(f.prepare.mock.calls[0][0][field]).toBe(binding[field]);
    expect(f.run.mock.calls[0][0].invocation[field]).toBe(binding[field]);
    expect(observations).toBe(1);
  },
);


it('rejects the captured foreign session before workspace acquisition', async () => {
  const f = fixture();
  let observations = 0;
  const input = { ...binding };
  Object.defineProperty(input, 'sessionId', { enumerable: true, get() {
    return ++observations === 1 ? 'foreign-session' : binding.sessionId;
  } });
  await expect(f.runtime.execute(input, new AbortController().signal)).rejects.toThrow('authority mismatch');
  expect(observations).toBe(1);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

it('rejects original argv that becomes incomplete while retaining its owned snapshot', async () => {
  const f = fixture();
  let observations = 0;
  const arg = [65];
  Object.defineProperty(arg, '0', { enumerable: true, get() {
    return ++observations === 1 ? 65 : 0;
  } });
  await expect(f.runtime.execute({ ...binding, originalArgv: [arg] }, new AbortController().signal)).rejects.toThrow('octets');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});


it.each([
  { originalArgv: [new Array(524288).fill(97), new Array(524288).fill(98)] },
  { originalArgv: new Array(1048577).fill([]) },
])('rejects aggregate argv overflow before preparing the starting tree', async ({ originalArgv }) => {
  const f = fixture();
  await expect(f.runtime.execute({ ...binding, originalArgv }, new AbortController().signal))
    .rejects.toThrow('Native argv limit');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});


it('admits argv at the aggregate boundary with empty argument terminators accounted', () => {
  const originalArgv = [new Array(524287).fill(97), new Array(524286).fill(98), []];
  expect(() => assertNativeProcessView(binding.cwd, originalArgv)).not.toThrow();
  expect(() => assertNativeProcessView(binding.cwd, [...originalArgv, []])).toThrow('Native argv limit');
});


it.each([undefined, null, NaN, Infinity, -1, 1.5, 256])('rejects unqualified native completion %j and still releases the workspace', async exitCode => {
  const f = fixture();
  const release = vi.fn(async () => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, release, maxCallbacks: 2, maxHandles: 1,
    run: async () => ({ exitCode: exitCode as number }),
  });
  await expect(runtime.execute(binding, new AbortController().signal)).rejects.toThrow('Invalid native exit status');
  expect(release).toHaveBeenCalledOnce();
});


it('admits only public workspace evidence without observing private scratch authority', async () => {
  const f = fixture();
  const scratch = vi.fn(() => { throw new Error('scratch authority observed'); });
  Object.defineProperty(f.ready, 'scratchRoot', { enumerable: true, get: scratch });
  const release = vi.fn(async (_snapshot: import('./job-binding.js').ReadyJobWorkspace, _acquired: import('./job-binding.js').ReadyJobWorkspace) => {});
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, release, run: f.run, maxCallbacks: 2, maxHandles: 1 });
  expect(await runtime.execute(binding, new AbortController().signal)).toEqual({ exitCode: 0 });
  expect(scratch).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0].directoryRevision).toBe('d');
  expect(release.mock.calls[0][1]).toBe(f.ready);
});

// Socket acquisition is native-stage work, independent of filesystem hints.
it('admits authenticated native endpoints and retires them with the job', async () => {
  const f = fixture();
  const close = vi.fn(async () => {});
  const open = vi.fn(async (_request: import('./endpoint.js').NativeEndpointRequest) => ({ close }));
  const context = { network: 'caller', dns: 'caller', proxy: 'none', bind: 'caller', tls: 'native', certificates: 'synthetic' };
  const request = { buildDigest: 'digest', context, protocol: 'udp', semantics: 'datagram' as const,
    operation: 'bind' as const, endpoint: new TextEncoder().encode('udp://localhost:9000'), options: [], stage: 'native-socket' };
  let late!: () => Promise<unknown>;
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 20, maxHandles: 1,
    endpoints: { buildDigest: 'digest', access: { open } },
    run: async input => {
      await expect(input.openEndpoint({}, request)).rejects.toThrow('Unauthorized endpoint');
      await expect(input.openEndpoint(f.credential, { ...request, buildDigest: 'other' })).rejects.toThrow('Endpoint build mismatch');
      const lease = await input.openEndpoint(f.credential, request);
      await expect(input.openEndpoint(f.credential, request)).rejects.toThrow('Endpoint handle bound');
      await lease.close();
      await input.openEndpoint(f.credential, request);
      late = () => input.openEndpoint(f.credential, request);
      return { exitCode: 0 };
    },
  });
  await runtime.execute(binding, new AbortController().signal);
  expect(open).toHaveBeenCalledTimes(2);
  expect(open.mock.calls[0][0]).toMatchObject(request);
  expect(close).toHaveBeenCalledTimes(2);
  expect(f.source.objects.open).not.toHaveBeenCalled();
  await expect(late()).rejects.toThrow('retention ended');
});
it('keeps absent endpoint transport a native-stage capability gap', async () => {
  const f = fixture();
  f.run.mockImplementation(async (input: any) => {
    await expect(input.openEndpoint(f.credential, {})).rejects.toThrow('No admitted endpoint');
    return { exitCode: 0 };
  });
  await f.runtime.execute(binding, new AbortController().signal);
});

it.each(['direct', 'relay'] as const)('binds UDP admission through the %s provider path', async route => {
  const f = fixture();
  const context = { network: 'caller', dns: 'caller', proxy: 'none', bind: 'caller', tls: 'native', certificates: 'synthetic' };
  const endpoint = Buffer.from('udp://localhost:9000?synthetic=%2f+X');
  const request = { buildDigest: 'digest', context, protocol: 'udp', semantics: 'datagram' as const,
    operation: 'bind' as const, endpoint, options: [], stage: 'native-bind' };
  const close = vi.fn(async () => {});
  const open = vi.fn(async (_input: unknown) => ({ close }));
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    admittedRelays: route === 'relay' ? ['fixture'] : [], providers: [{ id: 'fixture', open,
      capabilities: [{ buildDigest: 'digest', context, route, evidence: ['mock:synthetic-only'],
        transports: [{ protocol: 'udp', semantics: 'datagram', operation: 'bind', endpoint }] }] }] });
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 20, maxHandles: 1, endpoints: { buildDigest: 'digest', access },
    run: async input => {
      const acquisition = input.openEndpoint(f.credential, request);
      endpoint.fill(0);
      await acquisition;
      expect(open.mock.calls[0][0]).toMatchObject({ route, request: { endpoint: new TextEncoder().encode('udp://localhost:9000?synthetic=%2f+X'), stage: 'native-bind' } });
      return { exitCode: 0 };
    },
  });
  await runtime.execute(binding, new AbortController().signal);
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});


it('keeps required manifest identity stable when concurrent validation reorders entry observations', async () => {
  const f = fixture();
  f.ready.entries = [{ index: 0, state: 'applied' }, { index: 1, state: 'applied' }];
  const runtime = createJobBinding({ ...binding, fs: f.source as never, credential: f.credential,
    prepare: f.prepare, maxCallbacks: 2, maxHandles: 1, run: f.run,
    validate: async () => { f.ready.entries.reverse(); },
  });
  await expect(runtime.execute(binding, new AbortController().signal)).resolves.toEqual({ exitCode: 0 });
  expect(f.run).toHaveBeenCalledOnce();
});


it('rejects a job issued against replacement source methods before materialization', async () => {
  const f = fixture();
  const admission = captureJobSource(f.source as never);
  f.source.objects.open = vi.fn();
  await expect(f.runtime.execute(binding, new AbortController().signal, f.source as never, admission))
    .rejects.toThrow('source capability');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

it('uses the issued source admission after its container changes without recapturing scratch methods', async () => {
  const f = fixture();
  const admission = captureJobSource(f.source as never);
  const runtime = f.runtime;
  f.source.objects.open = vi.fn();
  await expect(runtime.execute(binding, new AbortController().signal, f.source as never, admission))
    .resolves.toEqual({ exitCode: 0 });
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenCalledOnce();
});
