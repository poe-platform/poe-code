import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createUploadClient } from './uploads.js';
import { createUploadServer, type UploadPrincipal, type UploadStorage } from './server.js';
import { uploadDescriptor } from './upload-descriptor.js';

const bytes = (...n: number[]) => Uint8Array.from(n);
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
it('sends the same source declaration observation that upload admission validates', async () => {
  const f = fixture();
  let observations = 0;
  const declaration = { get size() { return ++observations === 1 ? '4' : '2'; }, digest: digest(bytes(1, 2, 3, 4)) };
  const upload = await f.client().beginUpload(declaration);
  expect(upload.size).toBe('4');
  expect(observations).toBe(1);
});
it.each(['read', 'eof'] as const)('never verifies a blob with a shadowed storage length at %s', async phase => {
  const f = fixture(); const client = f.client();
  const upload = await client.beginUpload({ size: '1', digest: digest(phase === 'read' ? bytes(1, 2) : bytes(1)) });
  await client.uploadChunk(upload.uploadId, '0', bytes(1));
  f.storage.read = async (_id, offset) => {
    if (phase === 'eof' && offset === 0n) return bytes(1);
    if (phase === 'read' && offset !== 0n) return bytes();
    const data = phase === 'read' ? bytes(1, 2) : bytes(2);
    Object.defineProperty(data, 'length', { value: phase === 'read' ? 1 : 0 });
    Object.defineProperty(data, 'byteLength', { value: phase === 'read' ? 1 : 0 });
    return data;
  };
  await expect(client.commitUpload(upload.uploadId)).rejects.toMatchObject({ status: 409 });
  expect((await client.inspectUpload(upload.uploadId)).state).toBe('open');
});
it.each([
  { operation: 'commit', cleanupFails: false }, { operation: 'abort', cleanupFails: false },
  { operation: 'commit', cleanupFails: true }, { operation: 'abort', cleanupFails: true },
])('cancels an unused $operation request body (cleanup failure: $cleanupFails)', async ({ operation, cleanupFails }) => {
  const f = fixture();
  const upload = await f.client().beginUpload({ size: '0', digest: digest(bytes()) });
  const cancel = vi.fn(async () => { if (cleanupFails) throw new Error('transport cleanup failed'); });
  const pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const response = await f.server.fetch(new Request(
    `https://upload.test/v1/sessions/s/uploads/${upload.uploadId}${operation === 'commit' ? '/commit' : ''}`,
    { method: operation === 'commit' ? 'POST' : 'DELETE', body, duplex: 'half',
      headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': operation } } as RequestInit,
  ));
  expect(response.status).toBe(200);
  expect(pull).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
  expect((await f.client().inspectUpload(upload.uploadId)).state).toBe(operation === 'commit' ? 'committed' : 'aborted');
});

it('operator shutdown reclaims both staged uploads and committed blobs and closes admission',async()=>{
 const f=fixture();const client=f.client();
 await client.beginUpload({size:'1',digest:digest(bytes(7))});
 const upload=await client.beginUpload({size:'1',digest:digest(bytes(9))});
 await client.uploadChunk(upload.uploadId,'0',bytes(9));await client.commitUpload(upload.uploadId);
 const first=f.server.close();expect(f.server.close()).toBe(first);await first;
 expect(f.files.size).toBe(0);
 await expect(client.beginUpload({size:'0',digest:digest(bytes())})).rejects.toMatchObject({status:503});
});
it('operator shutdown drains an accepted append before reclaiming its storage',async()=>{
 const f=fixture();const client=f.client();const upload=await client.beginUpload({size:'1',digest:digest(bytes(9))});
 let entered!:()=>void;let release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 const append=f.storage.append;f.storage.append=async(...args)=>{entered();await gate;await append(...args);};
 const writing=client.uploadChunk(upload.uploadId,'0',bytes(9)).catch(cause=>cause);await ready;
 let closed=false;const closing=f.server.close().then(()=>{closed=true;});
 await Promise.resolve();expect(closed).toBe(false);
 release();await writing;await closing;expect(f.files.size).toBe(0);
});
it('operator shutdown attempts every removal and retains cleanup failures on repeated calls',async()=>{
 const f=fixture();const client=f.client();
 const first=await client.beginUpload({size:'0',digest:digest(bytes())});await client.beginUpload({size:'1',digest:digest(bytes(9))});
 const failure=new Error('storage cleanup failed');const remove=vi.fn(async(id:string)=>{if(id===first.uploadId)throw failure;});f.storage.remove=remove;
 const closing=f.server.close();await expect(closing).rejects.toMatchObject({errors:[failure]});
 expect(remove).toHaveBeenCalledTimes(2);expect(f.server.close()).toBe(closing);
});

it('compares retry octets without delegating equality to storage buffers', async () => {
  const f = fixture(); const client = f.client(); const data = bytes(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: digest(data) });
  await client.uploadChunk(upload.uploadId, '0', data);
  const stored = bytes(9, 9);
  stored.some = vi.fn(() => false);
  f.storage.read = async () => stored;
  await expect(client.uploadChunk(upload.uploadId, '0', data)).rejects.toMatchObject({ status: 409 });
  expect(stored.some).not.toHaveBeenCalled();
  expect((await client.inspectUpload(upload.uploadId)).committedOffset).toBe('2');
});

it.each([[1, 2], '12'])('rejects nonbinary transport chunks without acknowledging coerced bytes (%j)', async fragment => {
  const f = fixture(); const client = f.client();
  const data = bytes(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: digest(data) });
  const body = new ReadableStream({
    pull(target) { target.enqueue(fragment); target.close(); },
  }, { highWaterMark: 0 });
  const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${upload.uploadId}/bytes`, {
    method: 'PUT', body, duplex: 'half', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e',
      'Idempotency-Key': 'chunk', 'Content-Type': 'application/octet-stream', 'Content-Length': '2', 'Upload-Offset': '0',
      'Content-Digest': `sha-256=:${createHash('sha256').update(data).digest('base64')}:` },
  } as RequestInit));
  expect(response.status).toBe(400);
  expect((await client.inspectUpload(upload.uploadId)).committedOffset).toBe('0');
  expect(f.files.size).toBe(0);
  expect(body.locked).toBe(false);
  await client.uploadChunk(upload.uploadId, '0', data, undefined, 'chunk');
});

it.each([[1, 2], '12'])('rejects nonbinary SDK chunks before credentials (%j)', async data => {
  const token = vi.fn(() => 'token'); const transport = vi.fn();
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 2, token, fetch: transport });
  await expect(client.uploadChunk('u', '0', data as unknown as Uint8Array)).rejects.toThrow('Binary upload chunk required');
  expect(token).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});

it('retains its session epoch and chunk bound when caller configuration changes', async () => {
  const f = fixture();
  const options = { baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 2,
    token: () => 'a', fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => f.server.fetch(new Request(url, init)) };
  const client = createUploadClient(options);
  options.epoch = 'replacement'; options.maxChunkBytes = 4;
  await expect(client.uploadChunk('u', '0', bytes(1, 2, 3))).rejects.toMatchObject({ status: 413 });
  const upload = await client.beginUpload({ size: '4', digest: digest(bytes(1, 2, 3, 4)) });
  await client.upload(upload.uploadId, (async function* () { yield bytes(1, 2, 3, 4); })());
  expect(f.files.get(upload.uploadId)).toEqual(bytes(1, 2, 3, 4));
  await expect(client.uploadChunk(upload.uploadId, '0', bytes(1, 2))).resolves.toMatchObject({ replayed: true });
});

it.each(['bytes', 'commit'])('recovers canonical binary transfer after a lost %s response without replaying acknowledged data', async stage => {
  const f = fixture({ maxChunkBytes: 2 }); const data = bytes(0, 255, 128, 1);
  const declaration = { size: '4', digest: digest(data) };
  const client = f.client(); const pending = await client.beginUpload(declaration);
  const lost = new Error('connection lost after canonical acknowledgement'); let drop = true;
  const interrupted = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 2,
    fetch: async (url, init) => {
      const response = await f.server.fetch(new Request(url, init));
      if (drop && new URL(String(url)).pathname.endsWith('/' + stage)) {
        drop = false; await response.body?.cancel(); throw lost;
      }
      return response;
    },
  });
  const descriptor = { stat: vi.fn(), read: vi.fn(async (position: number, count: number) => data.slice(position, position + count)), close: vi.fn(async () => {}) };
  const freshness = { descriptor, identity: {}, version: 'v1', profile: 'immutable' as const, assertCurrent: vi.fn(async () => {}), invalidate: vi.fn() };
  await expect(uploadDescriptor(interrupted, descriptor, declaration, { maxChunkBytes: 2, freshness, resume: { source: freshness, uploadId: pending.uploadId, offset: '0' } })).rejects.toBe(lost);
  const receipt = await client.inspectUpload(pending.uploadId);
  expect(receipt).toMatchObject(stage === 'bytes' ? { state: 'open', committedOffset: '2' } : { state: 'committed', committedOffset: '4' });
  await expect(f.client('another-tenant').inspectUpload(pending.uploadId)).rejects.toMatchObject({ status: 404 });
  descriptor.read.mockClear();
  const blob = await uploadDescriptor(client, descriptor, declaration, { maxChunkBytes: 2, freshness, resume: { source: freshness, uploadId: pending.uploadId, offset: receipt.committedOffset } });
  if (stage === 'bytes') expect(descriptor.read).toHaveBeenNthCalledWith(1, 2, 2, { signal: undefined });
  else expect(descriptor.read).not.toHaveBeenCalled();
  expect(new Uint8Array(await (await client.readBlob(blob.blobId)).arrayBuffer())).toEqual(data);
  expect(descriptor.close).not.toHaveBeenCalled();
});

it('retains the authenticated scope while consuming an asynchronous declaration', async () => {
  const principal = { tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 100, sessionExpiresAt: 100 };
  const server = createUploadServer({ now: () => 0, authenticate: async () => principal,
    storage: { append: vi.fn(), read: vi.fn(async () => bytes()), remove: vi.fn() },
    limits: { maxBlobBytes: 0n, maxReservedBytes: 0n, maxChunkBytes: 1, maxConcurrent: 1, maxUploads: 1, maxChunks: 1 } });
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    principal.tenantId = 'replacement';
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ size: '0', digest: digest(bytes()) })));
    controller.close();
  } }, { highWaterMark: 0 });
  const response = await server.fetch(new Request('https://upload.test/v1/sessions/s/uploads', {
    method: 'POST', body, duplex: 'half', headers: { 'Execution-Protocol': '1', 'Execution-Epoch': 'e',
      'Content-Type': 'application/json', 'Idempotency-Key': 'begin' },
  } as RequestInit));
  expect(response.status).toBe(200);
  const upload = await response.json();
  principal.tenantId = 't';
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 1,
    fetch: async (url, init) => server.fetch(new Request(url, init)) });
  await expect(client.inspectUpload(upload.uploadId)).resolves.toMatchObject({ state: 'open' });
  const blob = await client.commitUpload(upload.uploadId);
  principal.tenantId = 'replacement';
  await expect(client.inspectBlob(blob.blobId)).rejects.toMatchObject({ status: 404 });
});

it('keeps configured allocation and storage limits fixed after construction', async () => {
  const limits = { maxBlobBytes: 0n, maxReservedBytes: 0n, maxChunkBytes: 1, maxConcurrent: 1, maxUploads: 1, maxChunks: 1 };
  const server = createUploadServer({ limits, now: () => 0,
    authenticate: async () => ({ tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 100, sessionExpiresAt: 100 }),
    storage: { append: vi.fn(), read: vi.fn(), remove: vi.fn() } });
  limits.maxBlobBytes = 1n; limits.maxReservedBytes = 1n;
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 1,
    fetch: async (url, init) => server.fetch(new Request(url, init)) });
  await expect(client.beginUpload({ size: '1', digest: digest(bytes(1)) })).rejects.toMatchObject({ status: 413 });
});

it.each([
  ...[NaN, Infinity, undefined].map(value => ({ field: 'expiresAt', value, status: 401 })),
  ...[NaN, Infinity, undefined].map(value => ({ field: 'sessionExpiresAt', value, status: 410 })),
  ...['tenantId', 'principalId', 'sessionId', 'epoch'].map(field => ({ field, value: '', status: 401 })),
])('rejects malformed authenticated $field=$value before body admission', async ({ field, value, status }) => {
  const principal = { tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e',
    expiresAt: 100, sessionExpiresAt: 100, [field]: value } as UploadPrincipal;
  const storage = { append: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const server = createUploadServer({ storage, now: () => 0, authenticate: async () => principal,
    limits: { maxBlobBytes: 0n, maxReservedBytes: 0n, maxChunkBytes: 1, maxConcurrent: 1, maxUploads: 1, maxChunks: 1 } });
  let reads = 0; let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new TextEncoder().encode(JSON.stringify({ size: '0', digest: digest(bytes()) }))); controller.close(); },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 });
  const response = await server.fetch(new Request('https://upload.test/v1/sessions/s/uploads', {
    method: 'POST', body, duplex: 'half', headers: { 'Execution-Protocol': '1', 'Execution-Epoch': 'e',
      'Content-Type': 'application/json', 'Idempotency-Key': 'begin' },
  } as RequestInit));
  expect(response.status).toBe(status); expect(reads).toBe(0); expect(canceled).toBe(true);
  expect(storage.append).not.toHaveBeenCalled(); expect(storage.read).not.toHaveBeenCalled();
  // Failed admission must leave the sole record/reservation available.
  Object.assign(principal, { tenantId: 't', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 100, sessionExpiresAt: 100 });
  const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 1,
    fetch: async (url, init) => server.fetch(new Request(url, init)) });
  await expect(client.beginUpload({ size: '0', digest: digest(bytes()) }, undefined, 'begin')).resolves.toMatchObject({ state: 'open' });
});
function fixture(options: { maxBlobBytes?: bigint; maxChunkBytes?: number; maxConcurrent?: number; sessionExpiresAt?: number } = {}) {
  let now = 0;
  let tokenExpiresAt = 100;
  let authenticatedSessionExpiresAt = options.sessionExpiresAt ?? 100;
  const files = new Map<string, Uint8Array>();
  const storage: UploadStorage = {
    async append(id, offset, data) {
      const old = files.get(id) ?? bytes();
      expect(BigInt(old.length)).toBe(offset);
      const next = new Uint8Array(old.length + data.length);
      next.set(old); next.set(data, old.length); files.set(id, next);
    },
    async read(id, offset, length) { return (files.get(id) ?? bytes()).slice(Number(offset), Number(offset) + length); },
    async remove(id) { files.delete(id); },
  };
  const server = createUploadServer({ storage, now: () => now,
    limits: { maxBlobBytes: options.maxBlobBytes ?? 8n, maxReservedBytes: options.maxBlobBytes ?? 32n,
      maxChunkBytes: options.maxChunkBytes ?? 4, maxConcurrent: options.maxConcurrent ?? 2, maxUploads: 8, maxChunks: 8 },
    async authenticate(request) {
      const token = request.headers.get('Authorization');
      if (token === 'Bearer expired') return null;
      return { tenantId: token ?? '', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: tokenExpiresAt, sessionExpiresAt: authenticatedSessionExpiresAt };
    },
  });
  const client = (token = 'a') => createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e',
    token: () => token, maxChunkBytes: options.maxChunkBytes ?? 4,
    fetch: async (url, init) => server.fetch(new Request(url, init)),
  });
  return { server, client, files, storage, expire: () => { now = 101; }, renew: (sessionDeadline?: number) => {
    tokenExpiresAt = 200;
    if (sessionDeadline !== undefined) authenticatedSessionExpiresAt = sessionDeadline;
  } };
}

it('reclaims sibling expired uploads when one removal fails and retries only the retained failure', async () => {
  const f = fixture(); const client = f.client();
  const failed = await client.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await client.uploadChunk(failed.uploadId, '0', bytes(1));
  const sibling = await client.beginUpload({ size: '1', digest: digest(bytes(2)) });
  await client.uploadChunk(sibling.uploadId, '0', bytes(2));
  await client.commitUpload(sibling.uploadId);
  const failure = new Error('storage unavailable');
  const remove = f.storage.remove;
  f.storage.remove = vi.fn(async id => {
    if (id === failed.uploadId) throw failure;
    await remove(id);
  });
  f.expire();
  const outcome = await f.server.sweep().catch(error => error);
  expect(f.files.has(sibling.uploadId)).toBe(false);
  expect(f.files.has(failed.uploadId)).toBe(true);
  expect(outcome).toBe(failure);
  expect(f.storage.remove).toHaveBeenCalledTimes(2);
  f.storage.remove = vi.fn(remove);
  await f.server.sweep();
  expect(f.storage.remove).toHaveBeenCalledExactlyOnceWith(failed.uploadId);
  expect(f.files.size).toBe(0);
});

it('reports every failed expired upload removal while retaining cleanup ownership', async () => {
  const f = fixture(); const client = f.client();
  const first = await client.beginUpload({ size: '0', digest: digest(bytes()) });
  const second = await client.beginUpload({ size: '0', digest: digest(bytes()) });
  const failures = [new Error('first removal failed'), new Error('second removal failed')];
  f.storage.remove = vi.fn(async id => { throw failures[id === first.uploadId ? 0 : 1]; });
  f.expire();
  await expect(f.server.sweep()).rejects.toMatchObject({ errors: failures });
  expect(f.storage.remove).toHaveBeenCalledTimes(2);
  f.storage.remove = vi.fn(async () => {});
  await f.server.sweep();
  expect(f.storage.remove).toHaveBeenCalledWith(first.uploadId);
  expect(f.storage.remove).toHaveBeenCalledWith(second.uploadId);
});

it('rechecks credentials after abort cleanup while retaining the accepted outcome', async () => {
  const f = fixture({ sessionExpiresAt: 200 }); const client = f.client();
  const upload = await client.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await client.uploadChunk(upload.uploadId, '0', bytes(1));
  const remove = f.storage.remove;
  f.storage.remove = async id => { await remove(id); f.expire(); };
  const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${upload.uploadId}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'abort' },
  }));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ category: 'authorization', phase: 'accepted' });
  expect(f.files.size).toBe(0);
  f.renew();
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ state: 'aborted' });
  expect(await client.abortUpload(upload.uploadId, undefined, 'abort')).toMatchObject({ state: 'aborted' });
});

it('rechecks retained session expiry after abort cleanup', async () => {
  const f = fixture(); f.renew();
  const client = f.client();
  const upload = await client.beginUpload({ size: '0', digest: digest(bytes()) });
  f.storage.remove = async () => { f.expire(); };
  const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${upload.uploadId}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'abort' },
  }));
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ phase: 'accepted' });
  await expect(client.inspectUpload(upload.uploadId)).rejects.toMatchObject({ status: 410 });
});

it('preserves cancellation racing completed abort cleanup and allows outcome inspection', async () => {
  const f = fixture(); const client = f.client(); const controller = new AbortController();
  const reason = new Error('caller disconnected during cleanup');
  const upload = await client.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await client.uploadChunk(upload.uploadId, '0', bytes(1));
  const remove = f.storage.remove;
  f.storage.remove = async id => { await remove(id); controller.abort(reason); };
  await expect(client.abortUpload(upload.uploadId, controller.signal, 'abort')).rejects.toBe(reason);
  expect(f.files.size).toBe(0);
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ state: 'aborted' });
});

it.each([{}, [], new DataView(new ArrayBuffer(0))])('refuses nonbinary EOF storage responses at finalize (%j)', async invalid => {
  const f = fixture(); const client = f.client();
  const upload = await client.beginUpload({ size: '0', digest: digest(bytes()) });
  f.storage.read = vi.fn(async () => invalid as never);
  await expect(client.commitUpload(upload.uploadId)).rejects.toMatchObject({ status: 503 });
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ state: 'open' });
  await expect(client.inspectBlob(upload.uploadId)).rejects.toMatchObject({ status: 404 });
});

it('refuses nonbinary storage downloads and releases the read lane', async () => {
  const f = fixture({ maxConcurrent: 1 }); const client = f.client();
  const upload = await client.beginUpload({ size: '2', digest: digest(bytes(1, 2)) });
  await client.uploadChunk(upload.uploadId, '0', bytes(1, 2));
  const blob = await client.commitUpload(upload.uploadId);
  const read = f.storage.read;
  f.storage.read = vi.fn(async () => [1, 2] as never);
  await expect((await client.readBlob(blob.blobId)).arrayBuffer()).rejects.toMatchObject({ status: 503 });
  f.storage.read = read;
  expect(new Uint8Array(await (await client.readBlob(blob.blobId)).arrayBuffer())).toEqual(bytes(1, 2));
});

it.each(['retry', 'commit'] as const)('refuses nonbinary stored chunk replies during %s without losing acknowledged progress', async operation => {
  const f = fixture(); const client = f.client(); const data = bytes(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: digest(data) });
  await client.uploadChunk(upload.uploadId, '0', data);
  const read = f.storage.read;
  f.storage.read = vi.fn(async () => [1, 2] as never);
  await expect(operation === 'retry'
    ? client.uploadChunk(upload.uploadId, '0', data)
    : client.commitUpload(upload.uploadId)).rejects.toMatchObject({ status: 503 });
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ state: 'open', committedOffset: '2' });
  f.storage.read = read;
  expect(await client.uploadChunk(upload.uploadId, '0', data)).toMatchObject({ replayed: true });
  expect(await client.commitUpload(upload.uploadId)).toMatchObject({ size: '2', digest: digest(data) });
});

it.each([undefined, 'text/plain', 'application/octet-stream'])('rejects upload declarations with content type %s before consuming their body', async contentType => {
  const f = fixture(); let reads = 0; let canceled = false;
  const headers = new Headers({ Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'begin' });
  if (contentType) headers.set('Content-Type', contentType);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new TextEncoder().encode(JSON.stringify({ size: '0', digest: digest(bytes()) }))); controller.close(); },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 });
  const response = await f.server.fetch(new Request('https://upload.test/v1/sessions/s/uploads', {
    method: 'POST', headers, body, duplex: 'half',
  } as RequestInit));
  expect(response.status).toBe(415); expect(reads).toBe(0); expect(canceled).toBe(true);
  await expect(f.client().beginUpload({ size: '0', digest: digest(bytes()) }, undefined, 'begin')).resolves.toMatchObject({ state: 'open' });
});

it.each(['truncated', 'corrupt', 'extended'] as const)('finalize verifies actual %s storage bytes rather than the acknowledged count', async change => {
  const f = fixture(); const client = f.client(); const data = bytes(1, 2);
  const upload = await client.beginUpload({ size: '2', digest: digest(data) });
  await client.uploadChunk(upload.uploadId, '0', data);
  f.files.set(upload.uploadId, change === 'truncated' ? bytes(1) : change === 'corrupt' ? bytes(1, 9) : bytes(1, 2, 3));
  await expect(client.commitUpload(upload.uploadId)).rejects.toMatchObject({ status: 409 });
  expect(await client.inspectUpload(upload.uploadId)).toMatchObject({ state: 'open', committedOffset: '2' });
  await expect(client.inspectBlob(upload.uploadId)).rejects.toMatchObject({ status: 404 });
});

it('accepts JSON declaration media types with charset parameters', async () => {
  const f = fixture();
  const response = await f.server.fetch(new Request('https://upload.test/v1/sessions/s/uploads', {
    method: 'POST', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e',
      'Idempotency-Key': 'json', 'Content-Type': 'Application/JSON; charset=utf-8' },
    body: JSON.stringify({ size: '0', digest: digest(bytes()) }),
  }));
  expect(response.status).toBe(200);
});

it('advertises process-local recovery for streaming blob downloads', async () => {
  const f = fixture(); const client = f.client();
  const upload = await client.beginUpload({ size: '0', digest: digest(bytes()) });
  const blob = await client.commitUpload(upload.uploadId);
  const response = await client.readBlob(blob.blobId);
  try { expect(response.headers.get('Upload-Recovery')).toBe('process-local'); }
  finally { await response.body?.cancel(); }
});

it.each(['chunk', 'commit', 'download'] as const)('enforces the retained upload deadline during %s despite newer authentication', async operation => {
  const f = fixture(); const client = f.client();
  const upload = await client.beginUpload({ size: '1', digest: digest(bytes(1)) });
  if (operation !== 'chunk') await client.uploadChunk(upload.uploadId, '0', bytes(1));
  const blob = operation === 'download' ? await client.commitUpload(upload.uploadId) : undefined;
  f.renew(200);
  if (operation === 'chunk') {
    const append = f.storage.append;
    f.storage.append = async (...args) => { await append(...args); f.expire(); };
    await expect(client.uploadChunk(upload.uploadId, '0', bytes(1))).rejects.toMatchObject({ status: 410 });
  } else {
    const read = f.storage.read;
    f.storage.read = async (...args) => { const data = await read(...args); f.expire(); return data; };
    if (operation === 'commit') await expect(client.commitUpload(upload.uploadId)).rejects.toMatchObject({ status: 410 });
    else await expect((await client.readBlob(blob!.blobId)).arrayBuffer()).rejects.toMatchObject({ status: 410 });
  }
  await f.server.sweep();
  expect(f.files.size).toBe(0);
});

it('expires an unread download at its retained deadline without waiting for sweep', async () => {
  vi.useFakeTimers();
  let response: Response | undefined;
  try {
    const f = fixture({ maxConcurrent: 1 }); const client = f.client();
    const upload = await client.beginUpload({ size: '1', digest: digest(bytes(1)) });
    await client.uploadChunk(upload.uploadId, '0', bytes(1));
    const blob = await client.commitUpload(upload.uploadId);
    f.renew(200);
    response = await client.readBlob(blob.blobId);
    await expect(client.beginUpload({ size: '0', digest: digest(bytes()) })).rejects.toMatchObject({ status: 429 });
    f.expire();
    await vi.advanceTimersByTimeAsync(100);
    await expect(response.arrayBuffer()).rejects.toMatchObject({ status: 410 });
    // Expiry drains the download lane; it does not require a consumer pull.
    await expect(client.beginUpload({ size: '0', digest: digest(bytes()) })).resolves.toMatchObject({ state: 'open' });
    await f.server.sweep();
    expect(f.files.size).toBe(0);
  } finally {
    await response?.body?.cancel().catch(() => {});
    vi.useRealTimers();
  }
});

describe('v1 uploads over in-memory HTTP', () => {
  it('cancels a pending source read and drains its iterator without pulling again', async () => {
    const controller = new AbortController(); const reason = new Error('stop source');
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let finish!: (value: IteratorResult<Uint8Array>) => void;
    let returned = false; let pulls = 0;
    const source = { [Symbol.asyncIterator]() { return {
      next() { pulls++; entered(); return new Promise<IteratorResult<Uint8Array>>(resolve => { finish = resolve; }); },
      async return() { returned = true; finish({ done: true, value: undefined }); return { done: true as const, value: undefined }; },
    }; } };
    const pending = fixture().client().upload('u', source, { signal: controller.signal });
    const observed = pending.catch(error => error);
    await started; controller.abort(reason);
    // Cancellation must reach the iterator even while next() is pending.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const canceled = returned;
    if (!returned) finish({ done: true, value: undefined });
    expect(await observed).toBe(reason);
    expect(canceled).toBe(true); expect(pulls).toBe(1);
  });
  it.each(['inspectUpload', 'abortUpload', 'inspectBlob'] as const)('correlates %s metadata with the requested resource', async operation => {
    const value = operation === 'inspectBlob'
      ? { blobId: 'other', size: '0', digest: digest(bytes()) }
      : { uploadId: 'other', size: '0', digest: digest(bytes()), committedOffset: '0', state: 'aborted' };
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: () => 'a', fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e' } }) });
    await expect(client[operation]('requested')).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    { uploadId: 'other' },
    { committedOffset: '0' },
    { committedOffset: '2' },
    { state: 'aborted' },
  ])('rejects an unrelated or false new-write acknowledgement %j', async changes => {
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: () => 'a', fetch: async () => Response.json({ uploadId: 'u', size: '4', digest: digest(bytes(1, 2, 3, 4)),
        committedOffset: '1', state: 'open', ...changes },
      { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }) });
    await expect(client.uploadChunk('u', '0', bytes(1))).rejects.toMatchObject({ status: 502 });
  });
  it('rejects a begin receipt for a different declaration', async () => {
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: () => 'a', fetch: async () => Response.json({ uploadId: 'u', size: '0', digest: digest(bytes()),
        committedOffset: '0', state: 'open' }, { headers: { 'Execution-Epoch': 'e' } }) });
    await expect(client.beginUpload({ size: '1', digest: digest(bytes(1)) })).rejects.toMatchObject({ status: 502 });
  });
  it('does not acquire credentials for an empty chunk or overflowing uint64 range', async () => {
    let acquired = false;
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: () => { acquired = true; return 'a'; },
      fetch: async () => { throw new Error('unexpected transport'); } });
    await expect(client.uploadChunk('u', '0', bytes())).rejects.toMatchObject({ status: 400 });
    await expect(client.uploadChunk('u', '18446744073709551615', bytes(1))).rejects.toMatchObject({ status: 400 });
    expect(acquired).toBe(false);
  });
  it.each([undefined, '2', '01'])('rejects protocol version %s without creating an upload', async version => {
    const f = fixture();
    const headers = new Headers({ Authorization: 'Bearer a', 'Execution-Epoch': 'e',
      'Idempotency-Key': 'version', 'Content-Type': 'application/json' });
    if (version !== undefined) headers.set('Execution-Protocol', version);
    const response = await f.server.fetch(new Request('https://upload.test/v1/sessions/s/uploads', {
      method: 'POST', headers, body: JSON.stringify({ size: '0', digest: digest(bytes()) }),
    }));
    expect(response.status).toBe(400);
    const upload = await f.client().beginUpload({ size: '1', digest: digest(bytes(1)) }, undefined, 'version');
    expect(upload.size).toBe('1');
  });
  it('does not acquire a source iterator after cancellation', async () => {
    const controller = new AbortController(); const reason = new Error('stop');
    controller.abort(reason);
    let acquired = false;
    const source = { [Symbol.asyncIterator]() { acquired = true; throw new Error('unexpected acquisition'); } };
    await expect(fixture().client().upload('u', source, { signal: controller.signal })).rejects.toBe(reason);
    expect(acquired).toBe(false);
  });
  it('validates declarations and offsets before acquiring credentials or sending bytes', async () => {
    let requested = false;
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: () => { requested = true; throw new Error('unexpected credentials'); } });
    await expect(client.beginUpload({ size: '01', digest: digest(bytes()) })).rejects.toMatchObject({ status: 400 });
    await expect(client.uploadChunk('u', '9007199254740993.0', bytes(1))).rejects.toMatchObject({ status: 400 });
    expect(requested).toBe(false);
  });
  it('does not send a request when cancellation races credential acquisition', async () => {
    const controller = new AbortController(); const reason = new Error('stop'); let sent = false;
    const client = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', maxChunkBytes: 4,
      token: async () => { controller.abort(reason); return 'a'; },
      fetch: async () => { sent = true; throw new Error('unexpected request'); } });
    await expect(client.inspectUpload('u', controller.signal)).rejects.toBe(reason);
    expect(sent).toBe(false);
  });
  it('owns downloaded blob chunks before storage reuses its buffer', async () => {
    const f = fixture(); const client = f.client(); const data = bytes(1, 2, 3, 4, 5, 6, 7, 8);
    const upload = await client.beginUpload({ size: '8', digest: digest(data) });
    await client.uploadChunk(upload.uploadId, '0', data.subarray(0, 4));
    await client.uploadChunk(upload.uploadId, '4', data.subarray(4));
    const blob = await client.commitUpload(upload.uploadId);
    const producer = Buffer.alloc(4);
    f.storage.read = async (_id, offset, length) => { producer.set(data.subarray(Number(offset), Number(offset) + length)); return producer.subarray(0, length); };
    const reader = (await client.readBlob(blob.blobId)).body!.getReader();
    try {
      const first = await reader.read(); const second = await reader.read();
      expect(Array.from(first.value!)).toEqual([1, 2, 3, 4]);
      expect(Array.from(second.value!)).toEqual([5, 6, 7, 8]);
    } finally { await reader.cancel(); }
  });
  it('handles empty and exact-limit uploads and only exposes verified blobs', async () => {
    const f = fixture(); const c = f.client();
    for (const data of [bytes(), bytes(0,1,2,3,4,5,6,7)]) {
      const u = await c.beginUpload({ size: String(data.length), digest: digest(data) });
      await expect(c.inspectBlob(u.uploadId)).rejects.toMatchObject({ status: 404 });
      for (let i = 0; i < data.length; i += 4) await c.uploadChunk(u.uploadId, String(i), data.slice(i, i + 4));
      const blob = await c.commitUpload(u.uploadId);
      expect(blob).toMatchObject({ size: String(data.length), digest: digest(data) });
      expect(new Uint8Array(await (await c.readBlob(blob.blobId)).arrayBuffer())).toEqual(data);
      await expect(f.client('other').inspectBlob(blob.blobId)).rejects.toMatchObject({ status: 404 });
    }
    await expect(c.beginUpload({ size: '9', digest: digest(bytes()) })).rejects.toMatchObject({ status: 413 });
  });
  it('rejects reorder, overlaps, corruption and incomplete finalize; distinguishes exact retries', async () => {
    const c = fixture().client(); const data = bytes(1,2,3,4);
    const u = await c.beginUpload({ size: '4', digest: digest(data) });
    await expect(c.uploadChunk(u.uploadId, '2', bytes(3,4))).rejects.toMatchObject({ status: 409 });
    expect((await c.uploadChunk(u.uploadId, '0', bytes(1,2))).replayed).toBe(false);
    expect((await c.uploadChunk(u.uploadId, '0', bytes(1,2))).replayed).toBe(true);
    await expect(c.uploadChunk(u.uploadId, '0', bytes(1,9))).rejects.toMatchObject({ status: 409 });
    await expect(c.uploadChunk(u.uploadId, '1', bytes(2,3))).rejects.toMatchObject({ status: 409 });
    await expect(c.commitUpload(u.uploadId)).rejects.toMatchObject({ status: 409 });
    await c.uploadChunk(u.uploadId, '2', bytes(9,4));
    expect(await c.uploadChunk(u.uploadId, '0', bytes(1,2))).toMatchObject({ committedOffset: '4', replayed: true });
    await expect(c.commitUpload(u.uploadId)).rejects.toMatchObject({ status: 409 });
    await c.abortUpload(u.uploadId);
    expect((await c.inspectUpload(u.uploadId)).state).toBe('aborted');
  });
  it('preserves uint64 sizes without allocating them', async () => {
    const c = fixture({ maxBlobBytes: 18446744073709551615n }).client();
    const u = await c.beginUpload({ size: '9007199254740993', digest: digest(bytes()) });
    expect(u.size).toBe('9007199254740993');
    await expect(c.uploadChunk(u.uploadId, '9007199254740993', bytes(1))).rejects.toMatchObject({ status: 409 });
    for (const size of ['18446744073709551616', '01', '-1', '1e3']) {
      await expect(c.beginUpload({ size, digest: digest(bytes()) })).rejects.toMatchObject({ status: 400 });
    }
  });
  it('checks auth on resume and expires storage', async () => {
    const f = fixture(); const c = f.client();
    const u = await c.beginUpload({ size: '2', digest: digest(bytes(1,2)) });
    await c.uploadChunk(u.uploadId, '0', bytes(1));
    expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('1');
    await expect(f.client('expired').inspectUpload(u.uploadId)).rejects.toMatchObject({ status: 401 });
    f.expire();
    await expect(c.inspectUpload(u.uploadId)).rejects.toMatchObject({ status: 401 });
    await f.server.sweep(); expect(f.files.size).toBe(0);
  });
  it('streams sequentially, preserves cancellation and can resume acknowledged chunks', async () => {
    const f = fixture(); const c = f.client(); const controller = new AbortController();
    const reason = new Error('stop');
    const u = await c.beginUpload({ size: '4', digest: digest(bytes(1,2,3,4)) });
    async function* source() { yield bytes(1,2); controller.abort(reason); yield bytes(3,4); }
    await expect(c.upload(u.uploadId, source(), { signal: controller.signal })).rejects.toBe(reason);
    expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('2');
    await c.upload(u.uploadId, (async function* () { yield bytes(3,4); })(), { offset: '2' });
    expect((await c.commitUpload(u.uploadId)).size).toBe('4');
  });
});

it('rejects truncated/oversized/corrupt binary bodies without acknowledging bytes', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '4', digest: digest(bytes(1,2,3,4)) });
  for (const [body, length, hash, status] of [
    [bytes(1), '2', bytes(1), 400], [bytes(1,2,3), '2', bytes(1,2), 413], [bytes(1,2), '2', bytes(9,9), 400],
  ] as const) {
    const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${u.uploadId}/bytes`, {
      method: 'PUT', body, headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': crypto.randomUUID(),
        'Content-Type': 'application/octet-stream', 'Content-Length': length, 'Upload-Offset': '0',
        'Content-Digest': `sha-256=:${createHash('sha256').update(hash).digest('base64')}:` },
    }));
    expect(response.status).toBe(status);
    expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('0');
  }
});

it('binds idempotency keys to request bytes and retains begin recovery only in the same server', async () => {
  const f = fixture(); const c = f.client(); const input = { size: '2', digest: digest(bytes(1,2)) };
  const u = await c.beginUpload(input, undefined, 'begin');
  expect((await c.beginUpload(input, undefined, 'begin')).uploadId).toBe(u.uploadId);
  await expect(c.beginUpload({ ...input, size: '1' }, undefined, 'begin')).rejects.toMatchObject({ status: 409 });
  await c.uploadChunk(u.uploadId, '0', bytes(1), undefined, 'write');
  await expect(c.uploadChunk(u.uploadId, '1', bytes(2), undefined, 'write')).rejects.toMatchObject({ status: 409 });
  expect((await f.client().inspectUpload(u.uploadId)).committedOffset).toBe('1');
});

it('drains a canceled request body and allows retry at the unacknowledged offset', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '2', digest: digest(bytes(1,2)) });
  const controller = new AbortController(); const reason = new Error('cancel transfer');
  let canceled = false; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const body = new ReadableStream<Uint8Array>({ pull() { entered(); }, cancel() { canceled = true; } });
  const pending = f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${u.uploadId}/bytes`, {
    method: 'PUT', body, duplex: 'half', signal: controller.signal,
    headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'chunk',
      'Content-Type': 'application/octet-stream', 'Content-Length': '2', 'Upload-Offset': '0',
      'Content-Digest': `sha-256=:${createHash('sha256').update(bytes(1,2)).digest('base64')}:` },
  } as RequestInit));
  await started; controller.abort(reason);
  await expect(pending).rejects.toBe(reason); expect(canceled).toBe(true);
  expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('0');
  await c.uploadChunk(u.uploadId, '0', bytes(1,2));
});

it('abort interrupts and drains a stalled upload before removing staging', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '2', digest: digest(bytes(1,2)) });
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  const body = new ReadableStream<Uint8Array>({ pull() { entered(); } }, { highWaterMark: 0 });
  const pending = f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${u.uploadId}/bytes`, {
    method: 'PUT', body, duplex: 'half', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'chunk',
      'Content-Type': 'application/octet-stream', 'Content-Length': '2', 'Upload-Offset': '0', 'Content-Digest': 'bad' },
  } as RequestInit));
  await started;
  expect((await c.abortUpload(u.uploadId)).state).toBe('aborted');
  expect((await pending).status).toBe(410);
  await expect(c.uploadChunk(u.uploadId, '0', bytes(1,2))).rejects.toMatchObject({ status: 409 });
});

it('enforces backpressure, download range and cancellation before another storage read', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '4', digest: digest(bytes(1,2,3,4)) });
  await c.uploadChunk(u.uploadId, '0', bytes(1,2,3,4)); const b = await c.commitUpload(u.uploadId);
  let reads = 0; const original = f.storage.read;
  f.storage.read = async (...args) => { reads++; return original(...args); };
  const response = await c.readBlob(b.blobId, { start: '1', end: '2' });
  expect(reads).toBe(0); expect(response.status).toBe(206);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes(2,3)); expect(reads).toBe(1);
  const unread = await c.readBlob(b.blobId); await unread.body!.cancel(); expect(reads).toBe(1);
  await expect(c.readBlob(b.blobId, { start: '4' })).rejects.toMatchObject({ status: 416 });
});

it('keeps the whole blob digest distinct from partial response content', async () => {
  const f = fixture(); const client = f.client(); const data = bytes(1, 2, 3, 4);
  const upload = await client.beginUpload({ size: '4', digest: digest(data) });
  await client.uploadChunk(upload.uploadId, '0', data);
  const blob = await client.commitUpload(upload.uploadId);
  const wholeDigest = `sha-256=:${createHash('sha256').update(data).digest('base64')}:`;
  const read = vi.spyOn(f.storage, 'read');
  const partial = await client.readBlob(blob.blobId, { start: '1', end: '2' });
  expect(read).not.toHaveBeenCalled();
  expect(partial.headers.get('Repr-Digest')).toBe(wholeDigest);
  expect(partial.headers.has('Content-Digest')).toBe(false);
  expect(partial.headers.get('Content-Range')).toBe('bytes 1-2/4');
  expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes(2, 3));
  const whole = await client.readBlob(blob.blobId);
  expect(whole.headers.get('Repr-Digest')).toBe(wholeDigest);
  expect(whole.headers.get('Content-Digest')).toBe(wholeDigest);
  expect(new Uint8Array(await whole.arrayBuffer())).toEqual(data);
});

it('retires unread downloads on request cancellation without leaking concurrency', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await c.uploadChunk(u.uploadId, '0', bytes(1)); const b = await c.commitUpload(u.uploadId);
  const controller = new AbortController();
  const response = await c.readBlob(b.blobId, undefined, controller.signal);
  controller.abort(new Error('consumer left'));
  await Promise.resolve();
  const again = await c.readBlob(b.blobId);
  await again.body!.cancel(); await response.body!.cancel().catch(() => {});
});

it('stops admission while abort storage cleanup is pending', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  let started!: () => void; const entered = new Promise<void>(r => { started = r; });
  let finish!: () => void; const drain = new Promise<void>(r => { finish = r; });
  f.storage.remove = async () => { started(); await drain; };
  const abort = c.abortUpload(u.uploadId); await entered;
  const write = c.uploadChunk(u.uploadId, '0', bytes(1));
  await expect(write).rejects.toMatchObject({ status: 410 });
  finish(); await abort;
});

it('materialization admission verifies handle metadata and scope, never staging IDs', async () => {
  const f = fixture(); const c = f.client(); const input = { size: '1', digest: digest(bytes(1)) };
  const p = { tenantId: 'Bearer a', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 100, sessionExpiresAt: 100 };
  const u = await c.beginUpload(input);
  expect(() => f.server.resolveBlob(p, { ...input, blobId: u.uploadId })).toThrow();
  await c.uploadChunk(u.uploadId, '0', bytes(1)); const blob = await c.commitUpload(u.uploadId);
  expect(f.server.resolveBlob(p, blob).storageId).toBe(u.uploadId);
  expect(() => f.server.resolveBlob({ ...p, tenantId: 'other' }, blob)).toThrow();
  expect(() => f.server.resolveBlob(p, { ...blob, size: '2' })).toThrow();
  expect(() => f.server.resolveBlob(p, { ...blob, digest: '0'.repeat(64) })).toThrow();
});

it('cancels rejected bodies before reading or allocating them', async () => {
  const f = fixture(); const c = f.client(); const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  let canceled = false; let reads = 0;
  const body = new ReadableStream<Uint8Array>({ pull() { reads++; }, cancel() { canceled = true; } }, { highWaterMark: 0 });
  const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${u.uploadId}/bytes`, {
    method: 'PUT', body, duplex: 'half', headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'large',
      'Content-Type': 'application/octet-stream', 'Content-Length': '9007199254740993', 'Upload-Offset': '0', 'Content-Digest': 'bad' },
  } as RequestInit));
  expect(response.status).toBe(413); expect(reads).toBe(0); expect(canceled).toBe(true);
});

it('credential renewal reuses acknowledged chunks within the session lease', async () => {
  const f = fixture({ sessionExpiresAt: 200 }); const c = f.client();
  const u = await c.beginUpload({ size: '2', digest: digest(bytes(1,2)) });
  await c.uploadChunk(u.uploadId, '0', bytes(1));
  f.expire(); await expect(c.inspectUpload(u.uploadId)).rejects.toMatchObject({ status: 401 });
  await f.server.sweep(); f.renew();
  expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('1');
  await c.uploadChunk(u.uploadId, '1', bytes(2)); expect((await c.commitUpload(u.uploadId)).size).toBe('2');
});

it('keeps admission closed when abort cleanup fails and retries cleanup on sweep', async () => {
  const f = fixture(); const c = f.client(); const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await c.uploadChunk(u.uploadId, '0', bytes(1));
  const remove = f.storage.remove; let fail = true;
  f.storage.remove = async id => { if (fail) throw new Error('unavailable'); await remove(id); };
  await expect(c.abortUpload(u.uploadId)).rejects.toMatchObject({ status: 503 });
  await expect(c.commitUpload(u.uploadId)).rejects.toMatchObject({ status: 410 });
  fail = false; await f.server.sweep(); expect(f.files.size).toBe(0);
});

it('abort is idempotent and stays inspectable', async () => {
  const c = fixture().client(); const u = await c.beginUpload({ size: '0', digest: digest(bytes()) });
  await c.abortUpload(u.uploadId); await c.abortUpload(u.uploadId);
  expect((await c.inspectUpload(u.uploadId)).state).toBe('aborted');
});

it('does not advertise recovery authority after restart even when staged and verified bytes survive', async () => {
  const f = fixture(); const client = f.client();
  const pending = await client.beginUpload({ size: '2', digest: digest(bytes(1, 2)) });
  await client.uploadChunk(pending.uploadId, '0', bytes(1));
  const complete = await client.beginUpload({ size: '1', digest: digest(bytes(3)) });
  await client.uploadChunk(complete.uploadId, '0', bytes(3));
  const blob = await client.commitUpload(complete.uploadId);
  const principal = { tenantId: 'Bearer a', principalId: 'p', sessionId: 's', epoch: 'e', expiresAt: 100, sessionExpiresAt: 100 };
  const restarted = createUploadServer({ storage: f.storage, now: () => 0, authenticate: async () => principal,
    limits: { maxBlobBytes: 8n, maxReservedBytes: 32n, maxChunkBytes: 4, maxConcurrent: 2, maxUploads: 8, maxChunks: 8 } });
  const recovered = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 4,
    fetch: async (url, init) => restarted.fetch(new Request(url, init)) });
  expect(f.files.get(pending.uploadId)).toEqual(bytes(1));
  expect(f.files.get(complete.uploadId)).toEqual(bytes(3));
  await expect(recovered.inspectUpload(pending.uploadId)).rejects.toMatchObject({ status: 404 });
  await expect(recovered.uploadChunk(pending.uploadId, '1', bytes(2))).rejects.toMatchObject({ status: 404 });
  await expect(recovered.commitUpload(pending.uploadId)).rejects.toMatchObject({ status: 404 });
  await expect(recovered.inspectBlob(blob.blobId)).rejects.toMatchObject({ status: 404 });
  await expect(recovered.readBlob(blob.blobId)).rejects.toMatchObject({ status: 404 });
  expect(() => restarted.resolveBlob(principal, blob)).toThrow();
  // Reconnecting to the original owner retains its acknowledged prefix.
  expect((await client.inspectUpload(pending.uploadId)).committedOffset).toBe('1');
  const response = await client.readBlob(blob.blobId);
  expect(response.headers.get('Upload-Recovery')).toBe('process-local');
  await response.body!.cancel();
});

it('refuses unversioned numeric/unknown control fields and bounds response bodies', async () => {
  let payload: unknown = { uploadId: 'u', size: 9007199254740992, digest: digest(bytes()), committedOffset: '0', state: 'open' };
  let oversized = false; let canceled = false;
  const c = createUploadClient({ baseUrl: 'https://upload.test', sessionId: 's', epoch: 'e', token: () => 'a', maxChunkBytes: 4,
    fetch: async () => oversized ? new Response(new ReadableStream({
      pull(target) { target.enqueue(new Uint8Array(4096)); }, cancel() { canceled = true; },
    }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'e' } })
      : Response.json(payload, { headers: { 'Execution-Epoch': 'e' } }),
  });
  await expect(c.inspectUpload('u')).rejects.toMatchObject({ status: 502 });
  payload = { uploadId: 'u', size: '0', digest: digest(bytes()), committedOffset: '0', state: 'open', unknown: true };
  await expect(c.inspectUpload('u')).rejects.toMatchObject({ status: 502 });
  oversized = true;
  await expect(c.inspectUpload('u')).rejects.toMatchObject({ status: 502 }); expect(canceled).toBe(true);
});

it('bounds concurrent bodies and drains expired unread downloads', async () => {
  const f = fixture(); const c = f.client();
  const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  const other = await c.beginUpload({ size: '1', digest: digest(bytes(2)) });
  let started = 0; let ready!: () => void; const entered = new Promise<void>(r => { ready = r; });
  const controllers = [new AbortController(), new AbortController()];
  const pending = [u, other].map((upload, i) => f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${upload.uploadId}/bytes`, {
    method: 'PUT', duplex: 'half', signal: controllers[i].signal,
    body: new ReadableStream({ pull() { if (++started === 2) ready(); } }, { highWaterMark: 0 }),
    headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'chunk',
      'Content-Type': 'application/octet-stream', 'Content-Length': '1', 'Upload-Offset': '0', 'Content-Digest': 'bad' },
  } as RequestInit)).catch(error => error));
  await entered;
  await expect(c.beginUpload({ size: '0', digest: digest(bytes()) })).rejects.toMatchObject({ status: 429 });
  controllers.forEach(controller => controller.abort()); await Promise.all(pending);
  await c.uploadChunk(u.uploadId, '0', bytes(1)); const blob = await c.commitUpload(u.uploadId);
  const unread = await c.readBlob(blob.blobId);
  f.expire(); await f.server.sweep(); expect(f.files.size).toBe(0);
  await expect(unread.arrayBuffer()).rejects.toMatchObject({ status: 410 });
});

it.each(['Uint8Array', 'Buffer'])('snapshots %s producer bytes before asynchronous hashing and refuses cross-session/epoch access', async kind => {
  const f = fixture(); const c = f.client(); const data = kind === 'Buffer' ? Buffer.from([1,2]) : bytes(1,2);
  const u = await c.beginUpload({ size: '2', digest: digest(data) });
  const write = c.uploadChunk(u.uploadId, '0', data); data.fill(9); await write;
  const blob = await c.commitUpload(u.uploadId);
  expect(new Uint8Array(await (await c.readBlob(blob.blobId)).arrayBuffer())).toEqual(bytes(1,2));
  for (const [session, epoch, status] of [['other','e',404], ['s','other',410]] as const) {
    const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/${session}/blobs/${blob.blobId}`, {
      headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': epoch },
    })); expect(response.status).toBe(status);
  }
});

it('reserves cleanup admission even after retry-key capacity is exhausted', async () => {
  const c = fixture().client(); const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  await c.uploadChunk(u.uploadId, '0', bytes(1));
  for (let i = 0; i < 12; i++) {
    try { await c.uploadChunk(u.uploadId, '0', bytes(1)); }
    catch (error) { expect(error).toMatchObject({ status: 429 }); }
  }
  expect((await c.abortUpload(u.uploadId)).state).toBe('aborted');
});

it('reports acknowledged writes when credentials expire after atomic append', async () => {
  const f = fixture({ sessionExpiresAt: 200 }); const c = f.client();
  const u = await c.beginUpload({ size: '1', digest: digest(bytes(1)) });
  const append = f.storage.append;
  f.storage.append = async (...args) => { await append(...args); f.expire(); };
  const response = await f.server.fetch(new Request(`https://upload.test/v1/sessions/s/uploads/${u.uploadId}/bytes`, {
    method: 'PUT', body: bytes(1), headers: { Authorization: 'Bearer a', 'Execution-Protocol': '1', 'Execution-Epoch': 'e', 'Idempotency-Key': 'chunk',
      'Content-Type': 'application/octet-stream', 'Content-Length': '1', 'Upload-Offset': '0',
      'Content-Digest': `sha-256=:${createHash('sha256').update(bytes(1)).digest('base64')}:` },
  }));
  expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ phase: 'accepted', acknowledgedBytes: '1' });
  f.renew(); expect((await c.inspectUpload(u.uploadId)).committedOffset).toBe('1');
});
