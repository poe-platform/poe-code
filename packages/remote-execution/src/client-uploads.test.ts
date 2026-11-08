import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createHash } from 'node:crypto';
import { createUploadServer, type UploadServerOptions } from './server.js';

const session = { sessionId: 's', epoch: 'e' };
const declaration = { size: '4', digest: '0'.repeat(64) };

it.each(['start', 'end'] as const)('rejects numeric blob range %s before credential or transport admission', async field => {
  const token = vi.fn(async () => 'token');
  const transport = vi.fn<typeof fetch>(async () => new Response());
  const client = createClient({ baseUrl: 'https://upload.test', token, fetch: transport });
  // A JS number has already lost offset identity by the time it reaches the SDK.
  const rounded = Number(9007199254740993n) as unknown as bigint;
  await expect(client.readBlobRange(session, 'b', field === 'start' ? rounded : 0n,
    field === 'end' ? rounded : undefined)).rejects.toThrow('Blob range offsets must be bigint');
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it.each(['size', 'digest'] as const)('admits and sends one observation of the SDK upload %s', async field => {
  let observations = 0;
  const input = Object.defineProperty({ ...declaration }, field, {
    enumerable: true,
    get() { return ++observations === 1 ? declaration[field] : field === 'size' ? '5' : 'f'.repeat(64); },
  });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(init!.body as string)).toEqual(declaration);
    return Response.json({ ...declaration, uploadId: 'u', committedOffset: '0', state: 'open' },
      { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } });
  });
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token', fetch: transport });
  await expect(client.beginUpload(session, input, 'begin')).resolves.toMatchObject({ uploadId: 'u' });
  expect(observations).toBe(1);
  expect(transport).toHaveBeenCalledOnce();
});

it.each(['transport', 'receipt'] as const)('retains the staging identity after uncertain finalize %s failure', async failure => {
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => {
      if (failure === 'transport') throw new Error('response lost');
      return Response.json({ blobId: 'b', size: 4, digest: declaration.digest },
        { headers: { 'Execution-Epoch': 'e' } });
    },
  });
  await expect(client.commitUpload(session, 'staging', 'finalize')).rejects.toMatchObject({
    phase: 'unknown', recovery: { ...session, operationId: 'staging', operationKey: 'finalize' },
  });
});

it('pins the SDK upload session before asynchronous credential renewal', async () => {
  const identity = { ...session };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('Execution-Epoch')).toBe('e');
    return Response.json({ ...declaration, uploadId: 'u', committedOffset: '0', state: 'open' },
      { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } });
  });
  const client = createClient({ baseUrl: 'https://upload.test', fetch: transport,
    token: async () => { identity.sessionId = 'replacement'; identity.epoch = 'replacement'; return 'token'; } });
  await expect(client.beginUpload(identity, declaration, 'begin')).resolves.toMatchObject({ uploadId: 'u' });
  expect(String(transport.mock.calls[0][0])).toBe('https://upload.test/v1/sessions/s/uploads');
});

it.each(['open', 'committed', 'expired'])('rejects a generic SDK abort receipt that reports %s', async state => {
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, uploadId: 'u', committedOffset: '4', state,
      ...(state === 'committed' ? { blobId: 'b' } : {}),
    }, { headers: { 'Execution-Epoch': 'e' } }) });
  await expect(client.abortUpload(session, 'u', 'abort')).rejects.toMatchObject({
    status: 502, phase: 'unknown', recovery: { ...session, operationId: 'u', operationKey: 'abort' },
  });
});

it.each([
  { committedOffset: '0', state: 'committed', blobId: 'b' },
  { committedOffset: '4', state: 'committed' },
  { committedOffset: '5', state: 'open' },
])('rejects inconsistent generic SDK upload status %j', async fields => {
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, uploadId: 'u', ...fields },
      { headers: { 'Execution-Epoch': 'e' } }) });
  await expect(client.inspectUpload(session, 'u')).rejects.toMatchObject({
    phase: 'unknown', status: 502, recovery: { ...session, operationId: 'u' },
  });
});

it.each([[1, 2], '12'])('rejects nonbinary generic SDK chunks before credentials (%j)', async data => {
  const token = vi.fn(async () => 'token'); const fetch = vi.fn();
  const client = createClient({ baseUrl: 'https://upload.test', token, fetch });
  await expect(client.uploadChunk(session, 'u', 0n, data as unknown as Uint8Array, 'digest', 'key'))
    .rejects.toThrow('Binary upload chunk required');
  expect(token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it.each(['inspectUpload', 'abortUpload', 'inspectBlob'] as const)('rejects unrelated generic SDK %s receipts', async operation => {
  const value = operation === 'inspectBlob'
    ? { ...declaration, blobId: 'other' }
    : { ...declaration, uploadId: 'other', committedOffset: '0', state: 'open' };
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json(value, { headers: { 'Execution-Epoch': 'e' } }) });
  const pending = operation === 'abortUpload' ? client.abortUpload(session, 'requested', 'key')
    : client[operation](session, 'requested');
  await expect(pending)
    .rejects.toMatchObject({ phase: 'unknown', recovery: { ...session, operationId: 'requested' } });
});

it.each(['size', 'digest'] as const)('rejects a generic SDK begin receipt with a different %s', async field => {
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, [field]: field === 'size' ? '5' : 'f'.repeat(64),
      uploadId: 'u', committedOffset: '0', state: 'open' }, { headers: { 'Execution-Epoch': 'e' } }) });
  await expect(client.beginUpload(session, declaration, 'begin'))
    .rejects.toMatchObject({ phase: 'unknown', recovery: { ...session, operationKey: 'begin' } });
});

it.each([
  { uploadId: 'other' },
  { committedOffset: '0' },
  { committedOffset: '2' },
  { state: 'aborted' },
  { replay: undefined },
])('rejects false generic SDK upload acknowledgements %j', async changes => {
  const { replay = 'false', ...fields } = changes;
  const headers = new Headers({ 'Execution-Epoch': 'e' });
  if (!('replay' in changes) || changes.replay !== undefined) headers.set('Upload-Replayed', replay);
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, uploadId: 'u', committedOffset: '1', state: 'open', ...fields }, { headers }) });
  await expect(client.uploadChunk(session, 'u', 0n, Uint8Array.of(1), 'digest', 'key'))
    .rejects.toMatchObject({ phase: 'unknown', recovery: { ...session, operationId: 'u', operationKey: 'key' } });
});

it.each(['false', 'true'])('exposes whether a generic SDK chunk is a retry (%s)', async replay => {
  const client = createClient({ baseUrl: 'https://upload.test', token: async () => 'token',
    fetch: async () => Response.json({ ...declaration, uploadId: 'u', committedOffset: replay === 'true' ? '4' : '1', state: 'open' },
      { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': replay } }) });
  expect(await client.uploadChunk(session, 'u', 0n, Uint8Array.of(1), 'digest', 'key')).toMatchObject({ replayed: replay === 'true' });
});

it.each([ [0n, new Uint8Array()], [18446744073709551615n, Uint8Array.of(1)] ] as const)
  ('rejects empty or overflowing chunk ranges before credentials', async (offset, bytes) => {
    const token = vi.fn(async () => 'token'); const fetch = vi.fn();
    const client = createClient({ baseUrl: 'https://upload.test', token, fetch });
    await expect(client.uploadChunk(session, 'u', offset, bytes, 'digest', 'key')).rejects.toThrow();
    expect(token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

it('runs the generic SDK lifecycle without a media invocation and refuses recovery after ledger loss', async () => {
  const files = new Map<string, Uint8Array>();
  const principal = { tenantId: 't', principalId: 'p', ...session, expiresAt: 1000, sessionExpiresAt: 1000 };
  const options: UploadServerOptions = {
    now: () => 0,
    authenticate: async request => request.headers.get('Authorization') === 'Bearer token' ? principal : { ...principal, tenantId: 'other' },
    limits: { maxBlobBytes: 4n, maxReservedBytes: 8n, maxChunkBytes: 2, maxConcurrent: 2, maxUploads: 4, maxChunks: 4 },
    storage: {
      async append(id, offset, bytes) {
        const prefix = files.get(id) ?? new Uint8Array();
        expect(offset).toBe(BigInt(prefix.length));
        files.set(id, Uint8Array.from([...prefix, ...bytes]));
      },
      async read(id, offset, count) { return (files.get(id) ?? new Uint8Array()).slice(Number(offset), Number(offset) + count); },
      async remove(id) { files.delete(id); },
    },
  };
  let server = createUploadServer(options);
  const clientFor = (token: string) => createClient({ baseUrl: 'https://upload.test', token: async () => token,
    fetch: async (url, init) => server.fetch(new Request(url, init)) });
  const client = clientFor('token'); const data = Uint8Array.of(0, 255, 128, 1);
  const input = { size: '4', digest: createHash('sha256').update(data).digest('hex') };
  const upload = await client.beginUpload(session, input, 'begin');
  const hash = (bytes: Uint8Array) => `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`;
  await client.uploadChunk(session, upload.uploadId, 0n, data.slice(0, 2), hash(data.slice(0, 2)), 'first');
  await expect(client.commitUpload(session, upload.uploadId, 'commit')).rejects.toMatchObject({ status: 409 });
  expect(await client.inspectUpload(session, upload.uploadId)).toMatchObject({ committedOffset: '2' });
  expect(await client.uploadChunk(session, upload.uploadId, 0n, data.slice(0, 2), hash(data.slice(0, 2)), 'first')).toMatchObject({ replayed: true });
  await client.uploadChunk(session, upload.uploadId, 2n, data.slice(2), hash(data.slice(2)), 'second');
  const blob = await client.commitUpload(session, upload.uploadId, 'commit');
  expect(blob).toMatchObject(input);
  await expect(clientFor('other').inspectBlob(session, blob.blobId)).rejects.toMatchObject({ status: 404 });
  expect(new Uint8Array(await (await client.readBlobRange(session, blob.blobId, 0n)).arrayBuffer())).toEqual(data);
  const empty = await client.beginUpload(session, { size: '0', digest: createHash('sha256').digest('hex') }, 'empty');
  expect(await client.abortUpload(session, empty.uploadId, 'abort')).toMatchObject({ state: 'aborted' });
  server = createUploadServer(options);
  await expect(client.inspectUpload(session, upload.uploadId)).rejects.toMatchObject({ status: 404 });
  await expect(client.inspectBlob(session, blob.blobId)).rejects.toMatchObject({ status: 404 });
  expect(files.size).toBe(1);
});


it.each([
  Number(9007199254740993n),
  { toString: () => '9007199254740993', valueOf: () => 0n },
])('rejects non-bigint chunk positions before credentials or transport (%j)', async offset => {
  const token = vi.fn(async () => 'token');
  const transport = vi.fn<typeof fetch>(async () => Response.json({
    ...declaration, uploadId: 'u', committedOffset: '1', state: 'open',
  }, { headers: { 'Execution-Epoch': 'e', 'Upload-Replayed': 'false' } }));
  const client = createClient({ baseUrl: 'https://upload.test', token, fetch: transport });
  await expect(client.uploadChunk(session, 'u', offset as unknown as bigint, Uint8Array.of(1), 'digest', 'key'))
    .rejects.toThrow('Upload chunk offset must be bigint');
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
