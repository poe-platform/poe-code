import {parseWireJson} from './wire-json.js';
import { digestHeader, uploadRouteId, uploadByteLength, UploadError, uploadInteger, validateUploadRequest, validateUploadState, type BlobHandle, type Upload, type UploadRequest } from './upload-protocol.js';

async function control(response: Response, kind: 'upload', signal?: AbortSignal, expectedId?: string): Promise<Upload>;
async function control(response: Response, kind: 'blob', signal?: AbortSignal, expectedId?: string): Promise<BlobHandle>;
async function control(response: Response, kind: 'upload' | 'blob', signal?: AbortSignal, expectedId?: string): Promise<Upload | BlobHandle> {
  const reader = response.body?.getReader();
  const abort = () => { void reader?.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!reader) throw new Error('Missing control body');
    const bytes = new Uint8Array(2048);
    let length = 0;
    for (;;) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error('Binary control response required');
      if (uploadByteLength(part.value) > bytes.length - length) throw new Error('Control body limit');
      bytes.set(part.value, length); length += uploadByteLength(part.value);
    }
    const value = parseWireJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))) as Upload & BlobHandle;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid control record');
    const keys = kind === 'blob' ? ['blobId', 'size', 'digest'] : ['uploadId', 'size', 'digest', 'committedOffset', 'state', 'blobId'];
    if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('Unknown control field');
    validateUploadRequest({ size: value.size, digest: value.digest });
    const id = kind === 'blob' ? value.blobId : value.uploadId;
    if (typeof id !== 'string' || !id.length || id.length > 256) throw new Error('Invalid resource ID');
    uploadRouteId(id);
    if (expectedId !== undefined && id !== expectedId) throw new Error('Resource ID mismatch');
    if (kind === 'upload') {
      if (!['open', 'committed', 'aborted', 'expired'].includes(value.state)) throw new Error('Invalid upload state');
      if (value.blobId !== undefined && (typeof value.blobId !== 'string' || !value.blobId.length || value.blobId.length > 256)) throw new Error('Invalid blob ID');
      validateUploadState(value);
    }
    return value;
  } catch {
    signal?.throwIfAborted();
    throw new UploadError(502, 'Invalid or oversized v1 upload control response');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {}); reader?.releaseLock();
  }
}

export interface UploadClientOptions {
  baseUrl: string;
  sessionId: string;
  epoch: string;
  token(): string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  maxChunkBytes: number;
  /** Separate bounds for sources, binary chunks, metadata and pending credentials. Default 1. */
  maxConcurrentUploads?: number;
}
export function createUploadClient(options: UploadClientOptions) {
  // Bind scope and allocation limits once; credential renewal uses the supplier.
  options = { ...options };
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new TypeError('An authenticated HTTPS origin is required');
  if (!Number.isSafeInteger(options.maxChunkBytes) || options.maxChunkBytes < 1) throw new TypeError('Invalid chunk limit');
  const concurrency = options.maxConcurrentUploads ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('Invalid upload concurrency bound');
  let activeUploads = 0;
  let activeSources = 0;
  let authenticating = 0;
  let activeControls = 0;
  let activeRetirements = 0;
  const root = new URL(`/v1/sessions/${uploadRouteId(options.sessionId)}/`, base);
  const transport = options.fetch ?? globalThis.fetch;
  async function request(path: string, init: RequestInit = {}, key?: string): Promise<Response> {
    init.signal?.throwIfAborted();
    if (authenticating >= concurrency) throw new UploadError(429, 'Upload client credential concurrency bound');
    const headers = new Headers(init.headers);
    // Credential renewal may outlive the caller. Abort this admission without
    // allowing a late credential to launch a canceled mutation. Pending host
    // work retains its separate credential slot until it actually settles.
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(init.signal!.reason);
      init.signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      authenticating++;
      const credentials = (async () => {
        try { return await options.token(); }
        finally { authenticating--; }
      })();
      headers.set('Authorization', `Bearer ${await Promise.race([credentials, canceled])}`);
    } finally {
      init.signal?.removeEventListener('abort', abort);
    }
    init.signal?.throwIfAborted();
    headers.set('Execution-Epoch', options.epoch);
    headers.set('Execution-Protocol', '1');
    if (init.method && init.method !== 'GET') headers.set('Idempotency-Key', key ?? crypto.randomUUID());
    let response: Response;
    try { response = await transport(new URL(path, root), { ...init, headers, redirect: 'error' }); }
    catch (error) { init.signal?.throwIfAborted(); throw error; }
    if (init.signal?.aborted) {
      await response.body?.cancel(init.signal.reason).catch(() => {});
      init.signal.throwIfAborted();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new UploadError(response.status, `Upload request failed (${response.status}); inspect before retrying mutations`);
    }
    if (response.headers.get('Execution-Epoch') !== options.epoch) {
      await response.body?.cancel().catch(() => {});
      throw new UploadError(410, 'Upload epoch changed; recovery outcome unknown');
    }
    return response;
  }
  async function metadata<K extends 'upload' | 'blob'>(kind: K, path: string, init: RequestInit = {}, key?: string, expectedId?: string): Promise<K extends 'upload' ? Upload : BlobHandle> {
    init.signal?.throwIfAborted();
    const retirement = init.method === 'DELETE';
    if ((retirement ? activeRetirements : activeControls) >= concurrency) throw new UploadError(429, 'Upload client metadata concurrency bound');
    if (retirement) activeRetirements++;
    else activeControls++;
    try {
      const response = await request(path, init, key);
      const receipt = kind === 'upload'
        ? await control(response, 'upload', init.signal ?? undefined, expectedId)
        : await control(response, 'blob', init.signal ?? undefined, expectedId);
      if (kind === 'upload' && init.method === 'POST') {
        const replay = response.headers.get('Upload-Replayed');
        if (replay !== 'true' && replay !== 'false') throw new UploadError(502, 'Missing or invalid upload creation replay receipt; inspect before recovery');
        validateUploadState(receipt as Upload, replay === 'true');
      }
      return receipt as K extends 'upload' ? Upload : BlobHandle;
    } finally {
      if (retirement) activeRetirements--;
      else activeControls--;
    }
  }
  const client = {
    async beginUpload(input: UploadRequest, signal?: AbortSignal, key?: string): Promise<Upload> {
      signal?.throwIfAborted();
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UploadError(400, 'Invalid upload request');
      const declaration = { ...input };
      validateUploadRequest(declaration);
      const receipt = await metadata('upload', 'uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(declaration), signal }, key);
      if (receipt.size !== declaration.size || receipt.digest !== declaration.digest) throw new UploadError(502, 'Upload receipt declaration mismatch');
      return receipt;
    },
    async inspectUpload(id: string, signal?: AbortSignal): Promise<Upload> {
      return metadata('upload', `uploads/${uploadRouteId(id)}`, { signal }, undefined, id);
    },
    async uploadChunk(id: string, offset: string, data: Uint8Array, signal?: AbortSignal, key?: string): Promise<Upload & { replayed: boolean }> {
      signal?.throwIfAborted();
      const start = uploadInteger(offset);
      if (!(data instanceof Uint8Array)) throw new TypeError('Binary upload chunk required');
      if (uploadByteLength(data) > options.maxChunkBytes) throw new UploadError(413, 'Chunk limit exceeded');
      if (!uploadByteLength(data)) throw new UploadError(400, 'Empty chunk; commit zero-length uploads directly');
      const end = uploadInteger(String(start + BigInt(uploadByteLength(data))));
      if (activeUploads >= concurrency) throw new UploadError(429, 'Upload client concurrency bound');
      activeUploads++;
      try {
        // Snapshot before asynchronous hashing; producers may reuse their buffers.
        // The typed-array constructor copies actual octets without consulting
        // a producer's replaceable iterator or allocating its yielded values.
        const owned = new Uint8Array(data);
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', owned));
        const response = await request(`uploads/${uploadRouteId(id)}/bytes`, { method: 'PUT', signal, body: owned,
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(owned.length),
            'Upload-Offset': offset, 'Content-Digest': digestHeader(hash) } }, key);
        const receipt = await control(response, 'upload', signal, id);
        const replay = response.headers.get('Upload-Replayed');
        const acknowledged = uploadInteger(receipt.committedOffset);
        if (receipt.state !== 'open'
          || (replay !== 'true' && replay !== 'false')
          || acknowledged < end || (replay === 'false' && acknowledged !== end)) {
          throw new UploadError(502, 'Upload chunk acknowledgement mismatch; inspect before retrying');
        }
        return { ...receipt, replayed: replay === 'true' };
      } finally { activeUploads--; }
    },
    /** Source begins at the acknowledged offset. On cancellation, return() must
     * settle any pending next(); opaque uncooperative producers cannot be stopped.
     * No automatic mutation retries. */
    async upload(id: string, source: AsyncIterable<Uint8Array>, input: { offset?: string; signal?: AbortSignal } = {}): Promise<Upload> {
      const { signal } = input;
      signal?.throwIfAborted();
      let offset = uploadInteger(input.offset ?? '0');
      if (activeSources >= concurrency) throw new UploadError(429, 'Upload client source concurrency bound');
      activeSources++;
      try {
        // Borrowed source callbacks may replace public client methods. Retain
        // this transfer's authenticated operations before acquiring its iterator.
        const uploadChunk = client.uploadChunk.bind(client);
        const inspectUpload = client.inspectUpload.bind(client);
        let acknowledged = offset;
        let declaration: UploadRequest | undefined;
        const iterator = source[Symbol.asyncIterator]();
        let pending: Promise<IteratorResult<Uint8Array>> | undefined;
        try {
          for (;;) {
            signal?.throwIfAborted();
            let abort!: () => void;
            const canceled = new Promise<never>((_, reject) => {
              abort = () => reject(signal!.reason);
              signal?.addEventListener('abort', abort, { once: true });
            });
            let part: IteratorResult<Uint8Array>;
            try {
              pending = Promise.resolve(iterator.next());
              part = await Promise.race([pending, canceled]);
              pending = undefined;
            } finally { signal?.removeEventListener('abort', abort); }
            signal?.throwIfAborted();
            if (part.done) break;
            const data = part.value;
            if (!(data instanceof Uint8Array)) throw new TypeError('Binary upload source required');
            for (let i = 0; i < uploadByteLength(data); i += options.maxChunkBytes) {
              // Producer methods and typed-array species may allocate or replace
              // bytes. Copy only this admitted fragment using indexed octets.
              const chunk = new Uint8Array(Math.min(options.maxChunkBytes, uploadByteLength(data) - i));
              for (let j = 0; j < chunk.length; j++) chunk[j] = data[i + j];
              const receipt = await uploadChunk(id, String(offset), chunk, signal);
              if (declaration && (receipt.size !== declaration.size || receipt.digest !== declaration.digest)) {
                throw new UploadError(502, 'Upload declaration changed; inspect before recovery');
              }
              declaration ??= { size: receipt.size, digest: receipt.digest };
              const committed = uploadInteger(receipt.committedOffset);
              if (committed < acknowledged) {
                throw new UploadError(502, 'Upload progress lost; inspect before recovery');
              }
              if (committed > acknowledged) acknowledged = committed;
              offset += BigInt(chunk.length);
            }
          }
        } catch (error) {
          // Cleanup must drain the producer without replacing the local cause.
          try { await iterator.return?.(); } catch { /* Preserve transfer failure. */ }
          await pending?.catch(() => {});
          signal?.throwIfAborted();
          throw error;
        }
        signal?.throwIfAborted();
        const receipt = await inspectUpload(id, signal);
        if (declaration && (receipt.size !== declaration.size || receipt.digest !== declaration.digest)) {
          throw new UploadError(502, 'Upload declaration changed; inspect before recovery');
        }
        if (!['open', 'committed'].includes(receipt.state) || uploadInteger(receipt.committedOffset) < acknowledged) {
          throw new UploadError(502, 'Upload progress lost or retired; inspect before recovery');
        }
        return receipt;
      } finally { activeSources--; }
    },
    async commitUpload(id: string, signal?: AbortSignal, key?: string): Promise<BlobHandle> {
      return metadata('blob', `uploads/${uploadRouteId(id)}/commit`, { method: 'POST', signal }, key);
    },
    async abortUpload(id: string, signal?: AbortSignal, key?: string): Promise<Upload> {
      const receipt = await metadata('upload', `uploads/${uploadRouteId(id)}`, { method: 'DELETE', signal }, key, id);
      if (receipt.state !== 'aborted') throw new UploadError(502, 'Upload abort acknowledgement mismatch; inspect before retrying');
      return receipt;
    },
    async inspectBlob(id: string, signal?: AbortSignal): Promise<BlobHandle> {
      return metadata('blob', `blobs/${uploadRouteId(id)}`, { signal }, undefined, id);
    },
    async readBlob(id: string, input: { start: string; end?: string } | undefined = undefined, signal?: AbortSignal): Promise<Response> {
      const headers = new Headers();
      if (input) {
        // Bind the same exact positions for admission and transmission. Caller
        // accessors must not replace a checked range before its header is built.
        const { start: declaredStart, end: declaredEnd } = input;
        const start = uploadInteger(declaredStart);
        if (declaredEnd !== undefined && uploadInteger(declaredEnd) < start) throw new UploadError(400, 'Invalid blob range');
        headers.set('Range', `bytes=${declaredStart}-${declaredEnd ?? ''}`);
      }
      return request(`blobs/${uploadRouteId(id)}/bytes`, { headers, signal });
    },
  };
  return client;
}
