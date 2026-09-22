import { expect, it, vi } from 'vitest';
import { createJobBinding, type BoundJobRun, type JobFileRequest } from './job-binding.js';
import { createEffectStore } from './effects.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
const credential = {};
const ready = { ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required' as const, identity: 'cwd', state: 'complete' as const }] };
function access(input: BoundJobRun, request: object) {
  return input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'f', stage: 'native-open', ...request } as JobFileRequest);
}

it('allows a pending canonical read acquisition to be unblocked by a writer acquisition', async () => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const open = vi.fn(async (_path, options) => {
    if (options.access === 'read') { enter(); await gate; }
    else release();
    return { identity: {}, type: 'file' as const, stat: vi.fn(), close: async () => {} };
  });
  const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open } },
    maxCallbacks: 4, maxHandles: 2, prepare: async () => ready, run: async input => {
      const reading = access(input, { callbackId: 'reader', operation: 'open', path: bytes('shared'), access: 'read' });
      await entered;
      const writing = access(input, { callbackId: 'writer', operation: 'open', path: bytes('shared'), access: 'write' });
      try {
        for (let n = 0; n < 10; n++) await Promise.resolve();
        expect(open).toHaveBeenCalledTimes(2);
      } finally { release(); await Promise.allSettled([reading, writing]); }
      return { exitCode: 0 };
    } });
  await runtime.execute(invocation, new AbortController().signal);
});

it('does not reattach a late retained acquisition to a pathname renamed while open was pending', async () => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const identity = {};
  const object = { identity, type: 'file' as const, stat: vi.fn(), close: async () => {}, write: async () => 1 };
  const effects = createEffectStore({ maxEffects: 4, maxFrameBytes: 4 });
  const runtime = createJobBinding({ ...invocation, credential, effects,
    fs: { objects: { open: async () => { enter(); await gate; return object; }, rename: async () => ({ moved: true }) } },
    maxCallbacks: 4, maxHandles: 2, prepare: async () => ready, run: async input => {
      const opening = access(input, { callbackId: 'open', operation: 'open', path: bytes('old'), access: 'write' });
      await entered;
      const renaming = access(input, { callbackId: 'rename', operation: 'rename', path: bytes('old'), destination: bytes('new') });
      try {
        for (let n = 0; n < 10; n++) await Promise.resolve();
        const marker = {};
        expect(await Promise.race([renaming, Promise.resolve(marker)])).toEqual({ moved: true });
      } finally { release(); await renaming; }
      const opened = await opening as { handle: string };
      await access(input, { callbackId: 'write', operation: 'write', handle: opened.handle, position: '0', bytes: Uint8Array.of(9) });
      return { exitCode: 1 };
    } });
  await runtime.execute(invocation, new AbortController().signal);
  expect(effects.inspect().effects.find(effect => effect.operation === 'write')).toMatchObject({ count: 1 });
  expect(effects.inspect().effects.find(effect => effect.operation === 'write')?.path).toBeUndefined();
  await effects.close();
});

it.each(['created', 'truncated'] as const)('keeps the canonical %s receipt when retained-object admission fails', async creation => {
  const effects = createEffectStore({ maxEffects: 2, maxFrameBytes: 2 });
  let content = Uint8Array.of(7);
  const close = vi.fn(async () => {});
  const runtime = createJobBinding({ ...invocation, credential, effects,
    fs: { objects: { open: vi.fn(), create: async () => {
      content = new Uint8Array();
      return { identity: {} as object, type: 'socket' as const, creation, stat: vi.fn(), close };
    } } }, maxCallbacks: 2, maxHandles: 1, prepare: async () => ready, run: async input => {
      await expect(access(input, { callbackId: 'create', operation: 'create', path: bytes('out'), flag: 'w', access: 'write' }))
        .rejects.toMatchObject({ code: 'ENOTSUP' });
      return { exitCode: 1 };
    } });
  await runtime.execute(invocation, new AbortController().signal);
  expect(content).toHaveLength(0);
  expect(close).toHaveBeenCalledOnce();
  expect(effects.inspect().effects).toEqual([expect.objectContaining({ operation: creation === 'created' ? 'created' : 'truncate',
    path: bytes('/work/out'), callbackId: 'create', stage: 'native-open', ...(creation === 'truncated' ? { length: '0' } : {}) })]);
  await effects.close();
});

it('reserves combined handle capacity during acquisition and releases refused acquisitions', async () => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const failure = Object.assign(new Error('backend refused'), { code: 'EROFS', syscall: 'open' });
  const open = vi.fn(async () => { enter(); await gate; throw failure; });
  const acquire = vi.fn(async () => ({ identity: {}, close: async () => {} }));
  const runtime = createJobBinding({ ...invocation, credential, fs: { objects: { open } }, handles: { acquire },
    maxCallbacks: 5, maxHandles: 1, prepare: async () => ready, run: async input => {
      const opening = access(input, { callbackId: 'pending', operation: 'open', path: bytes('shared') });
      const outcome = opening.catch(error => error);
      await entered;
      const refused = access(input, { callbackId: 'refused', operation: 'descriptor-acquire', fd: 3, rights: [] }).catch(error => error);
      try {
        for (let n = 0; n < 10; n++) await Promise.resolve();
        expect(acquire).not.toHaveBeenCalled();
        // The refusal must settle while the upstream acquisition is pending.
        const marker = {};
        expect(await Promise.race([refused, Promise.resolve(marker)])).toMatchObject({ code: 'EMFILE' });
      } finally { release(); await Promise.allSettled([opening, refused]); }
      expect(await outcome).toBe(failure);
      await access(input, { callbackId: 'retry', operation: 'descriptor-acquire', fd: 3, rights: [] });
      expect(acquire).toHaveBeenCalledOnce();
      return { exitCode: 0 };
    } });
  await runtime.execute(invocation, new AbortController().signal);
});
