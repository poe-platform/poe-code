import {parseWireJson} from './wire-json.js';
import { createHash, randomUUID } from 'node:crypto';
import { digestHeader, uploadByteLength, UploadError, uploadInteger, validateUploadRequest, type BlobHandle, type Upload } from './upload-protocol.js';

/** Trusted storage adapter. Append must atomically publish exactly the supplied
 * bounded bytes or leave the old prefix unchanged, including on cancellation.
 * Read returns an owned buffer no larger than maxBytes. Committed objects must
 * remain immutable. All methods must settle on abort; no pathname authority. */
export interface UploadStorage {
  append(id: string, offset: bigint, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  read(id: string, offset: bigint, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
}
export interface UploadPrincipal {
  tenantId: string; principalId: string; sessionId: string; epoch: string;
  /** Credential deadline; renewing credentials does not discard staged bytes. */
  expiresAt: number;
  /** Session retention deadline, independent of credential expiry. */
  sessionExpiresAt: number;
  /** Trusted owner's retirement signal; never accepted from wire metadata. */
  sessionSignal?: AbortSignal;
}
export interface UploadServerOptions {
  storage: UploadStorage;
  /** Honor the signal to retire credential work on cancellation or shutdown.
   * Late credentials never acquire upload authority. */
  authenticate(request: Request, signal?: AbortSignal): Promise<UploadPrincipal | null>;
  now?: () => number;
  limits: {
    maxBlobBytes: bigint; maxReservedBytes: bigint; maxChunkBytes: number;
    maxConcurrent: number; maxUploads: number; maxChunks: number;
  };
}
interface RecordState {
  upload: Upload;
  scope: string;
  expiresAt: number;
  chunks: { offset: bigint; length: number; digest: string }[];
  keys: Map<string, string>;
  retiring?: Promise<void>;
  cleanupPending?: boolean;
  busy?: { controller: AbortController; done: Promise<void> };
}

/** A process-local admission ledger. Retain this instance across HTTP reconnects.
 * Recreating it loses recovery authority even if the storage survives. No job or
 * process durability is advertised. Call sweep on the deployment lease timer. */
export function createUploadServer(options: UploadServerOptions) {
  const { storage, authenticate } = options;
  const limits = { ...options.limits };
  for (const n of [limits.maxChunkBytes, limits.maxConcurrent, limits.maxUploads, limits.maxChunks]) {
    if (!Number.isSafeInteger(n) || n < 1) throw new TypeError('Invalid upload bound');
  }
  for (const n of [limits.maxBlobBytes, limits.maxReservedBytes]) {
    if (typeof n !== 'bigint' || n < 0n || n > 18446744073709551615n) throw new TypeError('Invalid storage bound');
  }
  const now = options.now ?? Date.now;
  const records = new Map<string, RecordState>();
  const blobs = new Map<string, RecordState>();
  const beginnings = new Map<string, { body: string; record: RecordState }>();
  let reserved = 0n;
  let active = 0;
  let authenticating = 0;
  let removing = 0;
  // One retirement per retained record bounds this queue by maxUploads. Keep
  // cleanup separate from payload lanes so abort can drain an active transfer.
  const removalWaiters: (() => void)[] = [];
  const shutdown = new AbortController();
  const requests=new Set<Promise<void>>();
  let closing:Promise<void>|undefined;
  function check(p: UploadPrincipal, signal?: AbortSignal, record?: RecordState) {
    shutdown.signal.throwIfAborted();
    p.sessionSignal?.throwIfAborted();
    signal?.throwIfAborted();
    if ([p.tenantId, p.principalId, p.sessionId, p.epoch].some(value => typeof value !== 'string' || !value.length)) {
      throw new UploadError(401, 'Invalid authenticated scope');
    }
    if (!Number.isFinite(p.expiresAt) || p.expiresAt <= now()) throw new UploadError(401, 'Authentication expired');
    if (!Number.isFinite(p.sessionExpiresAt) || p.sessionExpiresAt <= now()) throw new UploadError(410, 'Session expired');
    if (record && record.expiresAt <= now()) throw new UploadError(410, 'Upload retention expired');
  }
  function expiryTimer(p: UploadPrincipal, controller: AbortController, record?: RecordState): () => void {
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const deadline = Math.min(p.expiresAt, p.sessionExpiresAt, record?.expiresAt ?? Infinity);
      timer = setTimeout(() => {
        try { check(p, controller.signal, record); schedule(); }
        catch (error) { controller.abort(error); }
      }, Math.min(2147483647, Math.max(0, deadline - now())));
    }
    schedule();
    return () => clearTimeout(timer);
  }
  function scope(p: UploadPrincipal): string { return JSON.stringify([p.tenantId, p.principalId, p.sessionId, p.epoch]); }
  function json(value: unknown, epoch: string, replayed = false): Response {
    return Response.json(value, { headers: { 'Execution-Epoch': epoch, 'Upload-Replayed': String(replayed), 'Upload-Recovery': 'process-local', 'Cache-Control': 'no-store' } });
  }
  function visible(record: RecordState | undefined, p: UploadPrincipal): RecordState {
    if (!record || record.scope !== scope(p)) throw new UploadError(404, 'Unknown upload or blob');
    if (record.expiresAt <= now() || record.retiring || record.cleanupPending) throw new UploadError(410, 'Upload retention expired or retiring');
    return record;
  }
  function retire(record: RecordState, state: 'aborted' | 'expired'): Promise<void> {
    if (record.retiring) return record.retiring;
    if (record.upload.state === 'aborted' || record.upload.state === 'expired') return Promise.resolve();
    record.cleanupPending = true;
    record.retiring = (async () => {
      record.busy?.controller.abort(new UploadError(410, 'Upload retired'));
      await record.busy?.done;
      if (removing >= limits.maxConcurrent) await new Promise<void>(resolve => { removalWaiters.push(resolve); });
      else removing++;
      try { await storage.remove(record.upload.uploadId); }
      finally {
        // Hand the occupied lane directly to its next owner, including after a
        // failed removal. Caller cancellation cannot discard admitted cleanup.
        const next = removalWaiters.shift();
        if (next) next();
        else removing--;
      }
      reserved -= BigInt(record.upload.size);
      if (record.upload.blobId) blobs.delete(record.upload.blobId);
      record.upload.state = state;
      record.chunks = [];
      record.cleanupPending = false;
    })().finally(() => { record.retiring = undefined; });
    return record.retiring;
  }
  async function sweep() {
    const failures: unknown[] = [];
    for (const [id, record] of records) {
      if (record.expiresAt > now() && !record.cleanupPending) continue;
      try {
        await retire(record, 'expired');
        records.delete(id);
        for (const [key, value] of beginnings) if (value.record === record) beginnings.delete(key);
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Upload expiry retirement failed');
  }
  async function boundedBody(request: Request, max: number, exact: number | undefined, signal: AbortSignal): Promise<Uint8Array> {
    const reader = request.body?.getReader();
    if (!reader) {
      if (exact && exact > 0) throw new UploadError(400, 'Truncated body');
      return new Uint8Array();
    }
    const output = new Uint8Array(exact ?? max);
    let length = 0;
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      for (;;) {
        const result = await reader.read();
        signal.throwIfAborted();
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) throw new UploadError(400, 'Binary upload chunk required');
        if (uploadByteLength(result.value) > output.length - length) throw new UploadError(413, 'Body exceeds admitted length');
        output.set(result.value, length); length += uploadByteLength(result.value);
      }
      if (exact !== undefined && length !== exact) throw new UploadError(400, 'Truncated body');
      return output.subarray(0, length);
    } finally {
      signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => {}); reader.releaseLock();
    }
  }
  async function locked<T>(record: RecordState, request: Request, p: UploadPrincipal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (record.busy || active >= limits.maxConcurrent) throw new UploadError(429, 'Upload concurrency limit');
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, shutdown.signal, ...(p.sessionSignal ? [p.sessionSignal] : [])]);
    let settle!: () => void;
    record.busy = { controller, done: new Promise<void>(resolve => { settle = resolve; }) };
    active++;
    const stopTimer = expiryTimer(p, controller, record);
    try { check(p, signal, record); return await work(signal); }
    finally { stopTimer(); record.busy = undefined; active--; settle(); }
  }
  function bindKey(record: RecordState, key: string, body: string) {
    const previous = record.keys.get(key);
    if (previous !== undefined && previous !== body) throw new UploadError(409, 'Idempotency key conflict');
    // A retained finalize attempt occupies its reserved slot even when the
    // upload is incomplete. Later chunks must still have their original budget.
    // Additional finalize keys share the ordinary budget; abort keeps its reserve.
    const capacity = limits.maxChunks + (body === 'abort' ? 2
      : body === 'commit' || [...record.keys.values()].includes('commit') ? 1 : 0);
    if (previous === undefined && record.keys.size >= capacity) throw new UploadError(429, 'Idempotency retention limit');
    record.keys.set(key, body);
  }
  async function fetch(request: Request): Promise<Response> {
    let releaseRequest!:()=>void;
    const drained=new Promise<void>(resolve=>{releaseRequest=resolve;});requests.add(drained);
    let epoch = '';
    let acknowledgedBytes: string | undefined;
    let accepted = false;
    try {
      if(shutdown.signal.aborted)throw new UploadError(503,'Upload server is retiring');
      const url = new URL(request.url);
      const path = url.pathname.split('/');
      if (url.search || path[1] !== 'v1' || path[2] !== 'sessions' || path.length < 5 || path.length > 7) throw new UploadError(404, 'Unknown upload endpoint');
      // Bound credential work independently of payload lanes so an upload body
      // can still be interrupted by an authenticated abort request.
      if (authenticating >= limits.maxConcurrent) throw new UploadError(429, 'Authentication concurrency limit');
      const admissionSignal = AbortSignal.any([request.signal, shutdown.signal]);
      admissionSignal.throwIfAborted();
      authenticating++;
      let abort!: () => void;
      let authenticated: UploadPrincipal | null;
      try {
        const canceled = new Promise<never>((_, reject) => {
          abort = () => reject(admissionSignal.reason);
          admissionSignal.addEventListener('abort', abort, { once: true });
        });
        const credentials = (async () => {
          try { return await authenticate(request, admissionSignal); }
          // An uncooperative host callback still occupies its admission slot
          // until it settles; canceling callers cannot accumulate hidden work.
          finally { authenticating--; }
        })();
        authenticated = await Promise.race([credentials, canceled]);
        admissionSignal.throwIfAborted();
      } finally {
        admissionSignal.removeEventListener('abort', abort);
      }
      if (!authenticated) throw new UploadError(401, 'Authentication required');
      // Authentication returns borrowed host state. Bind this request before any
      // asynchronous body/storage operation can replace its authority or lease.
      const p = { ...authenticated };
      check(p, request.signal); epoch = p.epoch;
      if (path[3] !== encodeURIComponent(p.sessionId)) throw new UploadError(404, 'Unknown session');
      if (request.headers.get('Execution-Epoch') !== p.epoch) throw new UploadError(410, 'Session epoch expired');
      if (request.headers.get('Execution-Protocol') !== '1') throw new UploadError(400, 'Upload protocol v1 required');
      let key = '';
      if (request.method !== 'GET') {
        key = request.headers.get('Idempotency-Key') ?? '';
        if (!key || key.length > 256) throw new UploadError(400, 'Idempotency-Key required');
      }
      if (path[4] === 'uploads' && path.length === 5 && request.method === 'POST') {
        const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') throw new UploadError(415, 'JSON declaration required');
        if (active >= limits.maxConcurrent) throw new UploadError(429, 'Upload concurrency limit');
        active++;
        let body: string;
        const controller = new AbortController();
        const signal = AbortSignal.any([request.signal, controller.signal, shutdown.signal, ...(p.sessionSignal ? [p.sessionSignal] : [])]);
        const stopTimer = expiryTimer(p, controller);
        try { body = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(request, 1024, undefined, signal)); }
        finally { stopTimer(); active--; }
        check(p, request.signal);
        const input: unknown = parseWireJson(body);
        validateUploadRequest(input);
        const beginKey = JSON.stringify([scope(p), key]);
        const previous = beginnings.get(beginKey);
        if (previous) {
          if (previous.body !== body) throw new UploadError(409, 'Idempotency key conflict');
          return json(visible(previous.record, p).upload, epoch, true);
        }
        const size = BigInt(input.size);
        if (size > limits.maxBlobBytes || size > limits.maxReservedBytes - reserved) throw new UploadError(413, 'Blob storage limit');
        if (records.size >= limits.maxUploads) throw new UploadError(429, 'Upload record limit');
        const record: RecordState = { upload: { ...input, uploadId: randomUUID(), committedOffset: '0', state: 'open' },
          scope: scope(p), expiresAt: p.sessionExpiresAt, chunks: [], keys: new Map() };
        records.set(record.upload.uploadId, record); beginnings.set(beginKey, { body, record }); reserved += size;
        return json(record.upload, epoch);
      }
      if (path[4] === 'blobs' && request.method === 'GET') {
        const record = visible(blobs.get(path[5]), p);
        const blob: BlobHandle = { blobId: record.upload.blobId!, size: record.upload.size, digest: record.upload.digest };
        if (path.length === 6) return json(blob, epoch);
        if (path[6] !== 'bytes') throw new UploadError(404, 'Unknown blob endpoint');
        if (active >= limits.maxConcurrent || record.busy) throw new UploadError(429, 'Upload concurrency limit');
        const size = BigInt(blob.size);
        let start = 0n; let end = size;
        const range = request.headers.get('Range');
        if (range) {
          const parts = range.startsWith('bytes=') ? range.slice(6).split('-') : [];
          if (parts.length !== 2) throw new UploadError(416, 'Unsupported range');
          start = uploadInteger(parts[0]); end = parts[1] ? uploadInteger(parts[1]) + 1n : size;
          if (start >= size || end <= start) throw new UploadError(416, 'Unsatisfiable range');
          if (end > size) end = size;
        }
        const controller = new AbortController();
        const signal = AbortSignal.any([request.signal, controller.signal, shutdown.signal, ...(p.sessionSignal ? [p.sessionSignal] : [])]);
        let settle!: () => void;
        record.busy = { controller, done: new Promise<void>(resolve => { settle = resolve; }) }; active++;
        let released = false;
        let pending: Promise<void> | undefined;
        let target: ReadableStreamDefaultController<Uint8Array>;
        const stopTimer = expiryTimer(p, controller, record);
        const release = () => {
          if (!released) {
            released = true; stopTimer(); signal.removeEventListener('abort', aborted);
            record.busy = undefined; active--; settle();
          }
        };
        const aborted = () => {
          if (released) return;
          target.error(signal.reason);
          if (pending) void pending.finally(release);
          else release();
        };
        const length = end - start;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) { target = streamController; signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted(); },
          pull(target) {
            pending = (async () => {
              try {
                check(p, signal, record);
                if (start === end) { target.close(); release(); return; }
                const count = Number(end - start > BigInt(limits.maxChunkBytes) ? BigInt(limits.maxChunkBytes) : end - start);
                const data = await storage.read(record.upload.uploadId, start, count, signal);
                check(p, signal, record);
                if (!(data instanceof Uint8Array)) throw new UploadError(503, 'Invalid storage read response');
                if (!uploadByteLength(data) || uploadByteLength(data) > count) throw new UploadError(503, 'Stored blob unavailable');
                start += BigInt(uploadByteLength(data)); target.enqueue(new Uint8Array(data));
                if (start === end) { target.close(); release(); }
              } catch (error) { target.error(error); release(); }
            })();
            return pending;
          },
          async cancel(reason) { controller.abort(reason); await pending; release(); },
        }, { highWaterMark: 0 });
        const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(length), 'Execution-Epoch': epoch,
          'Upload-Recovery': 'process-local',
          'Repr-Digest': digestHeader(Uint8Array.from(Buffer.from(blob.digest, 'hex'))), 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
        // The committed digest identifies the entire representation. A partial
        // response has different content; do not claim its bytes match that hash
        // or pre-read the range just to calculate a header before streaming.
        if (!range) headers.set('Content-Digest', headers.get('Repr-Digest')!);
        if (range) headers.set('Content-Range', `bytes ${start}-${end - 1n}/${size}`);
        return new Response(body, { status: range ? 206 : 200, headers });
      }
      if (path[4] !== 'uploads' || !path[5]) throw new UploadError(404, 'Unknown upload endpoint');
      const record = visible(records.get(path[5]), p);
      if (path.length === 6 && request.method === 'GET') return json(record.upload, epoch);
      if (path.length === 6 && request.method === 'DELETE') {
        bindKey(record, key, 'abort');
        if (record.upload.state === 'committed') throw new UploadError(409, 'Committed blob cannot be aborted');
        await retire(record, 'aborted');
        // Cleanup drains even when credentials expire or the caller disconnects.
        // Keep its accepted outcome, then revalidate before returning metadata.
        accepted = true;
        check(p, request.signal, record);
        return json(record.upload, epoch);
      }
      if (path.length !== 7) throw new UploadError(404, 'Unknown upload endpoint');
      if (path[6] === 'bytes' && request.method === 'PUT') {
        return await locked(record, request, p, async signal => {
          if (record.upload.state !== 'open') throw new UploadError(409, 'Upload is not open');
          if (request.headers.get('Content-Type') !== 'application/octet-stream') throw new UploadError(400, 'Binary body required');
          const offset = uploadInteger(request.headers.get('Upload-Offset'));
          const length = uploadInteger(request.headers.get('Content-Length'));
          if (length > BigInt(limits.maxChunkBytes)) throw new UploadError(413, 'Chunk limit exceeded');
          if (length === 0n) throw new UploadError(400, 'Empty chunk; commit zero-length uploads directly');
          const committed = BigInt(record.upload.committedOffset);
          const prior = record.chunks.find(chunk => chunk.offset === offset && BigInt(chunk.length) === length);
          if (offset !== committed && !prior) throw new UploadError(409, 'Conflicting or noncontiguous chunk');
          if (offset + length > BigInt(record.upload.size)) throw new UploadError(409, 'Chunk exceeds declared size');
          if (!prior && record.chunks.length >= limits.maxChunks) throw new UploadError(429, 'Chunk record limit');
          const data = await boundedBody(request, limits.maxChunkBytes, Number(length), signal);
          check(p, signal, record);
          const hash = createHash('sha256').update(data).digest();
          const digest = hash.toString('hex');
          if (request.headers.get('Content-Digest') !== digestHeader(hash)) throw new UploadError(400, 'Chunk digest mismatch');
          const chunkBinding = JSON.stringify(['chunk', String(offset), String(length), digest]);
          if (prior) {
            if (prior.digest !== digest) throw new UploadError(409, 'Conflicting chunk retry');
            let position = 0;
            while (position < uploadByteLength(data)) {
              const stored = await storage.read(record.upload.uploadId, offset + BigInt(position), uploadByteLength(data) - position, signal);
              check(p, signal, record);
              if (!(stored instanceof Uint8Array)) throw new UploadError(503, 'Invalid storage read response');
              // Equality belongs to the admitted bytes, never a backend's
              // replaceable validation method.
              if (!uploadByteLength(stored) || uploadByteLength(stored) > uploadByteLength(data) - position
                || Uint8Array.prototype.some.call(stored, (v, i) => data[position + i] !== v)) throw new UploadError(409, 'Conflicting chunk retry');
              position += uploadByteLength(stored);
            }
            // Rejected overlaps have no mutation to recover. Retain a retry
            // key only after validating it against the acknowledged bytes.
            bindKey(record, key, chunkBinding);
            return json(record.upload, epoch, true);
          }
          bindKey(record, key, chunkBinding);
          await storage.append(record.upload.uploadId, offset, data, signal);
          // Atomic append success is acknowledged state even if cancellation raced.
          record.chunks.push({ offset, length: uploadByteLength(data), digest });
          record.upload.committedOffset = String(offset + length);
          acknowledgedBytes = record.upload.committedOffset;
          check(p, signal, record);
          return json(record.upload, epoch);
        });
      }
      if (path[6] === 'commit' && request.method === 'POST') {
        return await locked(record, request, p, async signal => {
          bindKey(record, key, 'commit');
          if (record.upload.state === 'committed') return json({ blobId: record.upload.blobId, size: record.upload.size, digest: record.upload.digest }, epoch, true);
          if (record.upload.state !== 'open' || record.upload.size !== record.upload.committedOffset) throw new UploadError(409, 'Incomplete upload');
          const hash = createHash('sha256'); const size = BigInt(record.upload.size);
          for (let offset = 0n; offset < size;) {
            const count = Number(size - offset > BigInt(limits.maxChunkBytes) ? BigInt(limits.maxChunkBytes) : size - offset);
            const data = await storage.read(record.upload.uploadId, offset, count, signal);
            check(p, signal, record);
            if (!(data instanceof Uint8Array)) throw new UploadError(503, 'Invalid storage read response');
            if (!uploadByteLength(data) || uploadByteLength(data) > count) throw new UploadError(409, 'Stored length mismatch');
            hash.update(data); offset += BigInt(uploadByteLength(data));
          }
          const extra = await storage.read(record.upload.uploadId, size, 1, signal);
          check(p, signal, record);
          if (!(extra instanceof Uint8Array) || uploadByteLength(extra) > 1) throw new UploadError(503, 'Invalid storage read response');
          if (uploadByteLength(extra) || hash.digest('hex') !== record.upload.digest) throw new UploadError(409, 'Whole blob digest or length mismatch');
          record.upload.state = 'committed'; record.upload.blobId = randomUUID(); blobs.set(record.upload.blobId, record);
          return json({ blobId: record.upload.blobId, size: record.upload.size, digest: record.upload.digest }, epoch);
        });
      }
      throw new UploadError(404, 'Unknown upload endpoint');
    } catch (error) {
      if (request.body && !request.body.locked) await request.body.cancel(error).catch(() => {});
      request.signal.throwIfAborted();
      const status = error instanceof UploadError ? error.status : error instanceof SyntaxError || error instanceof TypeError ? 400 : 503;
      return Response.json({ category: status === 401 || status === 403 ? 'authorization' : status === 503 ? 'unknown' : 'protocol',
        code: status === 503 ? 'unavailable' : 'upload-error', message: 'Upload request failed',
        phase: accepted || acknowledgedBytes !== undefined ? 'accepted' : status === 503 ? 'unknown' : 'notAccepted',
        ...(acknowledgedBytes === undefined ? {} : { acknowledgedBytes }) },
      { status, headers: { 'Execution-Epoch': epoch } });
    } finally {
      // Metadata-only operations never consume payload bytes. Retire their
      // unused transport body on success as well as failure, before shutdown
      // observes this request as drained. Cleanup cannot erase an accepted
      // mutation or the caller's cancellation reason.
      if (request.body && !request.body.locked) await request.body.cancel().catch(() => {});
      requests.delete(drained);releaseRequest();
    }
  }
  return { fetch, sweep,
    /** Trusted session owner stops authentication/admission and aborts its
     * sessionSignal before calling this barrier. Drain active transfers and
     * attempt every scoped removal; failed records retain cleanup ownership. */
    async retireSession(principal: Pick<UploadPrincipal, 'tenantId' | 'principalId' | 'sessionId' | 'epoch'>): Promise<void> {
      const selected = JSON.stringify([principal.tenantId, principal.principalId, principal.sessionId, principal.epoch]);
      const failures: unknown[] = [];
      for (const [id, record] of records) {
        if (record.scope !== selected) continue;
        try {
          await retire(record, 'expired');
          records.delete(id);
          for (const [key, value] of beginnings) if (value.record === record) beginnings.delete(key);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Session upload retirement failed');
    },
    /** Trusted owner shutdown. Retire every admitted storage object, even when
     * a sibling removal fails; repeated calls retain the same cleanup outcome. */
    close():Promise<void>{
      if(closing)return closing;
      shutdown.abort(new UploadError(503,'Upload server is retiring'));
      closing=(async()=>{
        await Promise.all([...requests]);
        const pending = records.values();
        const failures: unknown[] = [];
        // Retire bounded batches without allocating a promise for every retained
        // upload. A failed removal must not stop retirement of sibling blobs.
        await Promise.all(Array.from({ length: Math.min(limits.maxConcurrent, records.size) }, async () => {
          for (let next = pending.next(); !next.done; next = pending.next()) {
            try { await retire(next.value, 'expired'); }
            catch (error) { failures.push(error); }
          }
        }));
        if(failures.length)throw new AggregateError(failures,'Upload server retirement failed');
        records.clear();blobs.clear();beginnings.clear();
      })();void closing.catch(()=>{});return closing;
    },
    /** Trusted admission lookup; returned storage id is never accepted from wire. */
    borrowBlob(principal:UploadPrincipal,blobId:string):{storageId:string;size:bigint;digest:string} {
      check(principal);const record=visible(blobs.get(blobId),principal);
      if(record.upload.state!=='committed')throw new UploadError(409,'Blob is not committed');
      return{storageId:record.upload.uploadId,size:BigInt(record.upload.size),digest:record.upload.digest};
    },
    /** Trusted session owner renews only still-live records in its exact scope. */
    renewSession(principal:UploadPrincipal):void {
      check(principal);
      for(const record of records.values())if(record.scope===scope(principal) && record.expiresAt>now() && !record.retiring && !record.cleanupPending)record.expiresAt=principal.sessionExpiresAt;
    },
    /** Trusted materializer admission. principal comes from authenticate, never
     * from JSON. Returned storage ID is internal and conveys no host path rights. */
    resolveBlob(principal: UploadPrincipal, handle: BlobHandle): { storageId: string; size: bigint; digest: string } {
      check(principal);
      const record = visible(blobs.get(handle.blobId), principal);
      if (record.upload.state !== 'committed') {
        throw new UploadError(409, 'Blob declaration does not match verified bytes');
      }
      if (record.upload.size !== handle.size) throw new UploadError(409, 'Blob size does not match verified bytes', 'wrong-length');
      if (record.upload.digest !== handle.digest) throw new UploadError(409, 'Blob hash does not match verified bytes', 'wrong-hash');
      return { storageId: record.upload.uploadId, size: BigInt(record.upload.size), digest: record.upload.digest };
    },
  };
}

export { createExecutionServer } from './materialization-server.js';
export type { MaterializationServerOptions } from './materialization-server.js';

export { createMediaServer } from './media-server.js';
export type { ExecutionRequest, MediaServerOptions, MediaPrincipal, MediaTool, MediaIsolationDriver, SessionAuthority, PreparedInvocation, InvocationHooks, InvocationBlob } from './media-server.js';
export { createNativeDriver } from './native-driver.js';
export type { NativeIsolationBackend } from './native-driver.js';
export { createNativeLauncher } from './native-process.js';
export {createByteArgvLauncher} from './byte-argv-launcher.js';
export type {ByteArgvLauncherOptions} from './byte-argv-launcher.js';
export { createProcessConnection } from './process-connection.js';
export { createProcessHttpHandler } from './process-http.js';
export type { NativeLauncher, NativeProcess, NativeProcessSpec, ProcessStreams } from './native-process.js';
export { createMediaHttpHandler, createMediaHttpsServer } from './http-server.js';
export type { MediaHttpOptions } from './http-server.js';
export {startMediaService} from './service.js';
export type {MediaServiceOptions} from './service.js';
export { createFileServer } from './files.js';
export type { FileServer, FileScope, FileOpen, RetainedReadFile, FileMetadata } from './files.js';

export { createDiskAdmissionStore } from './admissions.js';
export type { AdmissionStore, AdmissionRecord } from './admissions.js';

export { createJobStateJournal } from './job-state.js';
export type { JobStateEvent } from './job-state.js';
