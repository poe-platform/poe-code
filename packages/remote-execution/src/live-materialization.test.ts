import { expect, it, vi } from 'vitest';
import { createExecutionServer } from './server.js';
import { createExecutionClient } from './materializations.js';
import { createUploadClient } from './uploads.js';
import { createHash } from 'node:crypto';
import { TreeError } from './materialization-tree.js';
import type { MaterializationServerOptions } from './materialization-server.js';
const b = (s: string) => Array.from(new TextEncoder().encode(s));
it('refuses live job admission when a readiness observation hides revoked work behind an accessor', async () => {
  const f = fixture();
  const required = { kind: 'required', identity: 'starting-tree', state: 'complete' };
  const readiness = [required];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  const replacement = vi.fn(() => 'pending');
  readiness.push({ kind: 'speculative', identity: 'nested-playlist', get state() {
    Object.defineProperty(required, 'state', { configurable: true, get: replacement });
    return 'failed';
  } });
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build',
    sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId,
    manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.materialize).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});
it.each(['cancel', 'expire'] as const)('does not publish a ready revision when authority is lost during readiness observation: %s', async loss => {
  let time = Date.now();
  const f = fixture(1000n, () => time);
  const controller = new AbortController();
  const reason = new Error('materialization canceled');
  const readiness = [{ kind: 'required', identity: 'starting-tree', get state() {
    if (loss === 'cancel') controller.abort(reason);
    else time += 60001;
    return 'complete';
  } }];
  f.materialize.mockImplementationOnce(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  if (loss === 'cancel') {
    await expect(f.prepare('one', 'r', null, controller.signal)).rejects.toBe(reason);
    expect(await f.client('one').listMaterializations()).toEqual([expect.objectContaining({
      state: 'failed', failureCategory: 'readiness', cleanup: 'complete', directoryRevision: null,
    })]);
  } else {
    expect(await f.prepare('one')).toMatchObject({ state: 'failed', error: 'unauthorized', cleanup: 'complete', directoryRevision: null });
  }
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.execute).not.toHaveBeenCalled();
  // A failed observation must not advance the namespace's current revision.
  expect(await f.prepare('one', 'successor')).toMatchObject({ state: 'ready' });
});
it.each(['before-admission', 'during-authorization'] as const)('rejects required readiness lost %s before a validator can repair the starting tree', async stage => {
  const f = fixture();
  const readiness = [{ kind: 'required', identity: 'tree', state: 'complete' }];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  if (stage === 'before-admission') readiness[0].state = 'pending';
  else f.authorize.mockImplementation(async () => { readiness[0].state = 'pending'; return true; });
  f.validate.mockImplementation(async () => { readiness[0].state = 'complete'; });
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.materialize).toHaveBeenCalledOnce();
});
it('keeps speculative readiness payloads outside materialization and live job admission', async () => {
  const f = fixture();
  const speculative = vi.fn(() => { throw new Error('late nested playlist denied'); });
  const advisory = Object.defineProperty({ kind: 'speculative', identity: 'nested/playlist', state: 'failed' },
    'failure', { enumerable: true, get: speculative });
  const readiness = [
    { kind: 'required', identity: 'tree', state: 'complete' },
    { kind: 'metadata-only', identity: 'source', state: 'complete' }, advisory,
  ];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  expect(m.state).toBe('ready');
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job.state).toBe('exited');
  expect(speculative).not.toHaveBeenCalled();
  expect(m.readiness).toEqual(readiness.map(({ kind, identity, state }) => ({ kind, identity, state })));
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.materialize).toHaveBeenCalledOnce();
});
it('admits a live writer while a reader uses the same installed canonical namespace', async () => {
 const f = fixture(); const m = await f.prepare('one');
 const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g',
  materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('reader')] };
 let entered!: () => void; let release!: () => void; let content = 1;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const visible = new Promise<void>(resolve => { release = resolve; });
 f.execute.mockImplementation(async (input: any) => {
  if (input.invocation.originalArgv[0][0] === b('reader')[0]) { entered(); await visible; return { exitCode: 0, stdout: [content], stderr: [] }; }
  content = 2;
  // The revision must stay pinned while the first native access is pending.
  await expect(f.prepare('one', 'successor', m.directoryRevision)).rejects.toMatchObject({ status: 409 });
  return { exitCode: 1, stdout: [], stderr: [] };
 });
 const reading = f.client('one').execute(invocation); await started;
 try {
  expect(await f.client('one').execute({ ...invocation, originalArgv: [b('writer')] })).toMatchObject({ state: 'exited', result: { exitCode: 1 } });
  await expect(f.prepare('one', 'after-writer', m.directoryRevision)).rejects.toMatchObject({ status: 409 });
 } finally { release(); }
 expect(await reading).toMatchObject({ state: 'exited', result: { stdout: [2] } });
 expect(f.materialize).toHaveBeenCalledOnce();
 expect(f.execute).toHaveBeenCalledTimes(2);
});

it('rejects ambiguous readiness discovered during live validation without starting or rebuilding the workspace', async () => {
  const f = fixture();
  const readiness = [{ kind: 'required', identity: 'tree', state: 'complete' }];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  f.validate.mockImplementation(async () => { readiness.push({ kind: 'speculative', identity: 'tree', state: 'failed' }); });
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.materialize).toHaveBeenCalledOnce();
});

it.each(['replace', 'demote', 'remove'] as const)('rejects %s of admitted required work during live validation', async change => {
  const f = fixture();
  const readiness = [
    { kind: 'required', identity: 'cwd', state: 'complete' },
    { kind: 'required', identity: 'starting-tree', state: 'complete' },
  ];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  f.validate.mockImplementation(async () => {
    if (change === 'replace') readiness[1].identity = 'other-tree';
    if (change === 'demote') readiness[1].kind = 'speculative';
    if (change === 'remove') readiness.pop();
  });
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] };
  const job = await f.client('one').execute(invocation);
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  f.validate.mockImplementation(async () => {});
  expect(await f.client('one').execute(invocation)).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.execute).not.toHaveBeenCalled();
});
function fixture(maxTreeBytes = 1000n, now = Date.now) {
  const execute = vi.fn(async () => ({ exitCode: 0, stdout: [], stderr: [] }));
  const close = vi.fn(async () => {});
  const validate = vi.fn(async () => {});
  const materialize = vi.fn(async () => ({ readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }], validate, execute, close }));
  const blobs = new Map<string, Uint8Array>();
  const liveNamespace = { buildId: 'build', materialize };
  const authorize = vi.fn(async () => true);
  const config: MaterializationServerOptions = { privateRoot: '/never-used', maxDocumentBytes: 10000, maxEntries: 10, maxPathBytes: 1000, maxTreeBytes, maxRecords: 100, authorize, liveNamespace };
  const server = createExecutionServer({
    now,
    authenticate: async request => ({ tenantId: 't', principalId: 'p', sessionId: request.headers.get('Authorization')!.slice(7), epoch: 'e', expiresAt: now() + 60000, sessionExpiresAt: now() + 60000 }),
    storage: {
      append: async (id, _offset, data) => { blobs.set(id, new Uint8Array([...(blobs.get(id) ?? []), ...data])); },
      read: async (id, offset, count) => (blobs.get(id) ?? new Uint8Array()).slice(Number(offset), Number(offset) + count),
      remove: async id => { blobs.delete(id); },
    },
    limits: { maxBlobBytes: 10n, maxReservedBytes: 10n, maxChunkBytes: 10, maxConcurrent: 2, maxUploads: 10, maxChunks: 10 },
    materializations: config,
  });
  const client = (s: string) => createExecutionClient({ baseUrl: 'https://example.test', sessionId: s, epoch: 'e', token: () => s, fetch: async (url, init) => server.fetch(new Request(url, init)) });
  async function prepare(s: string, revision = 'r', prior: string | null = null, signal?: AbortSignal) {
    const c = client(s);
    const m = await c.putManifest({ version: 1, sessionId: s, epoch: 'e', namespaceId: 'n', sourceAuthorityId: 'a', revision, logicalRoot: b('/work'), cwd: b('/work'), entries: [{ kind: 'directory', path: [b('lists')], source: { authorityId: 'a', path: b('/work/lists'), freshness: 'live', callbackGrantId: 'g', observedVersion: null, retainedIdentity: null } }] });
    return c.materialize({ sessionId: s, epoch: 'e', manifestId: m.manifestId, manifestRevision: revision, bindingId: 'g', expectedDirectoryRevision: prior, operationKey: revision }, signal);
  }
  const uploads = (s: string) => createUploadClient({ baseUrl: 'https://example.test', sessionId: s, epoch: 'e', token: () => s, maxChunkBytes: 10, fetch: async (url, init) => server.fetch(new Request(url, init)) });
  return { client, uploads, prepare, execute, materialize, close, validate, server, liveNamespace, config, authorize };
}
it('retains issued authorization at installation without capturing its policy values', async () => {
  const f = fixture();
  const replacement = vi.fn(async () => true);
  f.config.authorize = replacement;
  f.authorize.mockImplementation(async function () {
    expect(this).toBe(f.config);
    return false;
  });
  expect(await f.prepare('one')).toMatchObject({ state: 'failed', error: 'unauthorized' });
  expect(f.authorize).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(f.materialize).not.toHaveBeenCalled();
});

it('rechecks the issued canonical authorizer at execution after live permission revocation', async () => {
  const f = fixture();
  const m = await f.prepare('one');
  const replacement = vi.fn(async () => true);
  f.config.authorize = replacement;
  f.authorize.mockResolvedValue(false);
  expect(await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!,
    cwd: b('/work'), originalArgv: [b('lists/input')] })).toMatchObject({ state: 'failed', error: 'readiness', failure: { code: 'unauthorized' } });
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(replacement).not.toHaveBeenCalled();
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(await f.client('one').inspectMaterialization(m.operationId)).toMatchObject({ state: 'ready' });
});
it('keeps the admitted build coupled to its live namespace driver', async () => {
  const f = fixture();
  const m = await f.prepare('one');
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'replacement-build', sourceAuthorityId: 'a', bindingId: 'g',
    materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!,
    cwd: b('/work'), originalArgv: [b('lists/input')] };
  f.liveNamespace.buildId = 'replacement-build';
  await expect(f.client('one').execute(invocation)).rejects.toMatchObject({ status: 409 });
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(await f.client('one').execute({ ...invocation, buildId: 'build' })).toMatchObject({ state: 'exited' });
});

it('keeps the issued materializer coupled to its original build and receiver', async () => {
  const f = fixture();
  const scratch = vi.fn(async () => ({ readiness: [{ kind: 'required', identity: 'scratch', state: 'complete' }],
    validate: f.validate, execute: f.execute, close: f.close }));
  f.materialize.mockImplementation(async function () {
    expect(this).toBe(f.liveNamespace);
    return { readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }], validate: f.validate, execute: f.execute, close: f.close };
  });
  f.liveNamespace.materialize = scratch;
  expect(await f.prepare('one')).toMatchObject({ state: 'ready' });
  expect(f.materialize).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
});
it('preserves required identities when concurrent readiness bookkeeping reorders the ledger', async () => {
  const f = fixture();
  const readiness = [
    { kind: 'required', identity: 'cwd', state: 'complete' },
    { kind: 'required', identity: 'namespace', state: 'complete' },
  ];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  f.validate.mockImplementation(async () => { readiness.reverse(); });
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job.state).toBe('exited');
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.materialize).toHaveBeenCalledOnce();
});
it('retains an expired live workspace until every overlapping job has drained', async () => {
 let time = 1000; const f = fixture(1000n, () => time); const m = await f.prepare('one');
 const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g',
  materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [] };
 const releases: (() => void)[] = []; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 f.execute.mockImplementation(async () => {
  await new Promise<void>(resolve => { releases.push(resolve); if (releases.length === 2) entered(); });
  return { exitCode: 0, stdout: [], stderr: [] };
 });
 const first = f.client('one').execute(invocation); const second = f.client('one').execute(invocation);
 await started;
 try {
  releases[0](); await first;
  time += 60001;
  await f.server.sweep();
  expect(f.close).not.toHaveBeenCalled();
 } finally { releases.forEach(release => release()); await Promise.all([first, second]); }
 await f.server.sweep(); expect(f.close).toHaveBeenCalledOnce();
});
it.each(['wrong-hash', 'wrong-length', 'unstable-capture', 'collision'] as const)('reports live starting-tree %s as integrity and invalidates its readiness', async code => {
  const f = fixture(); const m = await f.prepare('one');
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [] };
  f.validate.mockRejectedValueOnce(new TreeError(code));
  const job = await f.client('one').execute(invocation);
  expect(job).toMatchObject({ state: 'failed', error: 'integrity', failure: { code } });
  expect(await f.client('one').inspectJob(job.jobId)).toEqual(job);
  expect(await f.client('one').inspectMaterialization(m.operationId)).toMatchObject({ state: 'failed', failureCategory: 'integrity', error: code });
  await expect(f.client('one').execute(invocation)).rejects.toMatchObject({ status: 409 });
  expect(f.execute).not.toHaveBeenCalled();
});
it('rejects a non-Unicode logical cwd before admitting a live job', async () => {
  const f = fixture(); const m = await f.prepare('one');
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: [47, 255], originalArgv: [b('lists/input')] };
  await expect(f.client('one').execute(invocation)).rejects.toThrow('Lossless Unicode logical cwd required');
  // Independent HTTP callers must also fail the server admission boundary.
  const response = await f.server.fetch(new Request('https://execution.test/v1/sessions/one/jobs', {
    method: 'POST', headers: { Authorization: 'Bearer one', 'Execution-Epoch': 'e',
      'Execution-Profile': 'dependency-manifest-v1', 'Idempotency-Key': 'invalid-cwd', 'Content-Type': 'application/json' },
    body: JSON.stringify(invocation),
  }));
  expect(response.status).toBe(400);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it('binds identical relative names in distinct sessions without any scratch filesystem authority', async () => {
  const f = fixture();
  for (const s of ['one', 'two']) {
    const m = await f.prepare(s); expect(m.state).toBe('ready');
    const invocation = { sessionId: s, epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input'), b('/work/lists/input')] };
    await expect(f.client(s === 'one' ? 'two' : 'one').execute(invocation)).rejects.toBeDefined();
    expect((await f.client(s).execute(invocation)).state).toBe('exited');
  }
  expect(f.execute).toHaveBeenCalledTimes(2);
  expect(f.execute.mock.calls[0][0].invocation.sessionId).toBe('one');
  expect(f.execute.mock.calls[1][0].invocation.sessionId).toBe('two');
});
it('cancels during materialization, disposes late acquisition, and never admits a process', async () => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('stop');
  f.materialize.mockImplementation(async () => { controller.abort(reason); return { readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }], validate: f.validate, execute: f.execute, close: f.close }; });
  await expect(f.prepare('one', 'r', null, controller.signal)).rejects.toThrow('stop');
  expect(f.close).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
});

it('serializes concurrent manifest revisions and rejects jobs until required work is complete', async () => {
  const f = fixture(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.materialize.mockImplementation(async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
    return { readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }], validate: f.validate, execute: f.execute, close: f.close };
  });
  const first = f.prepare('one'); await started;
  const [pending] = await f.client('one').listMaterializations();
  await expect(f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: pending.operationId, manifestId: pending.manifestId, manifestRevision: 'r', directoryRevision: 'not-ready', cwd: b('/work'), originalArgv: [] })).rejects.toMatchObject({ status: 409 });
  await expect(f.prepare('one', 'r2')).rejects.toMatchObject({ status: 409 });
  expect(f.execute).not.toHaveBeenCalled(); release(); expect((await first).state).toBe('ready');
});

it('does not advance a running workspace revision under native handles', async () => {
  const f = fixture(); const m = await f.prepare('one'); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.execute.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { exitCode: 0, stdout: [], stderr: [] }; });
  const running = f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  await started;
  await expect(f.prepare('one', 'r2', m.directoryRevision)).rejects.toMatchObject({ status: 409 });
  expect(f.materialize).toHaveBeenCalledOnce(); release(); await running;
});

it('rejects a superseded ready materialization before validation or process admission', async () => {
  const f = fixture();
  const old = await f.prepare('one');
  const current = await f.prepare('one', 'r2', old.directoryRevision);
  expect(current.state).toBe('ready');
  await expect(f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: old.operationId, manifestId: old.manifestId, manifestRevision: 'r', directoryRevision: old.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] })).rejects.toMatchObject({ status: 409 });
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

it('recovers an admitted job during validation without reporting a running process', async () => {
  const f = fixture(); const m = await f.prepare('one'); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.validate.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [] };
  const running = f.client('one').execute(invocation, undefined, 'job'); await started;
  const recovered = await f.client('one').execute(invocation, undefined, 'job');
  release(); await running;
  expect(recovered.state).toBe('accepted'); expect(f.execute).toHaveBeenCalledOnce();
});


it('rechecks required readiness at job admission while leaving speculative failures advisory', async () => {
  for (const required of ['complete', 'failed'] as const) {
    const f = fixture();
    const readiness = [{ kind: 'required', identity: 'tree', state: 'complete' }];
    f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
    const m = await f.prepare('one');
    readiness[0].state = required;
    readiness.push({ kind: 'speculative', identity: 'late-font', state: 'failed' });
    const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
    if (required === 'failed') {
      expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
      expect(f.execute).not.toHaveBeenCalled();
    } else {
      expect(job.state).toBe('exited');
      expect(f.execute).toHaveBeenCalledOnce();
    }
  }
});

it('keeps an authority failure during validation separate from tree corruption', async () => {
  const { UploadError } = await import('./upload-protocol.js');
  const f = fixture(); const m = await f.prepare('one');
  f.validate.mockRejectedValueOnce(new UploadError(401, 'Lease expired'));
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] });
  expect(job).toMatchObject({ state: 'failed', error: 'readiness' });
  expect((await f.client('one').inspectMaterialization(m.operationId)).state).toBe('ready');
  expect(f.execute).not.toHaveBeenCalled();
});

it('does not start when required readiness is lost during asynchronous live validation', async () => {
  const f = fixture();
  const readiness = [{ kind: 'required', identity: 'starting-tree', state: 'complete' }];
  f.materialize.mockImplementation(async () => ({ readiness, validate: f.validate, execute: f.execute, close: f.close }));
  const m = await f.prepare('one');
  let entered!: () => void; let release!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.validate.mockImplementation(async () => { entered(); await gate; });
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] };
  const running = f.client('one').execute(invocation);
  await validating;
  readiness[0].state = 'pending';
  readiness.push({ kind: 'speculative', identity: 'nested/optional-child', state: 'failed' });
  release();
  expect(await running).toMatchObject({ state: 'failed', error: 'readiness' });
  expect(f.execute).not.toHaveBeenCalled();
  expect(await f.client('one').inspectMaterialization(m.operationId)).toMatchObject({ state: 'ready', readiness });
  readiness[0].state = 'complete';
  expect(await f.client('one').execute(invocation)).toMatchObject({ state: 'exited' });
  expect(f.execute).toHaveBeenCalledOnce();
});

it('does not poison a live materialization when required cwd access fails', async () => {
  const f = fixture(); const m = await f.prepare('one');
  f.validate.mockRejectedValueOnce(Object.assign(new Error('cwd denied'), { code: 'EACCES' }));
  const invocation = { sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('native')] };
  expect(await f.client('one').execute(invocation)).toMatchObject({ state: 'failed', error: 'readiness', failure: { code: 'EACCES', message: 'cwd denied' } });
  expect((await f.client('one').inspectMaterialization(m.operationId)).state).toBe('ready');
  expect(f.execute).not.toHaveBeenCalled();
  expect((await f.client('one').execute(invocation)).state).toBe('exited');
});

it.each(['live', 'revalidate-on-open'] as const)('installs %s canonical files without acquiring an obsolete uploaded snapshot', async freshness => {
  const f = fixture(0n); const c = f.client('one');
  const saved = await c.putManifest({ version: 1, sessionId: 'one', epoch: 'e', namespaceId: 'n', sourceAuthorityId: 'a', revision: 'required-file', logicalRoot: b('/work'), cwd: b('/work'), entries: [{ kind: 'file', path: [b('input.mp4')], source: { authorityId: 'a', path: b('/work/input.mp4'), freshness, callbackGrantId: 'g', observedVersion: null, retainedIdentity: null }, blob: { blobId: 'missing', size: '1', sha256: '0'.repeat(64) } }] });
  const result = await c.materialize({ sessionId: 'one', epoch: 'e', manifestId: saved.manifestId, manifestRevision: saved.revision, bindingId: 'g', expectedDirectoryRevision: null, operationKey: 'required-file' });
  expect(result).toMatchObject({ state: 'ready', entries: [{ index: 0, state: 'applied' }] });
  expect(await c.inspectMaterialization(result.operationId)).toEqual(result);
  expect(f.materialize).toHaveBeenCalledOnce();
  expect(f.execute).not.toHaveBeenCalled();
});

it('requires immutable upload receipts even when installing a live namespace', async () => {
  const f = fixture(); const c = f.client('one');
  const saved = await c.putManifest({ version: 1, sessionId: 'one', epoch: 'e', namespaceId: 'n', sourceAuthorityId: 'a', revision: 'immutable-file', logicalRoot: b('/work'), cwd: b('/work'), entries: [{ kind: 'file', path: [b('input.mp4')], source: { authorityId: 'a', path: b('/work/input.mp4'), freshness: 'immutable', snapshotId: 'snapshot', observedVersion: null, retainedIdentity: null }, blob: { blobId: 'missing', size: '1', sha256: '0'.repeat(64) } }] });
  const result = await c.materialize({ sessionId: 'one', epoch: 'e', manifestId: saved.manifestId, manifestRevision: saved.revision, bindingId: 'g', expectedDirectoryRevision: null, operationKey: 'immutable-file' });
  expect(result).toMatchObject({ state: 'failed', error: 'missing-blob', entries: [{ index: 0, state: 'failed' }] });
  expect(f.materialize).not.toHaveBeenCalled();
});

it('rejects incorrect immutable receipt sizes and hashes before live installation and admits verified handles', async () => {
  for (const variant of ['size', 'hash', 'budget', 'valid']) {
    const f = fixture(variant === 'budget' ? 3n : 1000n); const c = f.client('one'); const uploads = f.uploads('one');
    const bytes = Uint8Array.from(b('clip'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const pending = await uploads.beginUpload({ size: '4', digest });
    await uploads.uploadChunk(pending.uploadId, '0', bytes);
    const blob = await uploads.commitUpload(pending.uploadId);
    const saved = await c.putManifest({ version: 1, sessionId: 'one', epoch: 'e', namespaceId: 'n', sourceAuthorityId: 'a', revision: 'r', logicalRoot: b('/work'), cwd: b('/work'), entries: [{ kind: 'file', path: [b('input.mp4')], source: { authorityId: 'a', path: b('/work/input.mp4'), freshness: 'immutable', snapshotId: 'snapshot', callbackGrantId: 'g', observedVersion: null, retainedIdentity: null }, blob: { blobId: blob.blobId, size: variant === 'size' ? '5' : blob.size, sha256: variant === 'hash' ? '0'.repeat(64) : blob.digest } }] });
    const result = await c.materialize({ sessionId: 'one', epoch: 'e', manifestId: saved.manifestId, manifestRevision: 'r', bindingId: 'g', expectedDirectoryRevision: null, operationKey: 'r' });
    if (variant === 'valid') {
      expect(result.state).toBe('ready');
      expect(f.materialize).toHaveBeenCalledOnce();
    } else {
      expect(result).toMatchObject({ state: 'failed', failureCategory: variant === 'budget' ? 'readiness' : 'integrity', error: variant === 'budget' ? 'unsupported' : variant === 'size' ? 'wrong-length' : 'wrong-hash' });
      expect(f.materialize).not.toHaveBeenCalled();
    }
  }
});

it('pins the acquired live driver while readiness and canonical inputs remain live', async () => {
  const f = fixture();
  const readiness = [{ kind: 'required', identity: 'tree', state: 'complete' }];
  const workspace = { readiness, validate: f.validate, execute: f.execute, close: f.close };
  f.materialize.mockImplementation(async () => workspace);
  const m = await f.prepare('one');
  const scratch = vi.fn(async () => ({ exitCode: 99, stdout: [], stderr: [] }));
  const foreignClose = vi.fn(async () => {});
  workspace.execute = scratch;
  workspace.close = foreignClose;
  f.validate.mockImplementation(async () => {
    readiness.push({ kind: 'speculative', identity: 'late/nested/playlist', state: 'failed' });
  });
  const job = await f.client('one').execute({ sessionId: 'one', epoch: 'e', buildId: 'build', sourceAuthorityId: 'a', bindingId: 'g', materializationId: m.operationId, manifestId: m.manifestId, manifestRevision: 'r', directoryRevision: m.directoryRevision!, cwd: b('/work'), originalArgv: [b('lists/input')] });
  expect(job).toMatchObject({ state: 'exited', result: { exitCode: 0 } });
  expect(f.validate).toHaveBeenCalledOnce();
  expect(f.execute).toHaveBeenCalledOnce();
  expect(scratch).not.toHaveBeenCalled();
  expect(await f.client('one').inspectMaterialization(m.operationId)).toMatchObject({ readiness });
  expect(f.materialize).toHaveBeenCalledOnce();
});

it('releases the acquired close capability when driver method admission fails', async () => {
  const f = fixture();
  const foreignClose = vi.fn(async () => {});
  const workspace = { readiness: [{ kind: 'required', identity: 'tree', state: 'complete' }], validate: f.validate, execute: f.execute, close: f.close };
  Object.defineProperty(workspace, 'validate', { get() {
    workspace.close = foreignClose;
    throw new Error('driver admission failed');
  } });
  f.materialize.mockImplementation(async () => workspace);
  expect(await f.prepare('one')).toMatchObject({ state: 'failed', cleanup: 'complete' });
  expect(f.close).toHaveBeenCalledOnce();
  expect(foreignClose).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
