import { expect, it, vi } from 'vitest';
import { JobEffectsError } from '@poe-code/remote-execution';
import { createCanonicalMediaFilesystem } from './filesystem.js';
import { Volume } from 'memfs';

it('exposes guarded retained range resume through the canonical adapter after native failure', async () => {
  const identity = {}; const credential = {}; let version = 0;
  const bytes = Uint8Array.of(1, 2);
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47], originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 4, maxHandles: 1, maxIoBytes: 1,
    fs: { objects: { async open() { return { identity, type: 'file' as const, async close() {},
      async write(position, value) { bytes.set(value, Number(position)); version++; return value.length; } }; } } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput() { return { identity, async freshness() {
      const observed = version;
      return { identity, version: String(observed), async assertCurrent() { if (version !== observed) throw new Error('Canonical content changed'); } };
    }, async stat() { return { type: 'file', size: 2n }; },
    async read(position, count) { return bytes.slice(Number(position), Number(position) + count); }, async close() {} }; },
    async run(input) {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native' };
      const opened = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: [47, 97], access: 'write' }) as { handle: string };
      await input.access(credential, { ...common, callbackId: '2', operation: 'write', handle: opened.handle, position: '0', bytes: [255] });
      expect(bytes).toEqual(Uint8Array.of(255, 2));
      return { exitCode: 1 };
    },
  });
  try {
    await adapter.job.execute(invocation, new AbortController().signal);
    const object = adapter.effects.inspect().outputs[0];
    const guard = await adapter.effects.freshness(object);
    const reader = adapter.effects.download(object, 0n, 2n, undefined, guard).getReader();
    expect((await reader.read()).value).toEqual(Uint8Array.of(255));
    await reader.cancel(); reader.releaseLock();
    expect(new Uint8Array(await new Response(adapter.effects.download(object, 1n, 2n, undefined, guard)).arrayBuffer())).toEqual(Uint8Array.of(2));
    version++; bytes[1] = 7;
    await expect(new Response(adapter.effects.download(object, 1n, 2n, undefined, guard)).arrayBuffer()).rejects.toThrow('Canonical content changed');
    await expect(new Response(adapter.effects.download(object, 2n, 2n, undefined, guard)).arrayBuffer()).rejects.toThrow('Canonical content changed');
    expect(adapter.effects.inspect().native).toEqual({ state: 'exited', exitCode: 1 });
    const replayIdentity = {}; const applied: string[] = [];
    const first = await adapter.effects.reconstruct({ identity: replayIdentity, async apply() { throw new Error('EROFS'); } });
    expect(first).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', cursor: { nextSequence: 1 } } });
    const resumed = await adapter.effects.reconstruct({ identity: replayIdentity, async apply(effect) { applied.push(effect.operation); } }, first.transfer.cursor);
    expect(resumed.transfer).toMatchObject({ state: 'complete', cursor: { nextSequence: 2 } });
    expect(applied).toEqual(['write']);
  } finally { await adapter.effects.close(); }
});

it.each([0, 1, 3])('retrieves %i canonical files alongside binary stream output after native error', async count => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const reads = new Map<object | symbol, number>();
  const names = ['passlog-0.log', 'segment-000.ts', 'intermediate.png'].slice(0, count);
  // The driver owns the binary channel independently of filesystem callbacks.
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
  const binary = new Response(stream).arrayBuffer();
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 8, maxHandles: 3,
    fs: { objects: { async open() { throw new Error('No inputs'); }, async create(path) {
      const name = new TextDecoder().decode(path.bytes());
      const fd = volume.openSync(name, 'w+'); const identity = {};
      reads.set(identity, volume.openSync(name, 'r'));
      return { identity, type: 'file' as const, creation: 'created' as const,
        async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async close() { volume.closeSync(fd); } };
    } } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput(object) {
      const fd = reads.get(object.identity)!;
      return { identity: object.identity, async stat() { return { type: 'file', size: volume.fstatSync(fd, { bigint: true }).size }; },
        async read(position, length) { const value = new Uint8Array(length); return value.slice(0, volume.readSync(fd, value, 0, length, Number(position))); },
        async close() { volume.closeSync(fd); } };
    },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      output.enqueue(Uint8Array.of(255, 0));
      for (const name of names) {
        const opened = await access({ operation: 'create', path: bytes(name), access: 'write' }) as { handle: string };
        await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [0, 255] });
        expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([0, 255]));
        output.enqueue(Uint8Array.of(1));
      }
      output.close();
      return { exitCode: 1 };
    },
  });
  try {
    expect(await adapter.job.execute(invocation, new AbortController().signal)).toEqual({ exitCode: 1 });
    expect(new Uint8Array(await binary)).toEqual(Uint8Array.of(255, 0, ...names.map(() => 1)));
    const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
      const fd = volume.openSync('/download/' + new TextDecoder().decode(path), 'w+');
      return { async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    } });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
    expect(result.manifest.outputs).toHaveLength(count);
    expect(result.manifest.effects.filter(effect => effect.operation === 'write')).toEqual(names.map((_, index) => expect.objectContaining({ sequence: index * 2 + 1, bytes: [0, 255], count: 2 })));
    expect(volume.readdirSync('/download')).toEqual([...names, 'prior'].sort());
    for (const name of names) expect(volume.readFileSync('/download/' + name)).toEqual(Buffer.from([0, 255]));
    if (count === 3) for (const code of ['EDQUOT', 'EROFS']) {
      const root = '/' + code;
      volume.mkdirSync(root);
      const failure = new Error(code);
      const partial = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
        const name = new TextDecoder().decode(path);
        if (name === names[1] && code === 'EROFS') throw failure;
        const fd = volume.openSync(root + '/' + name, 'w+');
        return { async write(position, value) {
          if (name === names[1] && position > 0n) throw failure;
          return volume.writeSync(fd, value, 0, name === names[1] ? 1 : value.length, Number(position));
        }, async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
      } });
      expect(partial).toMatchObject({ manifest: result.manifest, native: { state: 'exited', exitCode: 1 },
        transfer: { state: 'failed', error: failure } });
      expect(partial.transfer.cursor.completed).toEqual(new Set([names[0]]));
      expect(volume.readFileSync(root + '/' + names[0])).toEqual(Buffer.from([0, 255]));
      if (code === 'EDQUOT') {
        expect(partial.transfer.cursor.offsets.get(names[1])).toBe(1n);
        expect(volume.readFileSync(root + '/' + names[1])).toEqual(Buffer.from([0]));
      } else expect(volume.existsSync(root + '/' + names[1])).toBe(false);
      expect(volume.existsSync(root + '/' + names[2])).toBe(false);
      for (const name of names) expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([0, 255]));
    }
    if (count) {
      const open = vi.fn(); const mkdir = vi.fn();
      const elsewhere = await adapter.effects.retrieve(invocation.cwd, { open, mkdir }, result.transfer.cursor);
      expect(elsewhere).toMatchObject({ manifest: result.manifest, native: result.native,
        transfer: { state: 'failed', error: expect.objectContaining({ message: expect.stringContaining('destination') }) } });
      expect(open).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
      for (const name of names) expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([0, 255]));
    }
  } finally { await adapter.effects.close(); }
});

it('preserves live canonical effects and retrieves available files after an earlier output retention failure', async () => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const descriptors = new Map<object | symbol, number>();
  let retains = 0;
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 6, maxHandles: 2,
    fs: { objects: { async open() { throw new Error('No inputs'); }, async create(path) {
      const fd = volume.openSync(new TextDecoder().decode(path.bytes()), 'w+');
      const identity = {};
      descriptors.set(identity, fd);
      return { identity, type: 'file' as const, creation: 'created' as const,
        async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async close() { volume.closeSync(fd); } };
    } } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput(object) {
      if (++retains === 1) throw new Error('retention quota');
      // Fork the read retain before execution closes its write descriptor.
      const fd = volume.openSync('/work/segment-000.ts', 'r');
      expect(descriptors.has(object.identity)).toBe(true);
      return { identity: object.identity, async stat() { return { type: 'file', size: volume.fstatSync(fd, { bigint: true }).size }; },
        async read(position, length) { const value = new Uint8Array(length); return value.slice(0, volume.readSync(fd, value, 0, length, Number(position))); },
        async close() { volume.closeSync(fd); } };
    },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      for (const name of ['passlog-0.log', 'segment-000.ts']) {
        const opened = await access({ operation: 'create', path: bytes(name), access: 'write' }) as { handle: string };
        await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [0, 255] });
        expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([0, 255]));
      }
      return { exitCode: 1 };
    },
  });
  try {
    await adapter.job.execute(invocation, new AbortController().signal);
    expect(adapter.effects.inspectTree(invocation.cwd)).toMatchObject({
      files: [expect.objectContaining({ relativePath: bytes('segment-000.ts') })],
      unavailablePaths: [{ path: bytes('/work/passlog-0.log'), relativePath: bytes('passlog-0.log') }],
    });
    const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
      const fd = volume.openSync('/download/' + new TextDecoder().decode(path), 'w+');
      return { async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    } });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
    expect(result.transfer.cursor.completed).toEqual(new Set(['segment-000.ts']));
    expect(volume.readFileSync('/download/segment-000.ts')).toEqual(Buffer.from([0, 255]));
    expect(volume.readFileSync('/work/passlog-0.log')).toEqual(Buffer.from([0, 255]));
    expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  } finally { await adapter.effects.close(); }
});

it('retrieves an existing file renamed before its first write without including untouched inputs', async () => {
  const volume = Volume.fromJSON({ '/work/image': 'old', '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const reads = new Map<object | symbol, number>();
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 8, maxHandles: 2,
    fs: { objects: {
      async open(path) {
        const name = new TextDecoder().decode(path.bytes());
        const identity = {}; const fd = volume.openSync(name, 'r+');
        reads.set(identity, volume.openSync(name, 'r'));
        return { identity, type: 'file' as const,
          async write(position: bigint, value: Uint8Array) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
          async close() { volume.closeSync(fd); } };
      },
      async rename(source, destination) {
        volume.renameSync(new TextDecoder().decode(source.bytes()), new TextDecoder().decode(destination.bytes()));
        return { moved: true };
      },
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput(object) {
      const fd = reads.get(object.identity)!;
      return { async stat() { return { type: 'file', size: volume.fstatSync(fd, { bigint: true }).size }; },
        async read(position, length) { const value = new Uint8Array(length); return value.slice(0, volume.readSync(fd, value, 0, length, Number(position))); },
        async close() { volume.closeSync(fd); } };
    },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      await access({ operation: 'open', path: bytes('prior'), access: 'write' });
      const opened = await access({ operation: 'open', path: bytes('image'), access: 'write' }) as { handle: string };
      await access({ operation: 'rename', path: bytes('image'), destination: bytes('renamed') });
      await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [0, 255, 1] });
      return { exitCode: 1 };
    },
  });
  try {
    await adapter.job.execute(invocation, new AbortController().signal);
    const tree = adapter.effects.inspectTree(invocation.cwd);
    expect(tree.files).toEqual([{ path: bytes('/work/renamed'), relativePath: bytes('renamed'), object: tree.retainedIdentities[0] }]);
    expect(tree.retainedIdentities).toHaveLength(1);
    const untouched = tree.manifest.effects.find(effect => effect.operation === 'open' && effect.path?.join(',') === bytes('/work/prior').join(','))!.object!;
    await expect(adapter.effects.stat(untouched)).rejects.toThrow('Not an invocation output');
    const prior = adapter.effects.download(untouched, 0n, 1n).getReader();
    await expect(prior.read()).rejects.toThrow('Not an invocation output');
    prior.releaseLock();
    const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
      const fd = volume.openSync('/download/' + new TextDecoder().decode(path), 'w+');
      return { async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
    } });
    expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
    expect(volume.readFileSync('/download/renamed')).toEqual(Buffer.from([0, 255, 1]));
    expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
    expect(volume.existsSync('/download/image')).toBe(false);
  } finally { await adapter.effects.close(); }
});

it('keeps live outputs and retrieves independent files after an unqualified rename and later native failure', async () => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const credential = {}; const failure = new Error('later native failure');
  const reads = new Map<object | symbol, number>();
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 6, maxHandles: 2,
    fs: { objects: { async open() { throw new Error('No inputs'); }, async create(path) {
      const name = new TextDecoder().decode(path.bytes());
      const fd = volume.openSync(name, 'w+'); const identity = {};
      reads.set(identity, volume.openSync(name, 'r'));
      return { identity, type: 'file' as const, creation: 'created' as const,
        async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
        async close() { volume.closeSync(fd); } };
    }, async rename(source, destination) {
      volume.renameSync(new TextDecoder().decode(source.bytes()), new TextDecoder().decode(destination.bytes()));
    } } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput(object) {
      const fd = reads.get(object.identity)!;
      return { async stat() { return { type: 'file', size: volume.fstatSync(fd, { bigint: true }).size }; },
        async read(position, length) { const value = new Uint8Array(length); return value.slice(0, volume.readSync(fd, value, 0, length, Number(position))); },
        async close() { volume.closeSync(fd); } };
    },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      for (const name of ['safe', 'moved']) {
        const opened = await access({ operation: 'create', path: bytes(name), access: 'write' }) as { handle: string };
        await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [0, 255] });
        expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([0, 255]));
      }
      await access({ operation: 'rename', path: bytes('moved'), destination: bytes('renamed') });
      throw failure;
    },
  });
  await expect(adapter.job.execute(invocation, new AbortController().signal)).rejects.toMatchObject({ cause: failure });
  expect(adapter.effects.inspectTree(invocation.cwd)).toMatchObject({ unresolvedEffects: ['4'], files: [expect.objectContaining({ relativePath: bytes('safe') })] });
  const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
    const name = '/download/' + new TextDecoder().decode(path);
    return { async write(_position, value) { volume.writeFileSync(name, value); return value.length; }, async truncate() {}, async close() {} };
  } });
  expect(result).toMatchObject({ native: { state: 'failed', error: failure.message }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.completed).toEqual(new Set(['safe']));
  expect(volume.readFileSync('/work/renamed')).toEqual(Buffer.from([0, 255]));
  expect(volume.readFileSync('/download/safe')).toEqual(Buffer.from([0, 255]));
  expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  expect(volume.existsSync('/download/renamed')).toBe(false);
  await adapter.effects.close();
});

it('locates a retained output at a freshly opened alias after its original name was removed', async () => {
  const credential = {}; const identity = {}; const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const volume = Volume.fromJSON({ '/work/image': '', '/download/prior': 'unrelated' });
  volume.linkSync('/work/image', '/work/alias');
  const retained = volume.openSync('/work/image', 'r');
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 8, maxHandles: 2,
    fs: { objects: {
      async open(path) {
        const fd = volume.openSync(new TextDecoder().decode(path.bytes()), 'r+');
        return { identity, type: 'file' as const,
          async write(position: bigint, value: Uint8Array) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
          async close() { volume.closeSync(fd); } };
      }, async unlink(path) { volume.unlinkSync(new TextDecoder().decode(path.bytes())); },
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput() { return {
      async stat() { return { type: 'file', size: volume.fstatSync(retained, { bigint: true }).size }; },
      async read(position, length) { const value = new Uint8Array(length); return value.slice(0, volume.readSync(retained, value, 0, length, Number(position))); },
      async close() { volume.closeSync(retained); },
    }; },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      const opened = await access({ operation: 'open', path: bytes('image'), access: 'write' }) as { handle: string };
      await access({ operation: 'write', handle: opened.handle, position: '0', bytes: [0, 255] });
      await access({ operation: 'unlink', path: bytes('image') });
      await access({ operation: 'open', path: bytes('alias'), access: 'read' });
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const tree = adapter.effects.inspectTree(invocation.cwd);
  expect(tree.files).toEqual([{ path: bytes('/work/alias'), relativePath: bytes('alias'), object: tree.retainedIdentities[0] }]);
  const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
    const fd = volume.openSync('/download/' + new TextDecoder().decode(path), 'w+');
    return { async write(position, value) { return volume.writeSync(fd, value, 0, value.length, Number(position)); },
      async truncate(size) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } });
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'complete' } });
  expect(volume.readFileSync('/download/alias')).toEqual(Buffer.from([0, 255]));
  expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it.each(['created', 'truncated'] as const)('does not reconstruct a delayed %s acquisition at an unlinked name', async creation => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', ...(creation === 'truncated' ? { '/work/out': 'old' } : {}) });
  const acquired = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47, 119, 111, 114, 107], originalArgv: [] };
  let retained = -1;
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 4, maxHandles: 1,
    fs: { objects: {
      async open() { throw new Error('No input opens'); },
      async create() {
        const fd = volume.openSync('/work/out', 'w+');
        retained = volume.openSync('/work/out', 'r');
        acquired.resolve(); await finish.promise;
        return { identity: {}, type: 'file' as const, creation, async close() { volume.closeSync(fd); } };
      },
      async unlink() { volume.unlinkSync('/work/out'); },
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput() {
      return { async stat() { return { type: 'file', size: 0n }; }, async read() { return new Uint8Array(); }, async close() { volume.closeSync(retained); } };
    },
    async run(input) {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native', path: [111, 117, 116] };
      const opening = input.access(credential, { ...common, callbackId: 'create', operation: 'create', access: 'write' });
      await acquired.promise;
      await input.access(credential, { ...common, callbackId: 'unlink', operation: 'unlink' });
      finish.resolve(); await opening;
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const tree = adapter.effects.inspectTree(invocation.cwd);
  expect(tree.files).toEqual([]);
  expect(tree.unlocatedIdentities).toEqual(tree.retainedIdentities);
  const reader = adapter.effects.download(tree.retainedIdentities[0], 0n, 0n).getReader();
  expect((await reader.read()).done).toBe(true);
  reader.releaseLock();
  const open = vi.fn(async () => { throw new Error('Never resurrect an unlinked output'); });
  expect(await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, open })).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
  expect(open).not.toHaveBeenCalled();
  expect(volume.existsSync('/work/out')).toBe(false);
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it('exposes partial output directories through the canonical adapter when native symlink output cannot be copied', async () => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const credential = {};
  const bytes = (path: string) => Array.from(new TextEncoder().encode(path));
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: bytes('/work'), originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 4, maxHandles: 1,
    fs: { objects: { async open() { throw new Error('No file opens'); } },
      async mkdir(path) { volume.mkdirSync(path); }, async symlink(target, path) { volume.symlinkSync(target, path); } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput() { throw new Error('No regular files'); },
    async run(input) {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native' };
      await input.access(credential, { ...common, callbackId: '1', operation: 'mkdir', path: bytes('generated') });
      await input.access(credential, { ...common, callbackId: '2', operation: 'symlink', path: bytes('alias'), target: bytes('prior') });
      expect(volume.readlinkSync('/work/alias')).toBe('prior');
      expect(volume.statSync('/work/generated').isDirectory()).toBe(true);
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  expect(adapter.effects.inspectTree(invocation.cwd).unavailablePaths).toEqual([{ path: bytes('/work/alias'), relativePath: bytes('alias') }]);
  const result = await adapter.effects.retrieve(invocation.cwd, {
    async mkdir(path) { volume.mkdirSync('/download/' + new TextDecoder().decode(path)); },
    async open() { throw new Error('Never copy the symlink target'); },
  });
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed' } });
  expect(result.transfer.cursor.directories).toEqual(new Set(['generated']));
  expect(volume.statSync('/download/generated').isDirectory()).toBe(true);
  expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it.each(['created', 'truncated'] as const)('reports a live canonical %s output whose returned capability cannot be retained', async creation => {
  const volume = Volume.fromJSON({ '/work/out': 'old', '/work/prior': 'unrelated' });
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: Array.from(new TextEncoder().encode('/work')), originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 2, maxHandles: 1, maxIoBytes: 2,
    fs: { objects: { async open() { throw new Error('No input opens'); }, async create(path) {
      volume.writeFileSync(new TextDecoder().decode(path.bytes()), '');
      return { identity: {}, type: 'socket' as const, creation, async close() {} };
    } } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => { throw new Error('Rejected capability must not be retained'); },
    run: async input => {
      await expect(input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native', callbackId: '1', operation: 'create', path: Array.from(new TextEncoder().encode('out')), access: 'write' })).rejects.toMatchObject({ code: 'ENOTSUP' });
      expect(volume.readFileSync('/work/out')).toEqual(Buffer.alloc(0));
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  expect(adapter.effects.inspectTree(invocation.cwd)).toMatchObject({
    files: [], unavailablePaths: [{ path: Array.from(new TextEncoder().encode('/work/out')), relativePath: [111, 117, 116] }],
  });
  const open = vi.fn(async () => { throw new Error('Never reopen a rejected output pathname'); });
  expect(await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, open })).toMatchObject({
    native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', error: expect.any(Error) },
  });
  expect(open).not.toHaveBeenCalled();
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it('does not retrieve a retained output at a name replaced by an untracked native source', async () => {
  const volume = Volume.fromJSON({ '/work/result': 'old', '/work/input': 'new', '/work/prior': 'unrelated' });
  const credential = {}; const identity = {}; const fd = volume.openSync('/work/result', 'r+');
  const retained = volume.openSync('/work/result', 'r');
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47, 119, 111, 114, 107], originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 4,
    fs: { objects: {
      async open() { return { identity, type: 'file' as const, async write(position, bytes) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); }, async close() { volume.closeSync(fd); } }; },
      async rename(source, destination) { volume.renameSync(new TextDecoder().decode(source.bytes()), new TextDecoder().decode(destination.bytes())); return { moved: true }; },
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => ({ async stat() { return { type: 'file', size: 3n }; }, async read(position, length) {
      const bytes = new Uint8Array(length); return bytes.slice(0, volume.readSync(retained, bytes, 0, length, Number(position)));
    }, async close() { volume.closeSync(retained); } }),
    async run(input) {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native' };
      const opened = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: Array.from(new TextEncoder().encode('result')), access: 'write' }) as { handle: string };
      await input.access(credential, { ...common, callbackId: '2', operation: 'write', handle: opened.handle, position: '0', bytes: [255] });
      await input.access(credential, { ...common, callbackId: '3', operation: 'rename', path: Array.from(new TextEncoder().encode('input')), destination: Array.from(new TextEncoder().encode('result')) });
      await input.access(credential, { ...common, callbackId: '4', operation: 'write', handle: opened.handle, position: '1', bytes: [0] });
      expect(volume.readFileSync('/work/result', 'utf8')).toBe('new');
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const tree = adapter.effects.inspectTree(invocation.cwd);
  expect(tree.files).toEqual([]); expect(tree.detachedIdentities).toEqual(tree.retainedIdentities);
  const open = vi.fn(async () => { throw new Error('must not overwrite the replacement'); });
  expect((await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, open })).transfer.state).toBe('failed');
  expect(open).not.toHaveBeenCalled();
  const reader = adapter.effects.download(tree.retainedIdentities[0], 0n, 3n).getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(255, 0, 100)); await reader.cancel();
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it('keeps replacement and unlinked identities readable after live canonical writes and a later failure', async () => {
  const volume = Volume.fromJSON({ '/work/image': 'old', '/work/prior': 'unrelated' });
  const credential = {}; const retained = new Map<object | symbol, number>();
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: Array.from(new TextEncoder().encode('/work')), originalArgv: [] };
  function object(name: string, create: boolean) {
    const identity = {}; const fd = volume.openSync(name, create ? 'w+' : 'r+');
    retained.set(identity, volume.openSync(name, 'r'));
    return { identity, type: 'file' as const, ...(create ? { creation: 'created' as const } : {}),
      async write(position: bigint, bytes: Uint8Array) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); }, async close() { volume.closeSync(fd); } };
  }
  const failure = new Error('later encoder failure');
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 20, maxHandles: 4, maxIoBytes: 2,
    fs: { objects: {
      async open(path) { return object(new TextDecoder().decode(path.bytes()), false); },
      async create(path) { return { ...object(new TextDecoder().decode(path.bytes()), true), creation: 'created' as const }; },
      async rename(source, destination) { volume.renameSync(new TextDecoder().decode(source.bytes()), new TextDecoder().decode(destination.bytes())); return { moved: true }; },
      async unlink(path) { volume.unlinkSync(new TextDecoder().decode(path.bytes())); },
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async source => {
      const fd = retained.get(source.identity)!;
      return { async stat() { return { type: 'file', size: volume.fstatSync(fd, { bigint: true }).size }; },
        async read(position, length) { const bytes = new Uint8Array(length); return bytes.slice(0, volume.readSync(fd, bytes, 0, length, Number(position))); }, async close() { volume.closeSync(fd); } };
    },
    async run(input) {
      let sequence = 0;
      const access = (request: object) => input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native', callbackId: String(++sequence), ...request } as Parameters<typeof input.access>[1]);
      const old = await access({ operation: 'open', path: Array.from(new TextEncoder().encode('image')), access: 'write' }) as { handle: string };
      await access({ operation: 'write', handle: old.handle, position: '0', bytes: [1] });
      const replacement = await access({ operation: 'create', path: Array.from(new TextEncoder().encode('intermediate')), access: 'write' }) as { handle: string };
      await access({ operation: 'write', handle: replacement.handle, position: '0', bytes: [255, 0] });
      await access({ operation: 'rename', path: Array.from(new TextEncoder().encode('intermediate')), destination: Array.from(new TextEncoder().encode('image')) });
      expect(volume.readFileSync('/work/image')).toEqual(Buffer.from([255, 0]));
      await access({ operation: 'write', handle: old.handle, position: '1', bytes: [2] });
      expect(volume.readFileSync('/work/image')).toEqual(Buffer.from([255, 0]));
      await access({ operation: 'unlink', path: Array.from(new TextEncoder().encode('image')) });
      await access({ operation: 'write', handle: replacement.handle, position: '1', bytes: [7] });
      expect(volume.existsSync('/work/image')).toBe(false);
      throw failure;
    },
  });
  await expect(adapter.job.execute(invocation, new AbortController().signal)).rejects.toMatchObject({ cause: failure });
  const tree = adapter.effects.inspectTree(invocation.cwd);
  expect(tree.files).toEqual([]); expect(tree.detachedIdentities).toHaveLength(2);
  expect(tree.manifest.effects.map(effect => effect.operation)).toEqual(['open', 'write', 'created', 'write', 'rename', 'write', 'unlink', 'write']);
  const contents = [];
  for (const identity of tree.manifest.outputs) {
    const consumer = new AbortController();
    const reader = adapter.effects.download(identity, 1n, 2n, consumer.signal).getReader();
    contents.push((await reader.read()).value);
    const reason = new Error('Output consumer closed');
    const closed = expect(reader.closed).rejects.toBe(reason);
    consumer.abort(reason);
    await closed;
    reader.releaseLock();
    // Closing a retrieval consumer does not retire the canonical identity.
    const resumed = adapter.effects.download(identity, 1n, 2n).getReader();
    expect((await resumed.read()).value).toEqual(contents.at(-1));
    await resumed.cancel(); resumed.releaseLock();
  }
  expect(contents).toEqual([Uint8Array.of(2), Uint8Array.of(7)]);
  const open = vi.fn(async () => { throw new Error('Detached files have no surviving output pathname'); });
  expect((await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, open })).transfer.state).toBe('complete');
  expect(open).not.toHaveBeenCalled(); expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it.each([0, 1, 3, 6])('keeps binary descriptor output independent of %i canonical file outputs', async count => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated' });
  const credential = {}; const stream: number[] = []; const close = vi.fn(async () => {});
  const retains = new Map<object | symbol, { fd: number }>();
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47, 119, 111, 114, 107], originalArgv: [] };
  const names = ['passlog-0.log', 'segment-000.ts', 'intermediate.png', 'passlog-0.log.mbtree', 'segment-001.ts', 'out.m3u8'].slice(0, count);
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 24, maxHandles: 4, maxIoBytes: 10,
    fs: { objects: {
      async open() { throw new Error('No input opens'); },
      async create(path) {
        const name = new TextDecoder().decode(path.bytes()); const identity = {};
        const fd = volume.openSync(name, 'w+');
        // Fork the read descriptor at acquisition, before namespace changes.
        retains.set(identity, { fd: volume.openSync(name, 'r') });
        return { identity, type: 'file' as const, creation: 'created' as const,
          async close() { volume.closeSync(fd); },
          async write(position, bytes) { return volume.writeSync(fd, bytes, 0, bytes.length, Number(position)); },
        };
      },
    } },
    handles: { async acquire(fd) {
      expect(fd).toBe(1);
      return { identity: {}, close, async write(bytes) { stream.push(...bytes); return bytes.length; } };
    } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async object => {
      const retained = retains.get(object.identity)!;
      return { async stat() { return { type: 'file', size: volume.fstatSync(retained.fd, { bigint: true }).size }; },
        async read(position, length) { const bytes = new Uint8Array(length); const read = volume.readSync(retained.fd, bytes, 0, length, Number(position)); return bytes.slice(0, read); },
        async close() { volume.closeSync(retained.fd); },
      };
    },
    run: async input => {
      let sequence = 0;
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'native', stage: 'native' };
      const stdout = await input.access(credential, { ...common, callbackId: String(++sequence), operation: 'descriptor-acquire', fd: 1, rights: ['write'] }) as { handle: string };
      await input.access(credential, { ...common, callbackId: String(++sequence), operation: 'descriptor-write', handle: stdout.handle, bytes: Uint8Array.of(0, 255) });
      for (const name of names) {
        const file = await input.access(credential, { ...common, callbackId: String(++sequence), operation: 'create', path: Array.from(new TextEncoder().encode(name)), access: 'write' }) as { handle: string };
        await input.access(credential, { ...common, callbackId: String(++sequence), operation: 'write', handle: file.handle, position: '0', bytes: [255, 0] });
        await input.access(credential, { ...common, callbackId: String(++sequence), operation: 'close', handle: file.handle });
        expect(volume.readFileSync('/work/' + name)).toEqual(Buffer.from([255, 0]));
      }
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  expect(stream).toEqual([0, 255]); expect(close).toHaveBeenCalledOnce();
  expect(adapter.effects.inspect().outputs).toHaveLength(count);
  const tree = adapter.effects.inspectTree(invocation.cwd);
  expect(tree.files.map(file => new TextDecoder().decode(Uint8Array.from(file.relativePath)))).toEqual(names);
  expect(tree.retainedIdentities).toEqual(adapter.effects.inspect().outputs);
  expect(tree.manifest.native).toEqual({ state: 'exited', exitCode: 1 });
  const retrieved = new Map<string, number[]>();
  const result = await adapter.effects.retrieve(invocation.cwd, { async mkdir() {}, async open(path) {
    const bytes: number[] = []; retrieved.set(new TextDecoder().decode(path), bytes);
    return { async write(_position, value) { bytes.push(...value); return value.length; }, async truncate() {}, async close() {} };
  } });
  expect(result.native).toEqual({ state: 'exited', exitCode: 1 }); expect(result.transfer.state).toBe('complete');
  expect(result.manifest).toEqual(adapter.effects.inspect());
  expect(retrieved).toEqual(new Map(names.map(name => [name, [255, 0]])));
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it('records only settled generated directory removals before a later native error', async () => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated' });
  const credential = {}; const failure = new Error('later encoder failure');
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47, 119, 111, 114, 107], originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation,
    fs: { objects: { open: async () => { throw new Error('No file opens'); } },
      mkdir: async path => { volume.mkdirSync(path); },
      rmdir: async (path: string) => { volume.rmdirSync(path); },
    },
    credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 100,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => { throw new Error('No file retains'); },
    run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'hls', stage: 'native' };
      const path = Array.from(new TextEncoder().encode('segments'));
      await input.access(credential, { ...common, callbackId: '1', operation: 'mkdir', path });
      expect(volume.existsSync('/work/segments')).toBe(true);
      await input.access(credential, { ...common, callbackId: '2', operation: 'rmdir', path });
      expect(volume.existsSync('/work/segments')).toBe(false);
      await expect(input.access(credential, { ...common, callbackId: '3', operation: 'rmdir', path })).rejects.toMatchObject({ code: 'ENOENT' });
      throw failure;
    },
  });
  const error = await adapter.job.execute(invocation, new AbortController().signal).catch(cause => cause);
  expect(error).toBeInstanceOf(JobEffectsError);
  expect(error.cause).toBe(failure);
  expect(error.effects.effects.map((effect: { operation: string }) => effect.operation)).toEqual(['mkdir', 'rmdir']);
  const mkdir = vi.fn(async () => {});
  expect((await adapter.effects.retrieve(invocation.cwd, { mkdir, async open() { throw new Error('No outputs'); } })).transfer.state).toBe('complete');
  expect(mkdir).not.toHaveBeenCalled();
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});

it('retains metadata-only output from a read-only handle after native failure', async () => {
  const identity = {}; const close = vi.fn(async () => {}); let mode = 0o644;
  const credential = {}; const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47], originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, fs: { objects: { open: async () => ({ identity, type: 'file' as const, close: async () => {}, metadata: async (changes: { mode?: number }) => { mode = changes.mode!; } }) } }, credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => ({ stat: async () => ({ type: 'file', size: 1n, mode }), read: async () => Uint8Array.of(255), close }),
    run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'image', stage: 'native' };
      const opened = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: [47, 97], access: 'read' }) as { handle: string };
      await input.access(credential, { ...common, callbackId: '2', operation: 'metadata', handle: opened.handle, changes: { mode: 0o600 } });
      expect(mode).toBe(0o600);
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const manifest = adapter.effects.inspect();
  expect(manifest.outputs).toEqual([manifest.effects[0].object]);
  const result = await adapter.effects.retrieve([47], { async mkdir() {}, async open(path, metadata) {
    expect(path).toEqual(Uint8Array.of(97)); expect(metadata.mode).toBe(0o600);
    return { async write(_position, bytes) { expect(bytes).toEqual(Uint8Array.of(255)); return bytes.length; }, async truncate() {}, async close() {} };
  } });
  expect(result.transfer.state).toBe('complete'); expect(result.native).toEqual({ state: 'exited', exitCode: 1 });
  await adapter.effects.close(); expect(close).toHaveBeenCalledOnce();
});

it('retains an output linked from a read-only native handle after native closure', async () => {
  const identity = {}; const bytes = Uint8Array.of(0, 255); const outputClose = vi.fn(async () => {});
  const credential = {}; const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47], originalArgv: [] };
  const source = { identity, type: 'file' as const, close: async () => {}, link: async () => {} };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, fs: { objects: { open: async () => source } }, credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => ({ stat: async () => ({ type: 'file', size: 2n }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close: outputClose }),
    run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'input', stage: 'native' };
      const opened = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: [47, 97], access: 'read' }) as { handle: string };
      await input.access(credential, { ...common, callbackId: '2', operation: 'link', handle: opened.handle, destination: [47, 98] });
      // Native tools can revisit an input after generating a linked output.
      // The read observation must not make the untouched input an output.
      await input.access(credential, { ...common, callbackId: '3', operation: 'open', path: [47, 97], access: 'read' });
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const manifest = adapter.effects.inspect();
  expect(manifest.outputs).toEqual([manifest.effects[0].object]);
  expect(adapter.effects.inspectTree([47]).files).toEqual([
    { path: [47, 98], relativePath: [98], object: manifest.effects[0].object },
  ]);
  const written: number[] = [];
  const result = await adapter.effects.retrieve([47], {
    async mkdir() {}, async open(path) {
      expect(path).toEqual(Uint8Array.of(98));
      return { async write(_position, bytes) { written.push(...bytes); return bytes.length; }, async truncate() {}, async close() {} };
    },
  });
  expect(result.transfer.state).toBe('complete'); expect(written).toEqual([0, 255]);
  expect(result.native).toEqual({ state: 'exited', exitCode: 1 });
  await adapter.effects.close(); expect(outputClose).toHaveBeenCalledOnce();
});

it.each(['failed', 'cancelled'] as const)('retains settled append effects after a later native %s outcome', async state => {
  let bytes = Uint8Array.of(1); const identity = {}; const abort = new AbortController();
  const failure = new Error('later encoder failed'); const nativeClose = vi.fn(async () => {}); const outputClose = vi.fn(async () => {});
  const source = { identity, type: 'file' as const, close: nativeClose, append: async (value: Uint8Array) => { bytes = Uint8Array.of(...bytes, value[0]); return 1; } };
  const credential = {}; const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47], originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, fs: { objects: { open: async () => source } }, credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async () => ({ stat: async () => ({ type: 'file', size: BigInt(bytes.length) }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close: outputClose }),
    run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'passlog', stage: 'native' };
      const opened = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: [47, 97], access: 'write' }) as { handle: string };
      expect(await input.access(credential, { ...common, callbackId: '2', operation: 'append', handle: opened.handle, bytes: [255, 0] })).toBe(1);
      expect(bytes).toEqual(Uint8Array.of(1, 255));
      if (state === 'cancelled') abort.abort(failure);
      throw failure;
    },
  });
  const error = await adapter.job.execute(invocation, abort.signal).catch(cause => cause);
  expect(error).toBeInstanceOf(JobEffectsError);
  expect(error.effects.native).toEqual({ state, error: failure.message });
  expect(error.effects.effects).toEqual([expect.objectContaining({ operation: 'open', sequence: 0 }), expect.objectContaining({ operation: 'append', sequence: 1, bytes: [255], count: 1, callbackId: '2', stage: 'native' })]);
  expect(nativeClose).toHaveBeenCalledOnce(); expect(outputClose).not.toHaveBeenCalled();
  const reader = adapter.effects.download(error.effects.effects[0].object, 0n, 2n).getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(1, 255));
  await reader.cancel(); await adapter.effects.close(); expect(outputClose).toHaveBeenCalledOnce();
});

it('uses live canonical effects and keeps retrieval ownership past native descriptor closure', async () => {
  const bytes = Uint8Array.of(1, 2); const identity = {}; let nativeClosed = false;
  const source = { identity, type: 'file' as const, close: async () => { nativeClosed = true; }, write: async (_p: bigint, value: Uint8Array) => { bytes.set(value); return value.length; } };
  const credential = {}; const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: [47], originalArgv: [] };
  const retrievalClosed = vi.fn(async () => {});
  const adapter = createCanonicalMediaFilesystem({ ...invocation, fs: { objects: { open: async () => source } }, credential, maxCallbacks: 10, maxHandles: 2, maxIoBytes: 2,
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    retainOutput: async object => { expect(object.identity).toBe(identity); return { stat: async () => ({ type: 'file', size: 2n }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close: retrievalClosed }; },
    run: async input => {
      const common = { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'output', stage: 'native' };
      const open = await input.access(credential, { ...common, callbackId: '1', operation: 'open', path: [47, 97], access: 'write' }) as { handle: string };
      await input.access(credential, { ...common, callbackId: '2', operation: 'write', handle: open.handle, position: '0', bytes: [255, 0] });
      expect(bytes).toEqual(Uint8Array.of(255, 0));
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  expect(nativeClosed).toBe(true); expect(retrievalClosed).not.toHaveBeenCalled();
  const object = adapter.effects.inspect().effects[0].object!;
  const reader = adapter.effects.download(object, 0n, 2n).getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(255, 0));
  await reader.cancel();
  const downloaded = Volume.fromJSON({ '/out/prior': 'unrelated' });
  const destination = { async mkdir() {}, open: vi.fn(async () => {
    const fd = downloaded.openSync('/out/a', 'w+');
    return { async write(position: bigint, value: Uint8Array) {
      const count = downloaded.writeSync(fd, value, 0, 1, Number(position));
      value.fill(42);
      return count;
    },
      async truncate(size: bigint) { downloaded.ftruncateSync(fd, Number(size)); }, async close() { downloaded.closeSync(fd); } };
  }) };
  const copied = await adapter.effects.retrieve([47], destination);
  expect(copied.transfer.state).toBe('complete');
  destination.open.mockClear();
  const resumed = await adapter.effects.retrieve([47], destination, copied.transfer.cursor);
  expect(resumed).toMatchObject({ native: { state: 'exited', exitCode: 1 }, transfer: { state: 'failed', path: 'a' } });
  expect(destination.open).not.toHaveBeenCalled();
  expect(downloaded.readFileSync('/out/a')).toEqual(Buffer.from([255, 0]));
  expect(downloaded.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close(); expect(retrievalClosed).toHaveBeenCalledOnce();
});

it('preserves native exit and the last generated directory receipt when retrieval closes', async () => {
  const volume = Volume.fromJSON({ '/work/prior': 'unrelated', '/download/prior': 'unrelated' });
  const credential = {};
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'b', sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd', cwd: Array.from(new TextEncoder().encode('/work')), originalArgv: [] };
  const adapter = createCanonicalMediaFilesystem({ ...invocation, credential, maxCallbacks: 4, maxHandles: 1,
    fs: { objects: { async open() { throw new Error('No file opens'); } }, async mkdir(path) { volume.mkdirSync(path); } },
    prepare: async () => ({ ...invocation, state: 'ready', entries: [], readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }] }),
    async retainOutput() { throw new Error('Directory-only invocation'); },
    async run(input) {
      await input.access(credential, { sessionId: 's', epoch: 'e', jobId: input.jobId, fileId: 'hls', stage: 'native', callbackId: '1', operation: 'mkdir', path: Array.from(new TextEncoder().encode('generated')) });
      expect(volume.statSync('/work/generated').isDirectory()).toBe(true);
      return { exitCode: 1 };
    },
  });
  await adapter.job.execute(invocation, new AbortController().signal);
  const abort = new AbortController(); const reason = new Error('consumer closed');
  const result = await adapter.effects.retrieve(invocation.cwd, {
    async mkdir(path) { volume.mkdirSync('/download/' + new TextDecoder().decode(path)); abort.abort(reason); },
    async open() { throw new Error('No output files'); },
  }, undefined, abort.signal);
  expect(result).toMatchObject({ native: { state: 'exited', exitCode: 1 },
    manifest: { outputs: [], effects: [{ operation: 'mkdir', sequence: 0, callbackId: '1' }] },
    transfer: { state: 'failed', error: reason } });
  expect(result.transfer.cursor.directories).toEqual(new Set(['generated']));
  expect(volume.statSync('/download/generated').isDirectory()).toBe(true);
  expect(volume.readFileSync('/work/prior', 'utf8')).toBe('unrelated');
  expect(volume.readFileSync('/download/prior', 'utf8')).toBe('unrelated');
  await adapter.effects.close();
});
