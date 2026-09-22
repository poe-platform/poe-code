import { expect, it, vi } from 'vitest';
import { createMediaEngine } from './engine.js';
import { createJobBinding } from '@poe-code/remote-execution';
import type { JobFileRequest } from '@poe-code/remote-execution';
const io = () => ({stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(){}}});
it.each([
  ['entries', 'state'], ['readiness', 'state'], ['entries', 'slot'], ['readiness', 'slot'],
  ['entries', 'ledger'], ['readiness', 'ledger'],
] as const)('rejects required %s %s replaced by an accessor and drains engine ownership', async (field, target) => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const replacement = vi.fn(() => target === 'state' ? 'pending'
    : target === 'slot' ? { state: 'pending' } : [{ state: 'pending' }]);
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    run, release, prepare: async input => {
      const workspace = { ...input, state: 'ready', entries: [{ state: 'applied' }],
        readiness: [{ kind: 'required' as const, identity: 'cwd', state: 'complete' as const }] };
      const required = workspace[field][0];
      workspace.readiness.push({ kind: 'speculative', identity: 'nested-playlist', get state() {
        Object.defineProperty(target === 'state' ? required : target === 'slot' ? workspace[field] : workspace,
          target === 'state' ? 'state' : target === 'slot' ? '0' : field,
          { configurable: true, get: replacement });
        return 'failed';
      } } as never);
      return workspace;
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
    cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});
it('rejects a workspace replaced during metadata capture and retires the original reservation', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => {
    const workspace = { ...input, state: 'ready', entries: [{ state: 'applied' }],
      readiness: [{ kind: 'required' as const, identity: 'cwd', get state() {
        workspace.entries = [{ state: 'pending' }];
        return 'complete' as const;
      } }] };
    return workspace;
  });
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    prepare, release, run });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
    cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('materialization');
  expect(run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][1]).toBe(await prepare.mock.results[0].value);
});
it('rejects readiness revoked during capture through the engine and releases the acquired workspace', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const required: import('@poe-code/remote-execution').ReadinessWork = { kind: 'required', identity: 'cwd', state: 'complete' };
  const failure = vi.fn(() => { throw new Error('speculative playlist missing'); });
  const speculative = Object.defineProperty({ kind: 'speculative' as const, identity: 'nested-playlist',
    get state() { required.state = 'pending'; return 'failed' as const; } }, 'failure', { get: failure });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn<NonNullable<import('@poe-code/remote-execution').JobBindingOptions['release']>>(async () => {});
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({
    ...input, state: 'ready', entries: [], readiness: [required, speculative],
  }));
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    prepare, release, run });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
    cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('readiness');
  expect(run).not.toHaveBeenCalled();
  expect(prepare).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][1]).toBe(await prepare.mock.results[0].value);
  expect(failure).not.toHaveBeenCalled();
});
it.each([undefined, null, 'ambient', 1, []].map(env => [env]))('rejects an incomplete exported environment before binding (%j)', async env => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work',
    env: env as never, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
    .rejects.toThrow('native environment');
  expect(bind).not.toHaveBeenCalled();
});
it('rejects argv appended during snapshot before acquiring a session binding', async () => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  const args = [new TextEncoder().encode('relative/input')];
  Object.defineProperty(args, '0', { get() {
    args.push(new TextEncoder().encode('/another-session/input'));
    return new TextEncoder().encode('relative/input');
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args, cwd: '/work', env: {},
    fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
    .rejects.toThrow('native argv');
  expect(bind).not.toHaveBeenCalled();
});
it.each(['entries', 'readiness'] as const)('rejects growing required %s through engine admission and drains the reservation', async field => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    run, release, prepare: async input => {
      const workspace = { ...input, state: 'ready', entries: [{ state: 'applied' }],
        readiness: [{ kind: 'required' as const, identity: 'namespace', state: 'complete' as const }] };
      const records = workspace[field];
      Object.defineProperty(records[0], 'state', { get() {
        records.push(field === 'entries' ? { state: 'pending' } as never
          : { kind: 'required', identity: 'starting-tree', state: 'pending' } as never);
        return field === 'entries' ? 'applied' : 'complete';
      } });
      return workspace;
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/main')],
    cwd: '/session', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it('keeps speculative process-array extensions outside engine preparation and revalidation', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const speculative = vi.fn(() => { throw new Error('nested playlist denied'); });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const validate = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    run, validate, release, prepare: async input => {
      for (const carrier of [input.cwd, input.originalArgv, ...input.originalArgv]) {
        Object.defineProperty(carrier, 'dependency', { enumerable: true, get: speculative });
      }
      return { ...input, state: 'ready', entries: [], readiness: [
        { kind: 'required', identity: 'namespace', state: 'complete' },
        { kind: 'speculative', identity: 'nested-playlist', state: 'failed' },
      ] };
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/main')],
    cwd: '/session', env: {}, fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(speculative).not.toHaveBeenCalled();
  expect(validate).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
it('rejects binder-installed argv accessors before they can change the admitted cwd', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const cleanup = vi.fn(async () => {});
  const accessor = vi.fn();
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    const arg = request.args[0];
    Object.defineProperty(request.args, '0', { get() {
      accessor();
      request.cwd = '/previous-job';
      return arg;
    } });
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
      bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
      job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')],
    cwd: '/current-job', env: {}, fs: { objects: { open: vi.fn() } },
    signal: new AbortController().signal })).rejects.toThrow('Media process binding changed');
  expect(accessor).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});
it('rejects an environment accessor that can replace argv after process comparison', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const cleanup = vi.fn(async () => {});
  const accessor = vi.fn();
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    Object.defineProperty(request.env, 'INPUT', { enumerable: true, get() {
      accessor();
      request.args[0][0] = 120;
      return 'relative/input';
    } });
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
      bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
      job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('relative/input')],
    cwd: '/work', env: { INPUT: 'relative/input' }, fs: { objects: { open: vi.fn() } },
    signal: new AbortController().signal })).rejects.toThrow('Media process binding changed');
  expect(accessor).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});
it('keeps overlapping jobs with identical cwd and playlist names on their own canonical sources', async () => {
  const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
  const sessions = ['one', 'two'].map((sessionId, index) => {
    const close = vi.fn(async () => {});
    const open = vi.fn(async () => ({ identity: {}, type: 'file' as const, close,
      read: async () => Uint8Array.of(index + 1) }));
    return { sessionId, fs: { objects: { open } }, close };
  });
  let entered = 0;
  let admitBoth!: () => void;
  const overlapping = new Promise<void>(resolve => { admitBoth = resolve; });
  const observed: number[] = [];
  const engine = createMediaEngine({ bind: async request => {
    const session = sessions.find(item => item.fs === request.fs)!;
    const credential = {};
    const invocation = { sessionId: session.sessionId, epoch: 'epoch', buildId: 'build',
      sourceAuthorityId: session.sessionId, bindingId: 'binding', materializationId: 'materialization',
      manifestId: 'manifest', manifestRevision: session.sessionId, directoryRevision: session.sessionId };
    const job = createJobBinding({ ...invocation, fs: request.fs, credential, maxCallbacks: 4, maxHandles: 1,
      prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [
        { kind: 'required', identity: 'installed-cwd', state: 'complete' },
        { kind: 'speculative', identity: 'lists/nested/part.ts', state: 'failed' },
      ] }),
      run: async input => {
        if (++entered === sessions.length) admitBoth();
        await overlapping;
        expect(input.invocation.cwd).toEqual(bytes('/work'));
        expect(input.invocation.originalArgv).toEqual([bytes('lists/input.m3u8'), bytes('/shared/input')]);
        const common = { sessionId: session.sessionId, epoch: 'epoch', jobId: input.jobId,
          fileId: 'playlist-child', stage: 'demuxer-open' };
        const access = (operation: object) => input.access(credential, { ...common, ...operation } as JobFileRequest);
        await expect(access({ sessionId: session.sessionId === 'one' ? 'two' : 'one',
          callbackId: 'foreign', operation: 'open', path: bytes('lists/nested/part.ts') }))
          .rejects.toThrow('Unauthorized');
        const opened = await access({ callbackId: 'open', operation: 'open', path: bytes('lists/nested/part.ts') }) as { handle: string };
        const content = await access({ callbackId: 'read', operation: 'read', handle: opened.handle,
          position: '0', maxBytes: 1 }) as Uint8Array;
        observed.push(content[0]);
        return { exitCode: 0 };
      },
    });
    return { invocation, job };
  } });
  await Promise.all(sessions.map(({ fs }) => engine.execute({ ...io(), command: 'ffmpeg',
    args: [new TextEncoder().encode('lists/input.m3u8'), new TextEncoder().encode('/shared/input')],
    cwd: '/work', env: {}, fs, signal: new AbortController().signal })));
  expect(observed.sort()).toEqual([1, 2]);
  for (const session of sessions) {
    expect(session.fs.objects.open).toHaveBeenCalledOnce();
    expect(session.fs.objects.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: 'read' }));
    expect(session.close).toHaveBeenCalledOnce();
  }
});
it.each(['cwd', 'args', 'argument-bytes', 'fs', 'signal'] as const)(
  'refuses a binder that changes admitted %s before process admission', async field => {
    const execute = vi.fn(async () => ({ exitCode: 0 }));
    const cleanup = vi.fn(async () => {});
    const engine = createMediaEngine({ bind: async request => {
      request.registerCleanup!(cleanup);
      if (field === 'argument-bytes') request.args[0][0] = 120;
      else Reflect.set(request, field, {
        cwd: '/previous-session', args: [new TextEncoder().encode('other/input')],
        fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal,
      }[field]);
      return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
        bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
        job: { execute } };
    } });
    await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('relative/input')],
      cwd: '/current-session', env: {}, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
      .rejects.toThrow('Media process binding changed');
    expect(execute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  },
);
it.each(['command', 'env'] as const)(
  'refuses a binder that replaces admitted %s and drains its acquisition', async field => {
    const execute = vi.fn(async () => ({ exitCode: 0 }));
    const cleanup = vi.fn(async () => {});
    const engine = createMediaEngine({ bind: async request => {
      request.registerCleanup!(cleanup);
      const replacements = { command: 'ffprobe', env: { PREVIOUS: 'job' } };
      Reflect.set(request, field, replacements[field]);
      return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
        bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
        job: { execute } };
    } });
    await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
      cwd: '/current-job', env: {}, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
      .rejects.toThrow('Media process binding changed');
    expect(execute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  },
);
it('refuses in-place changes to the admitted exported environment', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const cleanup = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    Reflect.set(request.env, 'MEDIA_INPUT', '/previous-job/input');
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
      bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
      job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/current-job',
    env: { MEDIA_INPUT: 'relative/input' }, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
    .rejects.toThrow('Media process binding changed');
  expect(execute).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});
it('refuses launch and releases the pinned workspace when readiness observation cancels the engine job', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a',
    bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const controller = new AbortController();
  const reason = new Error('starting-tree lease canceled');
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    prepare: async input => ({ ...input, state: 'ready', entries: [{ index: 0, state: 'applied' }],
      readiness: [{ kind: 'required', identity: 'starting-tree', get state() {
        controller.abort(reason);
        return 'complete' as const;
      } }] }), release, run,
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  let cleanup!: () => Promise<void>;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
    cwd: '/work', env: {}, fs, signal: controller.signal, registerCleanup(fn) { cleanup = fn; } });
  await expect(execution).rejects.toBe(reason);
  await expect(cleanup()).rejects.toBe(reason);
  expect(run).not.toHaveBeenCalled();
  expect(fs.objects.open).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it('admits the actual argument span before copying or observing later operands', async () => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  const oversized = new Uint8Array(1048577).fill(120);
  Object.defineProperty(oversized, 'length', { value: 0 });
  const later = vi.fn(() => { throw new Error('speculative operand acquisition'); });
  const args = [oversized, new Uint8Array()];
  Object.defineProperty(args, 1, { get: later });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args, cwd: '/work', env: {},
    fs: {}, signal: new AbortController().signal })).rejects.toThrow('Invalid native octets');
  expect(later).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();
});

it('checks argument octets without invoking caller-supplied search methods', async () => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  const arg = Uint8Array.of(0);
  const speculative = vi.fn(() => { throw new Error('speculative playlist access'); });
  Object.defineProperty(arg, 'includes', { get: speculative });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [arg], cwd: '/work', env: {},
    fs: {}, signal: new AbortController().signal })).rejects.toThrow('NUL in native argv');
  expect(speculative).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();
});

it('rejects a changed build binding before preparing the starting tree and drains engine cleanup', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a',
    bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const prepare = vi.fn();
  const run = vi.fn();
  const cleanup = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, prepare, run, maxCallbacks: 2, maxHandles: 1 });
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    await Promise.resolve();
    return { invocation: { ...invocation, buildId: 'replacement-build' }, job };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')],
    cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('Job authority mismatch');
  expect(prepare).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(fs.objects.open).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('rejects scratch policy substitution during binding before materialization or launch', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
    bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() }, capabilities: { snapshotRmdir: true } };
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({
    ...input, state: 'ready', entries: [],
    readiness: [{ kind: 'required' as const, identity: 'namespace', state: 'complete' as const }],
  }));
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const cleanup = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup?.(cleanup);
    fs.capabilities = { snapshotRmdir: false };
    const job = createJobBinding({ ...invocation, fs, credential: {}, prepare, run,
      maxCallbacks: 2, maxHandles: 1 });
    return { invocation, job };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {},
    fs, signal: new AbortController().signal })).rejects.toThrow('Job source capability mismatch');
  expect(prepare).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});
it.each(['replace', 'remove', 'duplicate'] as const)('rejects %s of required manifest entries through the engine without native admission', async change => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
    bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const entries = [{ index: 0, state: 'applied' }, { index: 1, state: 'applied' }];
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    prepare: async input => ({ ...input, state: 'ready', entries,
      readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }] }),
    validate: async () => {
      if (change === 'replace') entries[1].index = 2;
      if (change === 'remove') Reflect.deleteProperty(entries[1], 'index');
      if (change === 'duplicate') entries[1].index = 0;
    }, run, release,
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {},
    fs, signal: new AbortController().signal })).rejects.toThrow('materialization');
  expect(run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it('keeps issued canonical open authority when asynchronous binding replaces its method', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const credential = {};
  const close = vi.fn(async () => {});
  const open = vi.fn(async () => ({ identity: {}, type: 'file' as const, close }));
  const scratch = vi.fn(async () => { throw new Error('scratch authority'); });
  const fs = { objects: { open } };
  const engine = createMediaEngine({ bind: async () => {
    const job = createJobBinding({ ...invocation, fs, credential, maxCallbacks: 2, maxHandles: 1,
      prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'namespace', state: 'complete' }] }),
      run: async input => {
        await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, callbackId: 'open', fileId: 'nested-child', stage: 'playlist-open', operation: 'open', path: Array.from(new TextEncoder().encode('lists/nested/child')) });
        return { exitCode: 0 };
      },
    });
    await Promise.resolve();
    fs.objects.open = scratch;
    return { invocation, job };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/main')], cwd: '/current', env: {}, fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(open).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('keeps late playlist opens on the issued source facet across asynchronous engine binding', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const credential = {};
  const close = vi.fn(async () => {});
  const open = vi.fn(async () => ({ identity: {}, type: 'file' as const, close }));
  const scratch = vi.fn(async () => { throw new Error('scratch authority'); });
  const fs = { objects: { open } };
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({
    ...input, state: 'ready', entries: [{ state: 'applied' }],
    readiness: [{ kind: 'required' as const, identity: 'namespace', state: 'complete' as const },
      { kind: 'speculative' as const, identity: 'nested-playlist', state: 'failed' as const }],
  }));
  const run = vi.fn(async (input: import('@poe-code/remote-execution').BoundJobRun) => {
    expect(input.invocation.cwd).toEqual(Array.from(new TextEncoder().encode('/current')));
    expect(input.invocation.originalArgv).toEqual(['lists/main', '/current/lists/main'].map(name => Array.from(new TextEncoder().encode(name))));
    await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId,
      callbackId: 'child-open', fileId: 'nested-child', stage: 'playlist-open', operation: 'open',
      path: Array.from(new TextEncoder().encode('lists/nested/child')) });
    return { exitCode: 0 };
  });
  const engine = createMediaEngine({ bind: async () => {
    const job = createJobBinding({ ...invocation, fs, credential, prepare, run, maxCallbacks: 2, maxHandles: 1 });
    await Promise.resolve();
    fs.objects = { open: scratch };
    return { invocation, job };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: ['lists/main', '/current/lists/main'].map(name => new TextEncoder().encode(name)),
    cwd: '/current', env: {}, fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(open).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledOnce();
});
it.each(['entries', 'readiness'] as const)('rejects iterator-substituted required %s through the engine and releases the acquired workspace', async field => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async (_workspace: import('@poe-code/remote-execution').ReadyJobWorkspace,
    _acquired: import('@poe-code/remote-execution').ReadyJobWorkspace) => {});
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => {
    const records = field === 'entries' ? [{ state: 'pending', kind: 'required' }]
      : [{ identity: 'tree', state: 'pending', kind: 'required' }];
    Object.defineProperty(records, Symbol.iterator, { value: function* () {
      yield field === 'entries' ? { state: 'applied', kind: 'required' }
        : { identity: 'tree', state: 'complete', kind: 'required' };
    } });
    return { ...input, state: 'ready', entries: [{ state: 'applied' }],
      readiness: [{ kind: 'required' as const, identity: 'tree', state: 'complete' as const }],
      [field]: records };
  });
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, prepare, run, release });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][1]).toBe(await prepare.mock.results[0].value);
});
it('does not evaluate speculative request extensions while owning the process view', async () => {
  const speculative = vi.fn(() => { throw new Error('late dependency denied'); });
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const request = Object.defineProperty({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal }, 'lateDependency', { enumerable: true, get: speculative });
  const engine = createMediaEngine({ bind: async owned => {
    expect(Object.getOwnPropertyDescriptor(owned, 'lateDependency')?.get).toBe(speculative);
    return { invocation, job: { execute } };
  } });
  await expect(engine.execute(request)).resolves.toEqual({ exitCode: 0 });
  expect(speculative).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledOnce();
});
it('admits unchanged required identities after live readiness bookkeeping reorders them', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run,
    prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [
      { kind: 'required', identity: 'cwd', state: 'complete' },
      { kind: 'required', identity: 'namespace', state: 'complete' },
      { kind: 'speculative', identity: 'late/playlist', state: 'failed' },
    ] }),
    validate: async ({ workspace }) => { (workspace.readiness as unknown[]).reverse(); },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
  expect(fs.objects.open).not.toHaveBeenCalled();
});
it('preserves cancellation during bound execution and awaits its cleanup', async () => {
  const controller = new AbortController();
  const reason = new Error('caller canceled');
  const cleanup = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
      job: { execute: async () => { controller.abort(reason); return { exitCode: 0 }; } } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: controller.signal })).rejects.toBe(reason);
  expect(cleanup).toHaveBeenCalledOnce();
});
it('keeps late canonical writes replayable through the engine without rematerializing or rerunning', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const write = vi.fn(async () => 2);
  const open = vi.fn(async () => ({ identity: {}, type: 'file' as const, close: async () => {}, write }));
  const fs = { objects: { open } };
  const credential = {};
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({ ...input, state: 'ready', entries: [], readiness: [
    { kind: 'required' as const, identity: 'namespace', state: 'complete' as const },
    { kind: 'speculative' as const, identity: 'playlist-child', state: 'failed' as const },
  ] }));
  const run = vi.fn(async (input: import('@poe-code/remote-execution').BoundJobRun) => {
    expect(open).not.toHaveBeenCalled();
    const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'playlist-child', stage: 'native-output' };
    const opened = await input.access(credential, { ...common, callbackId: 'open', operation: 'open', access: 'write', path: Array.from(new TextEncoder().encode('nested/output')) }) as { handle: string };
    const request = { ...common, callbackId: 'write', operation: 'write' as const, handle: opened.handle, position: '0', bytes: Uint8Array.of(1, 255) };
    await input.access(credential, request);
    expect(await input.access(credential, { ...request, bytes: [1, 255] })).toBe(2);
    return { exitCode: 0 };
  });
  const job = createJobBinding({ ...invocation, fs, credential, prepare, run, maxCallbacks: 4, maxHandles: 1 });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  expect(await engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('playlist')], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).toEqual({ exitCode: 0 });
  expect(prepare).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledOnce();
});
it.each(['directoryRevision', 'entries', 'readiness'] as const)(
  'rejects the first incomplete workspace %s observation through the engine and drains its reservation', async field => {
    const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
    const fs = { objects: { open: vi.fn() } };
    const run = vi.fn(async () => ({ exitCode: 0 }));
    const release = vi.fn(async () => {});
    let observations = 0;
    const engine = createMediaEngine({ bind: async () => ({ invocation,
      job: createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run, release,
        prepare: async input => {
          const ready = { ...input, state: 'ready', entries: [{ state: 'applied' }], readiness: [{ kind: 'required' as const, identity: 'starting-tree', state: 'complete' as const }] };
          const complete = ready[field];
          const incomplete = field === 'directoryRevision' ? 'stale'
            : field === 'entries' ? [{ state: 'pending' }]
            : [{ kind: 'required', identity: 'starting-tree', state: 'pending' }];
          Object.defineProperty(ready, field, { get() { return ++observations === 1 ? incomplete : complete; } });
          return ready;
        },
      }),
    }) });
    await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow();
    expect(observations).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(fs.objects.open).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  },
);

it('rejects inherited argv slots before acquiring a job binding', async () => {
  const bind = vi.fn(async () => { throw new Error('binding acquired'); });
  const args = Array<Uint8Array>(1);
  Object.setPrototypeOf(args, Object.assign(Object.create(Array.prototype), { 0: new Uint8Array([97]) }));
  await expect(createMediaEngine({ bind }).execute({ ...io(), command: 'ffmpeg', args,
    cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal,
  })).rejects.toThrow('Incomplete native argv');
  expect(bind).not.toHaveBeenCalled();
});

it('uses only the admitted binding fields and the current job process view', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const previousDirectory = vi.fn(() => { throw new Error('previous job directory observed'); });
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  Object.defineProperty(invocation, 'cwd', { enumerable: true, get: previousDirectory });
  Object.defineProperty(invocation, 'scratchRoot', { enumerable: true, get: previousDirectory });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job: { execute } }) });
  await engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')],
    cwd: '/current-job', env: {}, fs: {}, signal: new AbortController().signal });
  expect(previousDirectory).not.toHaveBeenCalled();
  expect(execute.mock.calls[0][0]).toMatchObject({ sessionId: 's', materializationId: 'm',
    cwd: Array.from(new TextEncoder().encode('/current-job')),
    originalArgv: [Array.from(new TextEncoder().encode('nested/input'))],
  });
  expect(execute.mock.calls[0][0]).not.toHaveProperty('scratchRoot');
});
it('preserves indexed original argv when its array iterator supplies different names', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const args = [new TextEncoder().encode('relative/input'), new Uint8Array()];
  args[Symbol.iterator] = function* () { yield new TextEncoder().encode('/previous-job/input'); };
  const engine = createMediaEngine({ bind: async () => ({
    invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute },
  }) });
  await engine.execute({ ...io(), command: 'ffmpeg', args, cwd: '/current-job', env: {}, fs: {}, signal: new AbortController().signal });
  expect(execute.mock.calls[0][0].originalArgv).toEqual([Array.from(args[0]), []]);
});
it('rejects an incomplete argv slot before observing subsequent dependencies', async () => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  const args = [undefined, new Uint8Array()] as unknown as Uint8Array[];
  const later = vi.fn(() => { throw new Error('later dependency observed'); });
  Object.defineProperty(args, '1', { get: later });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args, cwd: '/work', env: {}, fs: {},
    signal: new AbortController().signal })).rejects.toThrow('Incomplete native argv');
  expect(later).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
});
it.each(['cwd', 'argv'] as const)('rejects oversized logical %s before acquiring a materialization', async field => {
  const bind = vi.fn(async () => { throw new Error('materialization acquired'); });
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: 'ffmpeg',
    args: field === 'argv' ? [new Uint8Array(1048577).fill(97)] : [],
    cwd: field === 'cwd' ? `/${'a'.repeat(1048576)}` : '/work',
    env: {}, fs: {}, signal: new AbortController().signal,
  })).rejects.toThrow('native octets');
  expect(bind).not.toHaveBeenCalled();
});
it('rejects competing classifications of required work through the engine and releases its acquired reservation', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn();
  const release = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => ({ invocation,
    job: createJobBinding({ ...invocation, fs: request.fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
      prepare: async input => ({ ...input, state: 'ready', entries: [{ state: 'applied' }], readiness: [
        { kind: 'required', identity: 'starting-tree', state: 'complete' },
        { kind: 'speculative', identity: 'starting-tree', state: 'failed' },
      ] }), release, run,
    }),
  }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('Incomplete required readiness');
  expect(run).not.toHaveBeenCalled();
  expect(fs.objects.open).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it.each(['', 'ffmpeg\0other', '\ud800', undefined])('rejects an incomplete command identity before acquiring its binding (%j)', async command => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: command as never, args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('command identity');
  expect(bind).not.toHaveBeenCalled();
});
it('admits identical relative names in concurrent session jobs with each original cwd and canonical source', async () => {
  const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
  const sources = ['one', 'two'].map(sessionId => ({ sessionId, objects: { open: vi.fn() } }));
  const observed: { sessionId: string; cwd: number[]; originalArgv: number[][] }[] = [];
  const engine = createMediaEngine({ bind: async request => {
    const sessionId = sources.find(source => source === request.fs)!.sessionId;
    const invocation = { sessionId, epoch: 'e', buildId: 'build', sourceAuthorityId: sessionId,
      bindingId: 'grant', materializationId: 'materialization', manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'directory' };
    const job = createJobBinding({ ...invocation, fs: request.fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
      prepare: async input => ({ ...input, state: 'ready', entries: [{ state: 'applied' }],
        readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }, { kind: 'speculative', identity: 'nested/playlist', state: 'failed' }] }),
      run: async input => {
        expect(input.readiness).toMatchObject([{ kind: 'required', state: 'complete' }, { kind: 'speculative', state: 'failed' }]);
        observed.push(input.invocation);
        return { exitCode: 0 };
      },
    });
    return { invocation, job };
  } });
  await Promise.all(sources.map(fs => engine.execute({ ...io(), command: 'ffmpeg',
    args: [new TextEncoder().encode('lists/input'), new TextEncoder().encode('/shared/input')],
    cwd: `/work/${fs.sessionId}`, env: {}, fs, signal: new AbortController().signal })));
  expect(observed).toEqual(expect.arrayContaining(sources.map(({ sessionId }) => expect.objectContaining({ sessionId,
    cwd: bytes(`/work/${sessionId}`), originalArgv: [bytes('lists/input'), bytes('/shared/input')],
  }))));
  expect(observed).toHaveLength(2);
  sources.forEach(source => expect(source.objects.open).not.toHaveBeenCalled());
});
it('drains the exact workspace reservation after engine execution without using mutable revision IDs', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  let acquired!: import('@poe-code/remote-execution').ReadyJobWorkspace;
  const reservations = new WeakSet<object>();
  const release = vi.fn(async (snapshot: typeof acquired, capability: typeof acquired) => {
    expect(snapshot.directoryRevision).toBe('d');
    expect(capability).toBe(acquired);
    expect(reservations.delete(capability)).toBe(true);
  });
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, release,
    prepare: async input => {
      acquired = { ...input, state: 'ready', entries: [{ state: 'applied' }], readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }] };
      reservations.add(acquired);
      return acquired;
    },
    run: async input => {
      expect(input.invocation.cwd).toEqual(Array.from(new TextEncoder().encode('/work')));
      acquired.directoryRevision = 'replacement';
      return { exitCode: 0 };
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(release).toHaveBeenCalledOnce();
  expect(reservations.has(acquired)).toBe(false);
});
it('does not admit a process when reading the acquired binding cancels its lease', async () => {
  const controller = new AbortController();
  const reason = new Error('binding lease cancelled');
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const close = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(close);
    return { invocation: {
      get sessionId() { controller.abort(reason); return 's'; },
      epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm',
      manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd',
    }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: controller.signal })).rejects.toBe(reason);
  expect(execute).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('rejects invalid starting-tree classification after validation and drains the engine binding', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run, release,
    prepare: async input => ({ ...input, state: 'ready', entries: [{ state: 'applied', kind: 'required' }], readiness: [
      { kind: 'metadata-only', identity: 'discovery', state: 'complete' },
      { kind: 'speculative', identity: 'late/playlist', state: 'failed' },
      { kind: 'required', identity: 'starting-tree', state: 'complete' },
    ] }),
    validate: async ({ workspace }) => {
      (workspace.entries as { state: string; kind?: string }[]).push({ state: 'pending', kind: 'optional' });
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  let cleanup!: () => Promise<void>;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')], cwd: '/work', env: {}, fs, signal: new AbortController().signal,
    registerCleanup(fn) { cleanup = fn; },
  });
  await expect(execution).rejects.toThrow('materialization');
  await expect(cleanup()).rejects.toThrow('materialization');
  expect(run).not.toHaveBeenCalled(); expect(fs.objects.open).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it.each(['success', 'cancel', 'failure'] as const)('drains binding-owned cleanup for a direct invocation on %s', async outcome => {
  const controller = new AbortController();
  const reason = new Error('binding stopped');
  let entered!: () => void; let finish!: () => void;
  const cleaning = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const close = vi.fn(async () => { entered(); await gate; });
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(close);
    if (outcome === 'failure') throw reason;
    if (outcome === 'cancel') controller.abort(reason);
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } };
  } });
  let settled = false;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([cleaning, execution.then(() => {}, () => {})]);
  expect(close).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  finish();
  if (outcome === 'success') await expect(execution).resolves.toEqual({ exitCode: 0 });
  else await expect(execution).rejects.toBe(reason);
  expect(close).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
});
it('shares one cleanup completion with the shell and preserves acquisition and cleanup failures', async () => {
  const failed = new Error('acquisition failed');
  const cleanupFailed = new Error('cleanup failed');
  const close = vi.fn(async () => { throw cleanupFailed; });
  const drained = vi.fn(async () => {});
  let barrier!: () => Promise<void>;
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(close);
    request.registerCleanup!(drained);
    throw failed;
  } });
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal,
    registerCleanup(cleanup) { barrier = cleanup; },
  });
  const failure = await execution.catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.cause).toBe(failed);
  expect(failure.errors).toEqual([failed, cleanupFailed]);
  await expect(barrier()).rejects.toBe(failure);
  await expect(barrier()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledOnce(); expect(drained).toHaveBeenCalledOnce();
});
it.each([undefined, null, 'scratch', 1])('rejects missing or invalid source capability %j before binding', async fs => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const bind = vi.fn(async () => ({ invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } }));
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: fs as never, signal: new AbortController().signal })).rejects.toThrow('source capability');
  expect(bind).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
});
it('rejects an incomplete host binding before handing it to the execution adapter', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async () => ({ invocation: {} as never, job: { execute } }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('binding');
  expect(execute).not.toHaveBeenCalled();
});
it.each([new Uint8Array(), new Set<Uint8Array>(), { length: 0 }])('rejects an incomplete argv carrier before binding', async args => {
  const bind = vi.fn();
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: args as never, cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('argv');
  expect(bind).not.toHaveBeenCalled();
});
it.each([[null], [3], [[97]], ['input']])('rejects non-byte argument %j before binding', async argument => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const bind = vi.fn(async () => ({ invocation: {} as never, job: { execute } }));
  const engine = createMediaEngine({ bind });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [argument] as never, cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('argv');
  expect(bind).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it('binds each invocation to its own scoped filesystem and literal cwd/argv before awaiting', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const bind = vi.fn(async () => ({ invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } }));
  const engine = createMediaEngine({ bind });
  const args = [Buffer.from('lists/input.m3u8'), new Uint8Array()];
  const fs = {}; const signal = new AbortController().signal;
  const request = { ...io(), command: 'ffmpeg', args, cwd: '/session-one', env: {}, fs, signal };
  const first = engine.execute(request); args[0].fill(1); await first;
  await engine.execute({ ...request, cwd: '/session-two', fs: {} });
  expect(execute.mock.calls[0][0].cwd).toEqual(Array.from(new TextEncoder().encode('/session-one')));
  expect(execute.mock.calls[0][0].originalArgv[0]).toEqual(Array.from(new TextEncoder().encode('lists/input.m3u8')));
  expect(execute.mock.calls[1][0].cwd).toEqual(Array.from(new TextEncoder().encode('/session-two')));
  expect(bind.mock.calls[0][0].fs).toBe(fs);
});

it('registers cleanup before binding and keeps its barrier pending through native cleanup', async () => {
  let release!: () => void; let cleanup: (() => Promise<void>) | undefined;
  const bind = vi.fn(async () => ({ invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute: async () => { await new Promise<void>(resolve => { release = resolve; }); return { exitCode: 0 }; } } }));
  const engine = createMediaEngine({ bind });
  let barrierDone = false;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal, registerCleanup(fn) { expect(bind).not.toHaveBeenCalled(); cleanup = fn; } });
  const barrier = cleanup!().then(() => { barrierDone = true; });
  await vi.waitFor(() => expect(release).toBeDefined(), { interval: 1 });
  expect(barrierDone).toBe(false); release(); await execution; await barrier;
});

it('rejects unrepresentable environment bindings before acquisition', async () => {
  const bind = vi.fn(); const engine = createMediaEngine({ bind });
  for (const env of [{ 'bad=name': 'x' }, { '': 'x' }, { NAME: 'bad\0value' }, { NAME: '\ud800' }]) {
    await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env, fs: {}, signal: new AbortController().signal })).rejects.toThrow('environment');
  }
  expect(bind).not.toHaveBeenCalled();
});

it('returns only native exit status while keeping canonical effects independently inspectable', async () => {
  const effects = { effects: [], native: { state: 'exited' as const, exitCode: 1 } };
  const inspect = vi.fn(() => effects);
  const engine = createMediaEngine({ bind: async () => ({ invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute: async () => ({ exitCode: 1 }), effects: { inspect } } }) });
  expect(await engine.execute({ ...io(), command: 'magick', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).toEqual({ exitCode: 1 });
  expect(inspect).not.toHaveBeenCalled();
  expect(inspect()).toBe(effects);
});

it('never acquires a binding when cleanup registration rejects', async () => {
  const bind = vi.fn(); const engine = createMediaEngine({ bind });
  const reason = new Error('registration failed');
  let barrier!: () => Promise<void>;
  const completion = engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal,
    registerCleanup(cleanup) { barrier = cleanup; throw reason; } });
  await expect(completion).rejects.toBe(reason);
  await expect(barrier()).rejects.toBe(reason);
  expect(bind).not.toHaveBeenCalled();
});

it('preserves cancellation during binding and never submits a job', async () => {
  const controller = new AbortController(); const execute = vi.fn();
  const engine = createMediaEngine({ bind: async () => {
    controller.abort(0);
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: controller.signal })).rejects.toBe(0);
  expect(execute).not.toHaveBeenCalled();
});

it('rejects preparation that substitutes a previous job directory and argv', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async request => {
    request.cwd = '/previous-job';
    request.args[0].fill(120);
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')], cwd: '/current-job', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('Media process binding changed');
  expect(execute).not.toHaveBeenCalled();
});

it('keeps the caller cancellation capability when preparation replaces its signal', async () => {
  const controller = new AbortController(); const execute = vi.fn();
  const engine = createMediaEngine({ bind: async request => {
    request.signal = new AbortController().signal;
    controller.abort(new Error('caller cancelled'));
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: controller.signal })).rejects.toThrow('caller cancelled');
  expect(execute).not.toHaveBeenCalled();
});

it('rejects incomplete argument slots before acquiring a workspace', async () => {
  const bind = vi.fn(); const engine = createMediaEngine({ bind });
  const args = Array<Uint8Array>(2); args[0] = new TextEncoder().encode('input');
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args, cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow();
  expect(bind).not.toHaveBeenCalled();
});

it('rejects binding that replaces the request filesystem', async () => {
  const fs = {}; const replacement = {}; const execute = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async request => {
    request.fs = replacement;
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('Media process binding changed');
  expect(execute).not.toHaveBeenCalled();
});

it('admits its own source and rejects a previous job source despite matching wire identities', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const prepare = vi.fn(async input => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }));
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, prepare, run });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  const request = { ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input')], cwd: '/work', env: {}, fs, signal: new AbortController().signal };
  expect(await engine.execute(request)).toEqual({ exitCode: 0 });
  await expect(engine.execute({ ...request, fs: { objects: { open: vi.fn() } } })).rejects.toThrow('source capability');
  expect(prepare).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledOnce();
});

it('runs concurrent sessions with identical relative names through their own ready source bindings', async () => {
  const observed: number[] = [];
  const requests = ['one', 'two'].map((sessionId, index) => {
    // Both sessions expose identical process names; only their source
    // capabilities distinguish the canonical inputs.
    const cwd = '/work';
    const open = vi.fn(async (path: { bytes(): Uint8Array }) => {
      expect(new TextDecoder().decode(path.bytes())).toBe(`${cwd}/lists/input`);
      return { identity: {}, type: 'file' as const, read: async () => Uint8Array.of(index), close: async () => {} };
    });
    return { ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/input'), new TextEncoder().encode(`${cwd}/lists/input`)], cwd, env: {}, fs: { objects: { open } }, signal: new AbortController().signal, sessionId };
  });
  const engine = createMediaEngine<typeof requests[number]>({ bind: async request => {
    const invocation = { sessionId: request.sessionId, epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
    const credential = {};
    const job = createJobBinding({ ...invocation, credential, fs: request.fs, maxCallbacks: 4, maxHandles: 2,
      prepare: async input => ({ ...input, state: 'ready', entries: [
        { state: 'applied', kind: 'required' },
        { state: 'failed', kind: 'speculative' },
      ], readiness: [
        { kind: 'metadata-only', identity: 'discovery', state: 'complete' },
        { kind: 'speculative', identity: 'optional-playlist-child', state: 'failed' },
        { kind: 'required', identity: 'starting-tree', state: 'complete' },
      ] }),
      run: async input => {
        expect(input.invocation.originalArgv).toEqual(request.args.map(arg => Array.from(arg)));
        const common = { sessionId: request.sessionId, epoch: 'e', jobId: input.jobId, fileId: 'input', stage: 'native-open' };
        const opened = await input.access(credential, { ...common, callbackId: 'open', operation: 'open', path: Array.from(request.args[0]) }) as { handle: string };
        const bytes = await input.access(credential, { ...common, callbackId: 'read', operation: 'read', handle: opened.handle, position: '0', maxBytes: 1 }) as Uint8Array;
        observed.push(bytes[0]);
        return { exitCode: 0 };
      },
    });
    return { invocation, job };
  } });
  await Promise.all(requests.map(request => engine.execute(request)));
  expect(observed.sort()).toEqual([0, 1]);
  for (const request of requests) expect(request.fs.objects.open).toHaveBeenCalledOnce();
});

it('releases canceled materialization through the engine cleanup barrier without starting a process', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const controller = new AbortController();
  const reason = new Error('canceled during materialization');
  let entered!: () => void; let finish!: () => void;
  const preparing = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run, release,
    prepare: async input => {
      entered(); await gate;
      return { ...input, state: 'ready', entries: [{ state: 'applied' }], readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }], privateCapability: () => {} };
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  let cleanup!: () => Promise<void>;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')], cwd: '/current-job', env: {}, fs, signal: controller.signal,
    registerCleanup(fn) { cleanup = fn; },
  });
  const rejected = expect(execution).rejects.toBe(reason);
  await preparing;
  controller.abort(reason);
  const retired = expect(cleanup()).rejects.toBe(reason);
  expect(release).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  finish(); await rejected; await retired;
  expect(release).toHaveBeenCalledOnce();
  expect(release.mock.calls[0][0]).toMatchObject({ ...invocation, cwd: Array.from(new TextEncoder().encode('/current-job')) });
  expect(run).not.toHaveBeenCalled(); expect(fs.objects.open).not.toHaveBeenCalled();
});


it('awaits live starting-tree revalidation through engine cleanup and preserves access refusal', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const denied = Object.assign(new Error('cwd denied'), { code: 'EACCES' });
  let entered!: () => void; let finish!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const release = vi.fn(async () => {});
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run, release,
    prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [
      { kind: 'metadata-only', identity: 'operand-discovery', state: 'complete' },
      { kind: 'speculative', identity: 'playlist/optional-child', state: 'failed' },
      { kind: 'required', identity: 'cwd', state: 'complete' },
    ], privateCapability: () => {} }),
    validate: async ({ invocation: input, workspace }) => {
      expect(input.cwd).toEqual(Array.from(new TextEncoder().encode('/logical-job')));
      expect(workspace.readiness).toHaveLength(3);
      entered(); await gate; throw denied;
    },
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  let cleanup!: () => Promise<void>;
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('nested/input')], cwd: '/logical-job', env: {}, fs, signal: new AbortController().signal,
    registerCleanup(fn) { cleanup = fn; },
  });
  const refused = expect(execution).rejects.toBe(denied);
  await validating;
  const barrier = expect(cleanup()).rejects.toBe(denied);
  expect(run).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  finish(); await refused; await barrier;
  expect(run).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
});


it('pins its trusted binder while each job supplies its own literal directory', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const bind = vi.fn(async () => ({ invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' }, job: { execute } }));
  const options = { bind }; const engine = createMediaEngine(options);
  const replacement = vi.fn(async () => { throw new Error('replaced binding authority'); });
  options.bind = replacement;
  await engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/first-job', env: {}, fs: {}, signal: new AbortController().signal });
  await engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/second-job', env: {}, fs: {}, signal: new AbortController().signal });
  expect(replacement).not.toHaveBeenCalled(); expect(bind).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls.map(([input]) => new TextDecoder().decode(Uint8Array.from(input.cwd)))).toEqual(['/first-job', '/second-job']);
});


it('keeps engine admission bound to one observed session identity', async () => {
  const fs = { objects: { open: vi.fn() } };
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  let observations = 0;
  Object.defineProperty(invocation, 'sessionId', { enumerable: true, get() {
    return ++observations === 1 ? 's' : 'other-session';
  } });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async () => ({ invocation,
    job: createJobBinding({ sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
      prepare: async input => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }] }), run,
    }),
  }) });
  await engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('relative/input')], cwd: '/current-session', env: {}, fs, signal: new AbortController().signal });
  expect(observations).toBe(1);
  expect(run.mock.calls[0][0].invocation).toMatchObject({ sessionId: 's', cwd: Array.from(new TextEncoder().encode('/current-session')) });
});

it('pins the acquired executor before observing the public invocation binding', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const scratch = vi.fn(async () => ({ exitCode: 99 }));
  const job = { execute };
  const engine = createMediaEngine({ bind: async () => ({ job, invocation: {
    get sessionId() { job.execute = scratch; return 's'; },
    epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd',
  } }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/current-job', env: {}, fs: {}, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(execute).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});


it('rejects aggregate argv overflow before observing later dependencies or binding', async () => {
  const bind = vi.fn();
  const later = vi.fn(() => { throw new Error('later dependency observed'); });
  const args = [new Uint8Array(524288).fill(97), new Uint8Array(524288).fill(98), new Uint8Array()];
  Object.defineProperty(args, '2', { get: later });
  await expect(createMediaEngine({ bind }).execute({ ...io(), command: 'ffmpeg', args,
    cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal }))
    .rejects.toThrow('Native argv limit');
  expect(later).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();
});


it.each([undefined, null, NaN, Infinity, -1, 1.5, 256])('rejects unqualified bound completion %j after owned cleanup', async exitCode => {
  const close = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(close);
    return { invocation: { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
      job: { execute: async () => ({ exitCode: exitCode as number }) } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs: {}, signal: new AbortController().signal })).rejects.toThrow('Invalid native exit status');
  expect(close).toHaveBeenCalledOnce();
});


it('keeps private scratch getters outside engine startup and live revalidation', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const scratch = vi.fn(() => { throw new Error('scratch authority observed'); });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const validate = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async () => ({ invocation: Object.defineProperty({ ...invocation }, 'scratchRoot', { enumerable: true, get: scratch }),
    job: createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1, run, validate, release,
      prepare: async input => {
        const workspace = { ...input, state: 'ready', entries: [],
          readiness: [{ kind: 'required' as const, identity: 'namespace', state: 'complete' as const },
            { kind: 'speculative' as const, identity: 'late-playlist-child', state: 'failed' as const }] };
        Object.defineProperty(workspace, 'scratchRoot', { enumerable: true, get: scratch });
        return workspace;
      },
    }),
  }) });
  expect(await engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('lists/main')],
    cwd: '/session', env: {}, fs, signal: new AbortController().signal })).toEqual({ exitCode: 0 });
  expect(scratch).not.toHaveBeenCalled();
  expect(validate).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});


it('admits the same complete indexed starting tree after concurrent entry observation reordering', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a',
    bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const entries = [{ index: 0, state: 'applied' }, { index: 1, state: 'applied' }];
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const job = createJobBinding({ ...invocation, fs, credential: {}, maxCallbacks: 2, maxHandles: 1,
    prepare: async input => ({ ...input, state: 'ready', entries,
      readiness: [{ kind: 'required', identity: 'starting-tree', state: 'complete' }] }),
    validate: async () => { entries.reverse(); }, run,
  });
  const engine = createMediaEngine({ bind: async () => ({ invocation, job }) });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {},
    fs, signal: new AbortController().signal })).resolves.toEqual({ exitCode: 0 });
  expect(run).toHaveBeenCalledOnce();
});

it.each(['facet', 'open', 'rename', 'stat'] as const)('rejects replacement of canonical %s before the asynchronous binder issues its job', async replacement => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const open = vi.fn();
  const rename = vi.fn();
  const fs = { objects: { open, rename }, stat: vi.fn() };
  const scratch = vi.fn();
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required' as const, identity: 'cwd', state: 'complete' as const }] }));
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const close = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(close);
    await Promise.resolve();
    if (replacement === 'facet') fs.objects = { open: scratch, rename: scratch };
    if (replacement === 'open') fs.objects.open = scratch;
    if (replacement === 'rename') fs.objects.rename = scratch;
    if (replacement === 'stat') fs.stat = scratch;
    return { invocation, job: createJobBinding({ ...invocation, fs: request.fs, credential: {}, maxCallbacks: 2, maxHandles: 1, prepare, run }) };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs, signal: new AbortController().signal })).rejects.toThrow('source capability');
  expect(prepare).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(scratch).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('retains source admission synchronously when the caller replaces the facet before binding starts', async () => {
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' };
  const fs = { objects: { open: vi.fn() } };
  const prepare = vi.fn(async (input: import('@poe-code/remote-execution').NativeInvocation) => ({ ...input, state: 'ready', entries: [], readiness: [{ kind: 'required' as const, identity: 'cwd', state: 'complete' as const }] }));
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const engine = createMediaEngine({ bind: async request => ({ invocation,
    job: createJobBinding({ ...invocation, fs: request.fs, credential: {}, maxCallbacks: 2, maxHandles: 1, prepare, run }),
  }) });
  const execution = engine.execute({ ...io(), command: 'ffmpeg', args: [], cwd: '/work', env: {}, fs, signal: new AbortController().signal });
  fs.objects = { open: vi.fn() };
  await expect(execution).rejects.toThrow('source capability');
  expect(prepare).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it.each(['command', 'env'] as const)('refuses process changes while reading the acquired %s binding', async field => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const cleanup = vi.fn(async () => {});
  const engine = createMediaEngine({ bind: async request => {
    request.registerCleanup!(cleanup);
    return { invocation: {
      get sessionId() {
        if (field === 'command') request.command = 'ffprobe';
        else Reflect.set(request.env, 'INPUT', '/other-session/input');
        return 's';
      },
      epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g',
      materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd',
    }, job: { execute } };
  } });
  await expect(engine.execute({ ...io(), command: 'ffmpeg', args: [new TextEncoder().encode('input')],
    cwd: '/work', env: {}, fs: { objects: { open: vi.fn() } }, signal: new AbortController().signal }))
    .rejects.toThrow('Media process binding changed');
  expect(execute).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledOnce();
});
