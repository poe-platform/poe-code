import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { Volume, createFsFromVolume } from 'memfs';
import { expect, it, vi } from 'vitest';
import { createExecutionServer, type UploadPrincipal, type MaterializationServerOptions } from './server.js';
import { createExecutionClient } from './materializations.js';
import { createUploadClient } from './uploads.js';
import type { DependencyManifest } from './protocol.js';

const b = (s: string) => Array.from(new TextEncoder().encode(s));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

it.each(['preparation', 'execution'] as const)('rejects a staged file hardlinked outside its isolated tree during %s', async phase => {
  const f = fixture(); const manifest = await f.manifest();
  await f.fs.writeFile('/canonical/shared-clip', 'original clip', { mode: 0o600 });
  const replace = async (path: string) => {
    await f.fs.unlink(path);
    await f.fs.link('/canonical/shared-clip', path);
  };
  const open = f.fs.open.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (phase === 'preparation' && args[1] === 'wx' && String(args[0]).endsWith('/clips/part one.mp4')) {
      const close = file.close.bind(file);
      file.close = async () => { await close(); await replace(String(args[0])); };
    }
    return file;
  });
  try {
    const result = await f.prepare(manifest);
    if (phase === 'preparation') {
      expect(result).toMatchObject({ state: 'partial', error: 'collision', failureCategory: 'integrity', cleanup: 'complete' });
      expect(await f.fs.readdir('/private')).toEqual(['.keep']);
    } else {
      expect(result.state).toBe('ready');
      const path = Object.keys(f.volume.toJSON()).find(path => path.endsWith('/clips/part one.mp4'))!;
      await replace(path);
      const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: manifest.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
      expect(job).toMatchObject({ state: 'failed', error: 'integrity', failure: { code: 'collision' } });
      expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity' });
    }
    expect(f.launches()).toBe(0);
    expect(String(await f.fs.readFile('/canonical/shared-clip'))).toBe('original clip');
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
  } finally { spy.mockRestore(); }
});

function fixture(invocationLimits: { maxArguments?: number; maxArgvBytes?: number; maxPathBytes?: number } = {}, issuedNamespace?: MaterializationServerOptions['namespace']) {
  const volume = Volume.fromJSON({ '/private/.keep': '', '/canonical/original': 'untouched' });
  volume.chmodSync('/private', 0o700);
  volume.chownSync('/private', process.getuid!(), process.getgid!());
  const memory = createFsFromVolume(volume);
  const fs = memory.promises;
  // Node mkdtemp creates mode 0700 owned by the caller; memfs defaults to 0777.
  const mkdtemp = fs.mkdtemp.bind(fs);
  fs.mkdtemp = async (...args) => {
    const path = await mkdtemp(...args);
    await fs.chmod(path, 0o700);
    await fs.chown(path, process.getuid!(), process.getgid!());
    return path;
  };
  const open = fs.open.bind(fs);
  // memfs uses Linux flags even when the server's Node fs runs on macOS.
  fs.open = (path, flags, mode) => open(path, typeof flags === 'number' && (flags & constants.O_NOFOLLOW)
    ? (flags & ~constants.O_NOFOLLOW) | memory.constants.O_NOFOLLOW : flags, mode);
  const blobs = new Map<string, Uint8Array>();
  let launches = 0;
  const principal: UploadPrincipal = { tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: Date.now() + 60000, sessionExpiresAt: Date.now() + 60000 };
  const authorize = vi.fn(async (_p: UploadPrincipal, m: DependencyManifest, binding: string) => binding === 'binding' && m.namespaceId === 'n' && m.sourceAuthorityId === 'a' && JSON.stringify(m.logicalRoot) === JSON.stringify(b('/work')) && m.entries.every(e => e.source.snapshotId === 'independent' || e.kind === 'output-intent'));
  const authenticate = vi.fn(async (_request: Request, _signal?: AbortSignal) => principal);
  const server = createExecutionServer({
    storage: {
      async append(id, offset, data) { const old = blobs.get(id) ?? new Uint8Array(); expect(old.length).toBe(Number(offset)); blobs.set(id, new Uint8Array([...old, ...data])); },
      async read(id, offset, count) { return (blobs.get(id) ?? new Uint8Array()).slice(Number(offset), Number(offset) + count); },
      async remove(id) { blobs.delete(id); },
    },
    authenticate,
    limits: { maxBlobBytes: 10000n, maxReservedBytes: 100000n, maxChunkBytes: 4096, maxConcurrent: 2, maxUploads: 100, maxChunks: 100 },
    materializations: {
      fs: fs as never, privateRoot: '/private', maxDocumentBytes: 100000, maxEntries: 100, maxPathBytes: 4096, maxTreeBytes: 100000n, maxRecords: 100,
      ...invocationLimits,
      authorize,
      namespace: issuedNamespace ?? {
        buildId: 'build',
        async execute({ physicalRoot, invocation }) {
          launches++;
          const cwd = new TextDecoder().decode(Uint8Array.from(invocation.cwd));
          const operand = new TextDecoder().decode(Uint8Array.from(invocation.originalArgv[1] ?? []));
          const listPath = `${physicalRoot}${cwd.slice(5)}/${operand}`;
          try {
            const data = String(await fs.readFile(listPath, 'utf8'));
            const line = data.split('\n').find(line => line.startsWith("file '"))!;
            const clip = line.slice(6, -1);
            // memfs normalizes dotdot before following directory links. Resolve
            // the reader directory first to model native directory traversal.
            const directory = await fs.realpath(listPath.slice(0, listPath.lastIndexOf('/')));
            const bytes = await fs.readFile(`${directory}/${clip}`);
            return { exitCode: 0, stdout: Array.from(bytes), stderr: [] };
          }
          catch { return { exitCode: 1, stdout: [], stderr: b('edit/lists/cut.ffconcat: No such file') }; }
        },
      },
    },
  });
  const fetch: typeof globalThis.fetch = async (url, init) => server.fetch(new Request(url, init));
  const opts = { baseUrl: 'https://example.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch, maxChunkBytes: 4096 };
  const uploads = createUploadClient(opts); const client = createExecutionClient(opts);
  async function manifest() {
    const m: DependencyManifest = { version: 1, sessionId: 's', epoch: 'e', namespaceId: 'n', revision: 'r1', logicalRoot: b('/work'), cwd: b('/work'), sourceAuthorityId: 'a', entries: [] };
    for (const [path, data] of Object.entries({ clips: null, 'clips/part one.mp4': 'original clip', edit: null, 'edit/lists': null, 'edit/lists/cut.ffconcat': "ffconcat version 1.0\nfile '../../clips/part one.mp4'\n", empty: null, filters: null, 'filters/look.txt': 'drawtext=fontfile=fonts/Test.ttf', fonts: null, 'fonts/Test.ttf': 'font', profiles: null, 'profiles/input.icc': 'profile' })) {
      const source = { authorityId: 'a', path: b(`/work/${path}`), freshness: 'immutable' as const, snapshotId: 'independent', observedVersion: null, retainedIdentity: null };
      if (data === null) m.entries.push({ kind: 'directory', path: path.split('/').map(b), source });
      else { const u = await uploads.beginUpload({ size: String(data.length), digest: hash(data) }); await uploads.uploadChunk(u.uploadId, '0', Uint8Array.from(b(data))); const blob = await uploads.commitUpload(u.uploadId); m.entries.push({ kind: 'file', path: path.split('/').map(b), source, blob: { blobId: blob.blobId, size: blob.size, sha256: blob.digest } }); }
    }
    return m;
  }
  async function prepare(m: DependencyManifest) { const saved = await client.putManifest(m); return client.materialize({ sessionId: 's', epoch: 'e', manifestId: saved.manifestId, manifestRevision: m.revision, bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'op' }); }
  return { volume, fs, blobs, client, server, manifest, prepare, authorize, authenticate, principal, launches: () => launches };
}

it('keeps private preparation on its issued staging root across asynchronous authorization', async () => {
  const f = fixture(); const manifest = await f.manifest();
  await f.fs.chmod('/canonical', 0o700);
  await f.fs.chown('/canonical', process.getuid!(), process.getgid!());
  f.authorize.mockImplementationOnce(async function (this: MaterializationServerOptions) {
    this.privateRoot = '/canonical';
    return true;
  });
  const result = await f.prepare(manifest);
  expect(result.state).toBe('ready');
  expect(await f.fs.readdir('/canonical')).toEqual(['original']);
  expect((await f.fs.readdir('/private')).filter(name => name !== '.keep')).toHaveLength(1);
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('stops empty-tree preparation when its session owner retires during authorization', async () => {
  const f = fixture(); const manifest = await f.manifest(); manifest.entries = [];
  const owner = new AbortController(); f.principal.sessionSignal = owner.signal;
  f.authorize.mockImplementationOnce(async () => { owner.abort(new Error('Session retired')); return true; });
  const result = await f.prepare(manifest);
  expect(result).toMatchObject({ state: 'failed', failureCategory: 'readiness' });
  expect(await f.fs.readdir('/private')).toEqual(['.keep']);
  expect(f.launches()).toBe(0);
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('stops native handoff on owner retirement without marking the tree corrupt', async () => {
  const f = fixture(); const manifest = await f.manifest(); const prepared = await f.prepare(manifest);
  const owner = new AbortController(); f.principal.sessionSignal = owner.signal;
  f.authorize.mockImplementationOnce(async () => { owner.abort(new Error('Session retired')); return true; });
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding',
    materializationId: prepared.operationId, manifestId: prepared.manifestId, manifestRevision: manifest.revision,
    directoryRevision: prepared.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.launches()).toBe(0);
  f.principal.sessionSignal = undefined;
  expect(await f.client.inspectMaterialization(prepared.operationId)).toEqual(prepared);
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('keeps immutable staging coupled to the issued native driver and build', async () => {
  const execute = vi.fn(async function () {
    expect(this).toBe(namespace);
    return { exitCode: 0, stdout: [], stderr: [] };
  });
  const namespace = { buildId: 'build', execute };
  const f = fixture({}, namespace);
  const manifest = await f.manifest();
  const m = await f.prepare(manifest);
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'replacement-build', sourceAuthorityId: 'a', bindingId: 'binding',
    materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: manifest.revision,
    directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('relative'), b('/work/relative')] };
  const scratch = vi.fn(async () => ({ exitCode: 99, stdout: [], stderr: [] }));
  namespace.buildId = 'replacement-build';
  namespace.execute = scratch;
  await expect(f.client.execute(invocation)).rejects.toMatchObject({ status: 409 });
  expect(execute).not.toHaveBeenCalled();
  expect(await f.client.execute({ ...invocation, buildId: 'build' })).toMatchObject({ state: 'exited', result: { exitCode: 0 } });
  expect(execute).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});

it.each([
  { field: 'expiresAt', value: NaN, status: 401 },
  { field: 'expiresAt', value: Infinity, status: 401 },
  { field: 'sessionExpiresAt', value: NaN, status: 410 },
  { field: 'sessionExpiresAt', value: Infinity, status: 410 },
  { field: 'tenantId', value: '', status: 401 },
  { field: 'principalId', value: '', status: 401 },
] as const)('rejects invalid authenticated $field=$value before tree admission', async ({ field, value, status }) => {
  const f = fixture(); const manifest = await f.manifest();
  const saved = await f.client.putManifest(manifest);
  const before = f.volume.toJSON();
  const principal = { ...f.principal };
  Object.assign(f.principal, { [field]: value });
  await expect(f.client.materialize({ sessionId: 's', epoch: 'e', manifestId: saved.manifestId,
    manifestRevision: saved.revision, bindingId: 'binding', expectedDirectoryRevision: null,
    operationKey: 'invalid-authority' })).rejects.toMatchObject({ status });
  await expect(f.client.listMaterializations()).rejects.toMatchObject({ status });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.volume.toJSON()).toEqual(before);
  expect(f.launches()).toBe(0);
  Object.assign(f.principal, principal);
  const result = await f.client.materialize({ sessionId: 's', epoch: 'e', manifestId: saved.manifestId,
    manifestRevision: saved.revision, bindingId: 'binding', expectedDirectoryRevision: null,
    operationKey: 'invalid-authority' });
  expect(result.state).toBe('ready');
  expect(await f.client.listMaterializations()).toEqual([result]);
});

it.each(['host', 'hook'] as const)('pins authenticated scope while materialization authorization mutates %s state', async mutation => {
  const f = fixture(); const manifest = await f.manifest();
  f.authorize.mockImplementationOnce(async principal => {
    await Promise.resolve();
    const borrowed = mutation === 'host' ? f.principal : principal;
    borrowed.sessionId = 'replacement-session';
    borrowed.epoch = 'replacement-epoch';
    return true;
  });
  const status = await f.prepare(manifest);
  expect(status.state).toBe('ready');
  f.principal.sessionId = 's'; f.principal.epoch = 'e';
  expect(await f.client.inspectMaterialization(status.operationId)).toEqual(status);
});

it.each([{ maxPathBytes: 64 }, { maxArguments: 2 }, { maxArgvBytes: 80 }])('admits literal argv with separate native allocation limits %j before launch', async limits => {
    const f = fixture(limits); const m = await f.manifest(); const result = await f.prepare(m);
    expect(result.state).toBe('ready');
    const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat'), b('x'.repeat(100))] };
    const before = f.volume.toJSON();
    if ('maxPathBytes' in limits) {
      const job = await f.client.execute(invocation);
      expect(job).toMatchObject({ state: 'exited', result: { exitCode: 0 } });
      expect(job.invocation.originalArgv).toEqual(invocation.originalArgv);
      expect(f.launches()).toBe(1);
    } else {
      await expect(f.client.execute(invocation)).rejects.toMatchObject({ status: 400 });
      expect(f.launches()).toBe(0);
    }
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(f.volume.toJSON()).toEqual(before);
});

it('reports host authorization outages as readiness failures before native launch', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const before = f.volume.toJSON();
  f.authorize.mockRejectedValueOnce(Object.assign(new Error('Authority broker unavailable'), { code: 'ECONNRESET' }));
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] };
  expect(await f.client.execute(invocation)).toMatchObject({ state: 'failed', error: 'readiness', failure: { code: 'ECONNRESET', message: 'Authority broker unavailable' } });
  expect(f.launches()).toBe(0);
  expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
  expect(f.volume.toJSON()).toEqual(before);
  expect(await f.client.execute(invocation)).toMatchObject({ state: 'exited', result: { exitCode: 0 } });
});

it('uploads, materializes exact hierarchy, inspects and binds native invocation entirely through APIs', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'symlink', path: [b('shortcut')], target: b('edit/lists/../../clips/part one.mp4'), source: { ...m.entries[0].source, path: b('/work/shortcut') } });
  const result = await f.prepare(m);
  expect(result.state).toBe('ready'); expect(result.logicalRoot).toEqual(b('/work'));
  expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
  expect(await f.client.listMaterializations()).toEqual([result]);
  const tree = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!.slice(0, -'/clips/part one.mp4'.length);
  expect(String(await f.fs.readFile(`${tree}/edit/lists/../../clips/part one.mp4`))).toBe('original clip');
  expect(String(await f.fs.readFile(`${tree}/shortcut`))).toBe('original clip');
  expect((await f.fs.stat(`${tree}/empty`)).isDirectory()).toBe(true);
  expect(String(await f.fs.readFile(`${tree}/filters/look.txt`))).toBe('drawtext=fontfile=fonts/Test.ttf');
  expect(String(await f.fs.readFile(`${tree}/fonts/Test.ttf`))).toBe('font');
  expect(String(await f.fs.readFile(`${tree}/profiles/input.icc`))).toBe('profile');
  expect(await f.client.inspectManifest(result.manifestId)).toEqual(m);
  expect(await f.fs.readdir('/canonical')).toEqual(['original']);
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] };
  const job = await f.client.execute(invocation); expect(job.result?.exitCode).toBe(0);
  expect(job.result?.stdout).toEqual(b('original clip'));
  expect(await f.client.inspectJob(job.jobId)).toEqual(job);
  const wrong = await f.client.execute({ ...invocation, cwd: b('/work/edit') }); expect(wrong.result?.exitCode).toBe(1); expect(wrong.state).toBe('exited');
  await expect(f.client.execute({ ...invocation, directoryRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
});

it('executes a concat operand through a relative directory symlink with native dotdot semantics', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'symlink', path: [b('z-list-directory')], target: b('edit/lists'), source: { ...m.entries[0].source, path: b('/work/z-list-directory') } });
  const result = await f.prepare(m);
  expect(result.state).toBe('ready');
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('z-list-directory/cut.ffconcat')] };
  const job = await f.client.execute(invocation);
  expect(job.result).toEqual({ exitCode: 0, stdout: b('original clip'), stderr: [] });
  expect(job.invocation.originalArgv).toEqual(invocation.originalArgv);
  const wrong = await f.client.execute({ ...invocation, cwd: b('/work/edit') });
  expect(wrong).toMatchObject({ state: 'exited', result: { exitCode: 1 } });
  expect(wrong.error).toBeUndefined();
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('keeps distinct uploaded resources with the same basename in their original directories', async () => {
  const f = fixture(); const m = await f.manifest();
  const font = m.entries.find(entry => entry.kind === 'file' && entry.path.map(part => Buffer.from(part).toString()).join('/') === 'fonts/Test.ttf')!;
  if (font.kind !== 'file') throw new Error('Expected original font fixture');
  m.entries.push({ ...font, path: [b('fonts'), b('part one.mp4')], source: { ...font.source, path: b('/work/fonts/part one.mp4') } });
  m.entries.sort((left, right) => Buffer.compare(
    Buffer.from(left.path.flatMap((part, index) => index ? [47, ...part] : part)),
    Buffer.from(right.path.flatMap((part, index) => index ? [47, ...part] : part))));
  const result = await f.prepare(m);
  expect(result.state).toBe('ready');
  expect(await f.client.inspectManifest(result.manifestId)).toEqual(m);
  const clip = Object.keys(f.volume.toJSON()).find(path => path.endsWith('/clips/part one.mp4'))!;
  const root = clip.slice(0, -'/clips/part one.mp4'.length);
  expect(String(await f.fs.readFile(`${root}/fonts/part one.mp4`))).toBe('font');
  expect(String(await f.fs.readFile(clip))).toBe('original clip');
  expect(await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] })).toMatchObject({ state: 'exited', result: { exitCode: 0, stdout: b('original clip') } });
  await expect(f.fs.lstat(`${root}/out`)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('detects an admitted symlink replaced while later files are being verified', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.unshift({ kind: 'symlink', path: [b('alias')], target: b('clips/part one.mp4'), source: { ...m.entries[0].source, path: b('/work/alias') } });
  const result = await f.prepare(m); expect(result.state).toBe('ready');
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const tree = path.slice(0, -'/clips/part one.mp4'.length);
  const open = f.fs.open.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (args[0] === path) {
      await f.fs.unlink(`${tree}/alias`);
      await f.fs.symlink('profiles/input.icc', `${tree}/alias`);
    }
    return file;
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
    expect(f.launches()).toBe(0);
    expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity', error: 'collision' });
  } finally { spy.mockRestore(); }
});

it('rejects invalid admission without physical effects and records missing blobs separately', async () => {
  const f = fixture(); const m = await f.manifest(); const before = f.volume.toJSON();
  const file = m.entries.find(e => e.kind === 'file')!; if (file.kind === 'file') file.blob.blobId = 'missing';
  const result = await f.prepare(m); expect(result).toMatchObject({ state: 'failed', error: 'missing-blob' });
  expect(f.volume.toJSON()).toEqual(before); expect(f.launches()).toBe(0);
  const invalid = { ...m, entries: [m.entries[0], m.entries[0]] };
  await expect(f.client.putManifest(invalid)).rejects.toBeInstanceOf(TypeError);
  const rejected = await f.server.fetch(new Request('https://example.test/v1/sessions/s/manifests', {
    method: 'POST', headers: { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'duplicate-entry' }, body: JSON.stringify(invalid),
  }));
  expect(rejected.status).toBe(400);
  expect(f.volume.toJSON()).toEqual(before);
});

it('rejects escaping links, mutable snapshots, metadata and identity promises before staging', async () => {
  for (const change of ['escape', 'live', 'metadata', 'identity']) {
    const f = fixture(); const m = await f.manifest(); const before = f.volume.toJSON();
    if (change === 'escape') m.entries.push({ kind: 'symlink', path: [b('z')], target: b('../canonical/original'), source: m.entries[0].source });
    if (change === 'live') m.entries[0].source = { ...m.entries[0].source, freshness: 'live', callbackGrantId: 'grant' };
    if (change === 'metadata') m.entries[0].metadata = { mtimeNs: '123' };
    if (change === 'identity') m.entries[0].source.retainedIdentity = 'identity';
    expect((await f.prepare(m)).state).toBe('failed'); expect(f.volume.toJSON()).toEqual(before);
  }
});

it('reports corrupt uploaded bytes and wrong lengths without exposing a ready partial tree', async () => {
  for (const value of ['corrupt bytes', 'short']) {
    const f = fixture(); const m = await f.manifest(); const storageId = [...f.blobs.keys()][0]; f.blobs.set(storageId, Uint8Array.from(b(value)));
    const result = await f.prepare(m);
    expect(result.state).toBe('partial'); expect(result.error).toBe(value === 'short' ? 'wrong-length' : 'wrong-hash');
    expect(result.entries[0].state).toBe('applied'); expect(result.entries[1].state).toBe('failed');
    expect(result.cleanup).toBe('complete'); expect(await f.fs.readdir('/private')).toEqual(['.keep']);
  }
});

it('detects staged integrity loss before native launch', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  await f.fs.writeFile(path, 'tampered');
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity' }); expect(f.launches()).toBe(0);
  expect((await f.client.inspectMaterialization(result.operationId)).state).toBe('failed');
});

it('registers output intent without a placeholder and refuses to synthesize its missing parent', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'output-intent', path: [b('result.mp4')], operations: ['create'], source: { ...m.entries[0].source, freshness: 'live', callbackGrantId: 'later', path: b('/work/result.mp4') } });
  const result = await f.prepare(m); expect(result.state).toBe('ready');
  expect(Object.keys(f.volume.toJSON()).some(p => p.endsWith('/result.mp4'))).toBe(false);
  const invalid = structuredClone(m); invalid.revision = 'r2'; invalid.entries[invalid.entries.length - 1].path = [b('missing-output'), b('result.mp4')];
  const before = f.volume.toJSON();
  await expect(f.client.putManifest(invalid)).rejects.toBeInstanceOf(TypeError);
  const rejected = await f.server.fetch(new Request('https://example.test/v1/sessions/s/manifests', {
    method: 'POST', headers: { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'missing-output-parent' }, body: JSON.stringify(invalid),
  }));
  expect(rejected.status).toBe(400);
  expect(f.volume.toJSON()).toEqual(before);
  expect(await f.fs.readdir('/canonical')).toEqual(['original']);
});

it('keeps a verified tree executable when a privately staged successor fails integrity', async () => {
  const f = fixture(); const m = await f.manifest(); const first = await f.prepare(m);
  const saved = await f.client.putManifest({ ...m, revision: 'successor' });
  const storageId = [...f.blobs.keys()][0]; const original = f.blobs.get(storageId)!;
  f.blobs.set(storageId, Uint8Array.from(b('short')));
  const failed = await f.client.materialize({ sessionId: 's', epoch: 'e', manifestId: saved.manifestId, manifestRevision: saved.revision, bindingId: 'binding', expectedDirectoryRevision: first.directoryRevision, operationKey: 'successor' });
  expect(failed).toMatchObject({ state: 'partial', failureCategory: 'integrity', cleanup: 'complete' });
  f.blobs.set(storageId, original);
  expect(await f.client.inspectMaterialization(first.operationId)).toEqual(first);
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: first.operationId, manifestId: first.manifestId, manifestRevision: first.manifestRevision, directoryRevision: first.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'exited', result: { exitCode: 0, stdout: b('original clip') } });
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('recovers identical operation keys and rejects stale revisions and unauthorized bindings', async () => {
  const f = fixture(); const m = await f.manifest(); const stored = await f.client.putManifest(m);
  const request = { sessionId: 's', epoch: 'e', manifestId: stored.manifestId, manifestRevision: m.revision, bindingId: 'binding', expectedDirectoryRevision: null, operationKey: 'first' };
  const first = await f.client.materialize(request); expect(await f.client.materialize(request)).toEqual(first);
  await expect(f.client.materialize({ ...request, bindingId: 'other' })).rejects.toMatchObject({ status: 409 });
  await expect(f.client.materialize({ ...request, operationKey: 'next' })).rejects.toMatchObject({ status: 409 });
  const denied = await f.client.materialize({ ...request, bindingId: 'other', expectedDirectoryRevision: first.directoryRevision, operationKey: 'denied' }); expect(denied).toMatchObject({ state: 'failed', error: 'unauthorized' });
});

it('requires existing privately owned staging and does not create missing parent directories', async () => {
  for (const missing of [false, true]) {
    const f = fixture(); const m = await f.manifest();
    if (missing) await f.fs.rm('/private', { recursive: true });
    else await f.fs.chmod('/private', 0o777);
    const before = f.volume.toJSON();
    expect((await f.prepare(m)).state).toBe('failed');
    expect(f.volume.toJSON()).toEqual(before);
  }
});

it('refuses replaced directory symlinks before reading their children', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const directory = path.slice(0, -'/part one.mp4'.length);
  await f.fs.rm(directory, { recursive: true }); await f.fs.symlink('/canonical', directory);
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity' }); expect(f.launches()).toBe(0);
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('rejects host filename aliases before applying a tree', async () => {
  const f = fixture(); const m = await f.manifest(); const source = m.entries[0].source;
  m.entries = [{ kind: 'directory', path: [b('Fonts')], source }, { kind: 'directory', path: [b('fonts')], source }];
  const before = f.volume.toJSON();
  expect(await f.prepare(m)).toMatchObject({ state: 'failed', error: 'collision' });
  expect(f.volume.toJSON()).toEqual(before);
});

it('distinguishes invalid declared size from invalid declared hash before staging', async () => {
  for (const field of ['size', 'sha256'] as const) {
    const f = fixture(); const m = await f.manifest(); const file = m.entries.find(e => e.kind === 'file')!;
    if (file.kind === 'file') file.blob[field] = field === 'size' ? '999' : '0'.repeat(64);
    const before = f.volume.toJSON();
    expect(await f.prepare(m)).toMatchObject({ state: 'failed', error: field === 'size' ? 'wrong-length' : 'wrong-hash' });
    expect(f.volume.toJSON()).toEqual(before);
  }
});

it('does not follow a final-component symlink swapped between lstat and open', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  await f.fs.writeFile('/canonical/same-bytes', 'original clip');
  const lstat = f.fs.lstat.bind(f.fs); let reads = 0;
  const spy = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => {
    const stat = await lstat(...args);
    if (args[0] === path && ++reads === 2) { await f.fs.unlink(path); await f.fs.symlink('/canonical/same-bytes', path); }
    return stat;
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'integrity' }); expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it('preserves UTF-8 BOM bytes inside path components rather than stripping them', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'directory', path: [b('\ufeffdirectory')], source: m.entries[0].source });
  const result = await f.prepare(m); expect(result.state).toBe('ready');
  const tree = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!.slice(0, -'/clips/part one.mp4'.length);
  expect(await f.fs.readdir(tree)).toContain('\ufeffdirectory');
});

it('reports an expired job admission as readiness, not a native command error', async () => {
  vi.useFakeTimers();
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const original = f.fs.lstat.bind(f.fs); const before = Date.now();
  const spy = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => { const stat = await original(...args); vi.setSystemTime(before + 120000); return stat; });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'readiness' }); expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); vi.useRealTimers(); }
});

it('cancels an incomplete control body at the session deadline', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); let canceled = false;
    const init = { method: 'POST', duplex: 'half', headers: { Authorization: 'Bearer token', 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'slow' }, body: new ReadableStream({ cancel() { canceled = true; } }) };
    const response = f.server.fetch(new Request('https://example.test/v1/sessions/s/manifests', init));
    await vi.advanceTimersByTimeAsync(60001);
    expect(canceled).toBe(true); expect((await response).status).toBe(410);
  } finally { vi.useRealTimers(); }
});

it('rejects superseded isolated trees and requires explicit job authority', async () => {
  const f = fixture(); const m = await f.manifest(); const first = await f.prepare(m);
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: first.operationId, manifestId: first.manifestId, manifestRevision: m.revision, directoryRevision: first.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat'), []] };
  for (const change of [{ sessionId: 'other' }, { buildId: 'other' }, { sourceAuthorityId: 'other' }, { bindingId: 'other' }]) {
    await expect(f.client.execute({ ...invocation, ...change })).rejects.toBeDefined();
  }
  expect(f.launches()).toBe(0);
  const saved = await f.client.putManifest({ ...m, revision: 'r2' });
  const current = await f.client.materialize({ sessionId: 's', epoch: 'e', manifestId: saved.manifestId, manifestRevision: 'r2', bindingId: 'binding', expectedDirectoryRevision: first.directoryRevision, operationKey: 'second' });
  await expect(f.client.execute(invocation)).rejects.toMatchObject({ status: 409 });
  expect(f.launches()).toBe(0);
  expect((await f.client.execute({ ...invocation, materializationId: current.operationId, manifestId: current.manifestId, manifestRevision: 'r2', directoryRevision: current.directoryRevision! })).result?.exitCode).toBe(0);
  expect(f.launches()).toBe(1);
});

it('rejects an ancestor swapped to a symlink even when it still names the same file object', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const directory = path.slice(0, -'/part one.mp4'.length);
  const open = f.fs.open.bind(f.fs); let swapped = false;
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    if (args[0] === path && !swapped) {
      swapped = true;
      await f.fs.rename(directory, '/canonical/relocated');
      await f.fs.symlink('/canonical/relocated', directory);
    }
    return open(...args);
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
    expect(f.launches()).toBe(0);
    expect(String(await f.fs.readFile('/canonical/relocated/part one.mp4'))).toBe('original clip');
  } finally { spy.mockRestore(); }
});

it('rejects a redirected ancestor before opening the staged file', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const directory = path.slice(0, -'/part one.mp4'.length);
  const lstat = f.fs.lstat.bind(f.fs); let probes = 0;
  const open = vi.spyOn(f.fs, 'open');
  const stat = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => {
    const value = await lstat(...args);
    if (args[0] === path && ++probes === 2) {
      await f.fs.rename(directory, '/canonical/relocated');
      await f.fs.symlink('/canonical/relocated', directory);
    }
    return value;
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
    expect(open.mock.calls.some(args => args[0] === path)).toBe(false);
    expect(f.launches()).toBe(0);
    expect(String(await f.fs.readFile('/canonical/relocated/part one.mp4'))).toBe('original clip');
  } finally { stat.mockRestore(); open.mockRestore(); }
});

it('binds a manifest retry key even when an existing revision supplies the receipt', async () => {
  const f = fixture(); const m = await f.manifest();
  await f.client.putManifest(m);
  const headers = { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'revision-retry' };
  const post = (document: DependencyManifest) => f.server.fetch(new Request('https://example.test/v1/sessions/s/manifests', { method: 'POST', headers, body: JSON.stringify(document) }));
  expect((await post(m)).status).toBe(200);
  expect((await post({ ...m, revision: 'different' })).status).toBe(409);
});

it('inspects preparation integrity separately from admission readiness failures', async () => {
  for (const corrupt of [false, true]) {
    const f = fixture(); const m = await f.manifest();
    if (corrupt) f.blobs.set([...f.blobs.keys()][0], Uint8Array.from(b('corrupt bytes')));
    else { const file = m.entries.find(e => e.kind === 'file')!; if (file.kind === 'file') file.blob.blobId = 'missing'; }
    const result = await f.prepare(m);
    expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ failureCategory: corrupt ? 'integrity' : 'readiness' });
  }
});

it('reports a symlink swap during preparation verification as integrity failure', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.unshift({ kind: 'symlink', path: [b('alias')], target: b('clips/part one.mp4'), source: { ...m.entries[0].source, path: b('/work/alias') } });
  const open = f.fs.open.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (typeof args[1] === 'number' && String(args[0]).endsWith('/clips/part one.mp4')) {
      const tree = String(args[0]).slice(0, -'/clips/part one.mp4'.length);
      await f.fs.unlink(`${tree}/alias`);
      await f.fs.symlink('profiles/input.icc', `${tree}/alias`);
    }
    return file;
  });
  try {
    const result = await f.prepare(m);
    expect(result).toMatchObject({ state: 'partial', error: 'collision', failureCategory: 'integrity', cleanup: 'complete' });
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(await f.fs.readdir('/private')).toEqual(['.keep']);
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it('does not erase a missing intermediate cwd component through lexical dotdot', async () => {
  const f = fixture(); const m = await f.manifest(); m.cwd = b('/work/not-present/../edit');
  const before = f.volume.toJSON();
  expect(await f.prepare(m)).toMatchObject({ state: 'failed' });
  expect(f.volume.toJSON()).toEqual(before);
});

it('retains dangling in-scope links and resolves cwd dotdot after directory links', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'symlink', path: [b('y-dangling')], target: b('missing/child'), source: m.entries[0].source });
  m.entries.push({ kind: 'symlink', path: [b('z-directory')], target: b('edit/lists'), source: m.entries[0].source });
  m.cwd = b('/work/z-directory/..');
  expect(await f.prepare(m)).toMatchObject({ state: 'ready', cwd: b('/work/z-directory/..') });
});

it('attributes a preflight missing blob to its file rather than an unapplied directory', async () => {
  const f = fixture(); const m = await f.manifest();
  const index = m.entries.findIndex(e => e.kind === 'file'); const file = m.entries[index];
  if (file.kind === 'file') file.blob.blobId = 'missing';
  const result = await f.prepare(m);
  expect(result.entries[index]).toMatchObject({ state: 'failed', error: 'missing-blob' });
  expect(result.entries[0].state).toBe('pending');
});

it('rejects a pathname replaced while its previously opened file is being verified', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const open = f.fs.open.bind(f.fs); let swapped = false;
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (args[0] === path) {
      const read = file.read.bind(file);
      file.read = async (...readArgs) => {
        if (!swapped) {
          swapped = true;
          await f.fs.rename(path, '/canonical/retained-original');
          await f.fs.symlink('/canonical/retained-original', path);
        }
        return read(...readArgs);
      };
    }
    return file;
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
    expect(f.launches()).toBe(0);
    expect(String(await f.fs.readFile('/canonical/retained-original'))).toBe('original clip');
  } finally { spy.mockRestore(); }
});

it('pins the physical staging root across preparation and native job handoff', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const clip = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const root = clip.slice(0, -'/clips/part one.mp4'.length);
  const retained = '/private/retained-tree';
  await f.fs.rename(root, retained);
  await f.fs.mkdir(root, { mode: 0o700 });
  for (const entry of m.entries) {
    const relative = entry.path.map(component => Buffer.from(component).toString()).join('/');
    if (entry.kind === 'directory') await f.fs.mkdir(`${root}/${relative}`, { mode: 0o700 });
    if (entry.kind === 'file') await f.fs.writeFile(`${root}/${relative}`, await f.fs.readFile(`${retained}/${relative}`), { mode: 0o600 });
  }
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
  expect(f.launches()).toBe(0);
  expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity', error: 'collision' });
  expect(String(await f.fs.readFile(`${retained}/clips/part one.mp4`))).toBe('original clip');
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it('rejects an oversized staged file without reading beyond its admitted contents', async () => {
  for (const growDuringRead of [false, true]) {
    const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
    const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
    if (!growDuringRead) await f.fs.appendFile(path, 'extra');
    const open = f.fs.open.bind(f.fs); const read = vi.fn();
    const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === path) {
        const original = file.read.bind(file);
        file.read = async (...readArgs) => {
          read();
          if (growDuringRead) await f.fs.appendFile(path, 'extra');
          return original(...readArgs);
        };
      }
      return file;
    });
    try {
      const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
      expect(job).toMatchObject({ state: 'failed', error: 'integrity', failure: { code: 'wrong-length' } });
      expect(read).toHaveBeenCalledTimes(growDuringRead ? 1 : 0);
      expect(f.launches()).toBe(0);
      expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    } finally { spy.mockRestore(); }
  }
});

it('stops physical verification on cancellation without invalidating a ready tree', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const path = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const controller = new AbortController(); const read = vi.fn();
  const open = f.fs.open.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (args[0] === path) {
      const original = file.read.bind(file);
      file.read = async (...readArgs) => {
        read(); const bytes = await original(...readArgs);
        controller.abort(new Error('Canceled verification')); return bytes;
      };
    }
    return file;
  });
  try {
    const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] };
    const response = await f.server.fetch(new Request('https://example.test/v1/sessions/s/jobs', { method: 'POST', headers: { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'canceled' }, body: JSON.stringify(invocation), signal: controller.signal }));
    expect(await response.json()).toMatchObject({ state: 'failed', error: 'readiness' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.launches()).toBe(0);
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
  } finally { spy.mockRestore(); }
});

it('refuses a staging tree whose private permissions changed before job handoff', async () => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const clip = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const root = clip.slice(0, -'/clips/part one.mp4'.length);
  await f.fs.chmod(root, 0o777);
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity' });
  expect(f.launches()).toBe(0);
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
});

it.each(['clips', 'clips/part one.mp4', 'shortcut'])('refuses foreign-owned staged entry %s before native handoff', async relative => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'symlink', path: [b('shortcut')], target: b('clips/part one.mp4'), source: m.entries[0].source });
  const result = await f.prepare(m);
  expect(result.state).toBe('ready');
  const clip = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const root = clip.slice(0, -'/clips/part one.mp4'.length);
  await f.fs.lchown(`${root}/${relative}`, process.getuid!() + 1, process.getgid!());
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity', failure: { code: 'collision' } });
  expect(f.launches()).toBe(0);
  expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity' });
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
  await f.fs.lchown(`${root}/${relative}`, process.getuid!(), process.getgid!());
  expect(String(await f.fs.readFile(clip))).toBe('original clip');
});

it('never marks a tree with a foreign-owned symlink ready', async () => {
  const f = fixture(); const m = await f.manifest();
  m.entries.push({ kind: 'symlink', path: [b('shortcut')], target: b('clips/part one.mp4'), source: m.entries[0].source });
  const symlink = f.fs.symlink.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'symlink').mockImplementation(async (...args) => {
    await symlink(...args);
    await f.fs.lchown(args[1], process.getuid!() + 1, process.getgid!());
  });
  try {
    const result = await f.prepare(m);
    expect(result).toMatchObject({ state: 'partial', error: 'collision', failureCategory: 'integrity', cleanup: 'complete' });
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(await f.fs.readdir('/private')).toEqual(['.keep']);
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it.each(['clips', 'clips/part one.mp4'])('refuses externally writable staged entry %s before native handoff', async relative => {
  const f = fixture(); const m = await f.manifest(); const result = await f.prepare(m);
  const clip = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
  const root = clip.slice(0, -'/clips/part one.mp4'.length);
  await f.fs.chmod(`${root}/${relative}`, 0o777);
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding', materializationId: result.operationId, manifestId: result.manifestId, manifestRevision: m.revision, directoryRevision: result.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
  expect(job).toMatchObject({ state: 'failed', error: 'integrity', failure: { code: 'collision' } });
  expect(f.launches()).toBe(0);
  expect(await f.client.inspectMaterialization(result.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity' });
  expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
  expect(String(await f.fs.readFile(clip))).toBe('original clip');
});

it.each(['clips', 'clips/part one.mp4'])('never marks externally writable staged entry %s ready', async relative => {
  const f = fixture(); const m = await f.manifest();
  const open = f.fs.open.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    const path = String(args[0]);
    if (args[1] === 'wx' && path.endsWith('/clips/part one.mp4')) {
      const root = path.slice(0, -'/clips/part one.mp4'.length);
      await f.fs.chmod(`${root}/${relative}`, 0o777);
    }
    return file;
  });
  try {
    const result = await f.prepare(m);
    expect(result).toMatchObject({ state: 'partial', error: 'collision', failureCategory: 'integrity', cleanup: 'complete' });
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(await f.fs.readdir('/private')).toEqual(['.keep']);
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it('preserves replacement data when failed preparation loses its owned staging identity', async () => {
  const f = fixture(); const m = await f.manifest();
  const open = f.fs.open.bind(f.fs); let replacement: string | undefined;
  const spy = vi.spyOn(f.fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    if (typeof args[1] === 'number' && String(args[0]).endsWith('/clips/part one.mp4')) {
      replacement = String(args[0]).slice(0, -'/clips/part one.mp4'.length);
      await f.fs.rename(replacement, '/private/retained-tree');
      await f.fs.mkdir(replacement, { mode: 0o700 });
      await f.fs.writeFile(`${replacement}/original`, 'preserve replacement data');
    }
    return file;
  });
  try {
    const result = await f.prepare(m);
    expect(result).toMatchObject({ state: 'partial', failureCategory: 'integrity', cleanup: 'failed' });
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(String(await f.fs.readFile(`${replacement}/original`))).toBe('preserve replacement data');
    expect(String(await f.fs.readFile('/private/retained-tree/clips/part one.mp4'))).toBe('original clip');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it.each([undefined, Number.MAX_SAFE_INTEGER + 1, -1])('rejects unrepresentable staging identity %s before allocating a tree', async ino => {
  const f = fixture(); const m = await f.manifest();
  const lstat = f.fs.lstat.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => {
    const stat = await lstat(...args);
    if (String(args[0]) === '/private') Object.assign(stat, { ino });
    return stat;
  });
  try {
    const result = await f.prepare(m);
    expect(result).toMatchObject({ state: 'failed', error: 'unsupported', failureCategory: 'readiness' });
    expect(result.entries.every(entry => entry.state !== 'applied')).toBe(true);
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(await f.fs.readdir('/private')).toEqual(['.keep']);
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it.each(['root', 'file'])('rejects unsupported %s identity during physical verification', async target => {
  const f = fixture(); const m = await f.manifest();
  const lstat = f.fs.lstat.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => {
    const stat = await lstat(...args);
    const path = String(args[0]);
    if (target === 'root' ? path.startsWith('/private/materialization-') && !path.slice('/private/'.length).includes('/') : path.endsWith('/clips/part one.mp4'))
      Object.assign(stat, { dev: undefined });
    return stat;
  });
  try {
    const result = await f.prepare(m);
    expect(result.state).not.toBe('ready');
    expect(result.error).toBe('unsupported');
    expect(result.failureCategory).toBe('readiness');
    expect(await f.client.inspectMaterialization(result.operationId)).toEqual(result);
    expect(String(await f.fs.readFile('/canonical/original'))).toBe('untouched');
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it('reports unsupported verification identity as readiness loss without declaring content corrupt', async () => {
  const f = fixture(); const manifest = await f.manifest(); const prepared = await f.prepare(manifest);
  const lstat = f.fs.lstat.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'lstat').mockImplementation(async (...args) => {
    const stat = await lstat(...args);
    if (String(args[0]).endsWith('/clips/part one.mp4')) Object.assign(stat, { ino: Number.MAX_SAFE_INTEGER + 1 });
    return stat;
  });
  try {
    const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding',
      materializationId: prepared.operationId, manifestId: prepared.manifestId, manifestRevision: manifest.revision,
      directoryRevision: prepared.directoryRevision!, cwd: b('/work'), originalArgv: [b('native'), b('edit/lists/cut.ffconcat')] });
    expect(job).toMatchObject({ state: 'failed', error: 'readiness', failure: { code: 'unsupported' } });
    expect(await f.client.inspectMaterialization(prepared.operationId)).toEqual(prepared);
    expect(f.launches()).toBe(0);
  } finally { spy.mockRestore(); }
});

it('expires failed preparations whose owned tree was already cleaned up', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); const m = await f.manifest();
    f.blobs.set([...f.blobs.keys()][0], Uint8Array.from(b('short')));
    expect(await f.prepare(m)).toMatchObject({ state: 'partial', cleanup: 'complete' });
    vi.setSystemTime(Date.now() + 120000);
    await expect(f.server.sweep()).resolves.toBeUndefined();
    expect(await f.fs.readdir('/private')).toEqual(['.keep']);
  } finally { vi.useRealTimers(); }
});

it('refuses to sweep a replacement of an expired owned tree', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); const m = await f.manifest(); await f.prepare(m);
    const clip = Object.keys(f.volume.toJSON()).find(p => p.endsWith('/clips/part one.mp4'))!;
    const root = clip.slice(0, -'/clips/part one.mp4'.length);
    await f.fs.rename(root, '/private/retained-tree');
    await f.fs.mkdir(root, { mode: 0o700 });
    await f.fs.writeFile(`${root}/original`, 'preserve replacement data');
    vi.setSystemTime(Date.now() + 120000);
    await expect(f.server.sweep()).rejects.toMatchObject({ code: 'collision' });
    expect(String(await f.fs.readFile(`${root}/original`))).toBe('preserve replacement data');
    expect(String(await f.fs.readFile('/private/retained-tree/clips/part one.mp4'))).toBe('original clip');
  } finally { vi.useRealTimers(); }
});

it.each([
  { exitCode: -1, stdout: [], stderr: [] },
  { exitCode: 0, stdout: [256], stderr: [] },
  { exitCode: 0, stdout: [], stderr: [undefined] },
])('retains an inspectable native failure when the namespace returns invalid diagnostics %j', async result => {
  const f = fixture({}, { buildId: 'build', async execute() { return result as never; } });
  const manifest = await f.manifest(); const prepared = await f.prepare(manifest);
  const invocation = { sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding',
    materializationId: prepared.operationId, manifestId: prepared.manifestId, manifestRevision: manifest.revision,
    directoryRevision: prepared.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] };
  const job = await f.client.execute(invocation);
  expect(job).toMatchObject({ state: 'failed', error: 'native' });
  expect(job.result).toBeUndefined();
  expect(await f.client.inspectJob(job.jobId)).toEqual(job);
  expect(await f.client.inspectMaterialization(prepared.operationId)).toEqual(prepared);
});

it('owns native result octets after the namespace returns them', async () => {
  const result = { exitCode: 1, stdout: [0, 255], stderr: b('native pathname failure') };
  const f = fixture({}, { buildId: 'build', async execute() { return result; } });
  const manifest = await f.manifest(); const prepared = await f.prepare(manifest);
  const job = await f.client.execute({ sessionId: 's', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'binding',
    materializationId: prepared.operationId, manifestId: prepared.manifestId, manifestRevision: manifest.revision,
    directoryRevision: prepared.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
  result.exitCode = 0; result.stdout.push(42); result.stderr.length = 0;
  expect(await f.client.inspectJob(job.jobId)).toEqual(job);
});


it('passes control request cancellation to authentication before admitting materialization work', async () => {
  const f = fixture();
  const controller = new AbortController();
  const request = new Request('https://example.test/v1/sessions/s/materializations', {
    signal: controller.signal,
    headers: { 'Execution-Epoch': 'e', 'Execution-Profile': 'dependency-manifest-v1' },
  });
  f.authenticate.mockImplementationOnce(async (_request, signal) => {
    controller.abort(new Error('Caller cancelled'));
    expect(signal).toBe(request.signal);
    expect(signal?.aborted).toBe(true);
    return f.principal;
  });
  await f.server.fetch(request);
  expect(f.authenticate.mock.calls[0]?.[1]).toBe(request.signal);
  expect(f.authorize).not.toHaveBeenCalled();
  expect(await f.fs.readdir('/private')).toEqual(['.keep']);
  expect(f.launches()).toBe(0);
});

it('does not start control authentication for an already cancelled request', async () => {
  const f = fixture();
  const signal = AbortSignal.abort(new Error('Caller cancelled'));
  await f.server.fetch(new Request('https://example.test/v1/sessions/s/materializations', { signal }));
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(await f.fs.readdir('/private')).toEqual(['.keep']);
});
