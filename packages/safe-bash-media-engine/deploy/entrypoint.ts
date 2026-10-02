import { createClient, createContainerExecutionDriver, createRemoteExecutionRoute, hostingOperation } from '@poe-code/remote-execution';
import { createWorkerShell, type WorkerRuntime } from './composition.js';
import { createWorkerTransport } from './transport.js';
import { boundedTransfer } from '../../remote-execution/src/hosting-stream.js';

// Shared across factories: the deployment constructs a factory per request.
// Credits include admission and retirement, not just response construction.
let liveCommands = 0;
let liveRemoteTransfers = 0;
let liveRemoteControls = 0;
let liveCommandAuthentications = 0;

// Scheduling only: the forwarding route and server still authenticate every
// operation. Keep receipt/retirement traffic independent of unread DATA.
function isRemoteControl(request: Request, url: URL): boolean {
  const path = url.pathname.split('/').slice(1);
  if (path[1] !== 'sessions' || !path[2] || url.search) return false;
  if (request.method === 'DELETE') return path.length === 3 ||
    path.length === 5 && ['uploads', 'files'].includes(path[3]!) && !!path[4];
  if (request.method !== 'POST') return false;
  return path.length === 4 && path[3] === 'lease' ||
    path.length === 6 && path[3] === 'jobs' && !!path[4] && ['cancel', 'signal'].includes(path[5]!) ||
    path.length === 8 && ['jobs', 'materializations'].includes(path[3]!) && !!path[4] && !!path[6] &&
      (path[5] === 'callbacks' && path[7] === 'result' || path[5] === 'lanes' && path[7] === 'ack') ||
    path.length === 7 && path[3] === 'jobs' && !!path[4] && path[5] === 'resources' && path[6] === 'release';
}

export interface Principal { namespaceId: string; expiresAt: number }
export interface CommandRecord {
  command: string;
  state: 'accepted' | 'terminal' | 'recovery-required';
  stdoutOffset: string;
  stderrOffset: string;
  exitCode?: number;
  nativeJobs?: { sessionId: string; epoch: string; jobId: string }[];
  effectReceipts?: { jobId: string; receiptId: string; digest: string }[];
}
export interface CommandJournal {
  /** Must atomically reject an existing key and enforce per-owner capacity. */
  accept(owner: string, key: string, record: CommandRecord): Promise<boolean>;
  inspect(owner: string, key: string): Promise<CommandRecord | undefined>;
  put(owner: string, key: string, record: CommandRecord): Promise<void>;
}
export interface WorkerOptions {
  authenticate(request: Request): Promise<Principal | null>;
  driver: ReturnType<typeof createContainerExecutionDriver>;
  journal: CommandJournal;
  /** Bind the SAME canonical authority to Shell and native callbacks. Persist
   * accepted native identities/effect receipts incrementally before acknowledging effects.
   * This hook must not import a Node launch or host filesystem implementation. */
  runtime(input: { principal: Principal; client: ReturnType<typeof createClient>; signal: AbortSignal; commandKey: string; persistNative(jobs: NonNullable<CommandRecord['nativeJobs']>, receipts: NonNullable<CommandRecord['effectReceipts']>): Promise<void> }): Promise<WorkerRuntime & { close(): Promise<void> }>;
}
/** Request shells are disposable. The journal never reconstructs shell memory. */
export function createMediaWorker(options: WorkerOptions) {
  async function authenticate(request: Request): Promise<Principal | null> {
    try { return await options.authenticate(request); }
    catch { request.signal.throwIfAborted(); return null; }
  }
  const remote = createRemoteExecutionRoute({ ...options, authenticate, transferLimits: { maxChunkBytes: 65536, maxBytes: 67108864, maxWallClockMs: 300000 } });
  return { async fetch(request: Request, context?: { waitUntil(task: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/')) {
      const control = isRemoteControl(request, url);
      if ((control ? liveRemoteControls : liveRemoteTransfers) >= 4) return new Response('Job transfer capacity exhausted', {
        status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
      });
      if (control) liveRemoteControls++;
      else liveRemoteTransfers++;
      const abort = new AbortController();
      const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(300000)]);
      let released = false;
      function release() {
        if (released) return;
        released = true;
        signal.removeEventListener('abort', release);
        if (control) liveRemoteControls--;
        else liveRemoteTransfers--;
      }
      signal.addEventListener('abort', release, { once: true });
      try {
        const response = await remote.fetch(new Request(request, { signal }));
        // The route enforces byte limits. This zero-prefetch ownership wrapper
        // holds isolate admission until EOF, cancellation, failure or deadline.
        const body = response.body ? boundedTransfer(response.body, undefined, signal, abort, true) : null;
        if (!body) { abort.abort(new Error('Job transfer complete')); release(); }
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        abort.abort(error); release(); throw error;
      }
    }
    if (url.pathname !== '/command' && url.pathname !== '/command/status') return new Response(null, { status: 404 });
    // Admission and authentication consume the same budget as shell execution.
    // Race dependencies that ignore cancellation; a late result is not authority
    // to start work. Authentication is a control request and does not borrow stdin.
    const requestSignal = AbortSignal.any([request.signal, AbortSignal.timeout(300000)]);
    requestSignal.throwIfAborted();
    if (liveCommandAuthentications >= 4) return new Response('Authorization capacity exhausted', {
      status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
    });
    liveCommandAuthentications++;
    // Keep the credit until the actual service operation settles, even when
    // the request's cancellation race has already returned to the caller.
    const authorizationOperation = authenticate(new Request(request.url, {
      method: request.method, headers: request.headers, signal: requestSignal,
    })).finally(() => { liveCommandAuthentications--; });
    const authenticated = await hostingOperation(requestSignal, () => authorizationOperation);
    // Authorization records may be borrowed. Bind all admission, transport and
    // journal operations to the identity and expiry selected for this request.
    const principal = authenticated && Object.freeze({ namespaceId: authenticated.namespaceId, expiresAt: authenticated.expiresAt });
    if (!principal?.namespaceId || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= Date.now()) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const key = request.headers.get('Idempotency-Key');
    if (!key || key.length > 128) return new Response(null, { status: 400 });
    const abort = new AbortController();
    const remaining = principal.expiresAt - Date.now();
    if (remaining <= 0) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const signal = AbortSignal.any([requestSignal, abort.signal, AbortSignal.timeout(Math.min(300000, Math.ceil(remaining)))]);
    if (url.pathname === '/command/status') {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      const record = await hostingOperation(signal, () => options.journal.inspect(principal.namespaceId, key));
      // Accepted is never evidence that its original shell still exists.
      return Response.json(record ? { ...record, recovery: record.state !== 'terminal' ? 'inspect-native-job-and-effects; start-new-shell' : undefined } : null, { status: record ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const command = request.headers.get('Shell-Command');
    if (!command || new TextEncoder().encode(command).length > 8192) return new Response(null, { status: 400 });
    if (liveCommands >= 4) return new Response('Command capacity exhausted', {
      status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
    });
    liveCommands++;
    let retiring = false;
    try {
    const record: CommandRecord = { command, state: 'accepted', stdoutOffset: '0', stderrOffset: '0' };
    if (!await hostingOperation(signal, () => options.journal.accept(principal.namespaceId, key, record))) return new Response(null, { status: 409 });
    if (principal.expiresAt <= Date.now()) {
      record.state = 'recovery-required'; await options.journal.put(principal.namespaceId, key, record);
      return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    // Snapshot before enqueueing so later offsets/receipts cannot mutate an
    // earlier publication. Bound this queue independently of media credits.
    let journalTail = Promise.resolve();
    let pendingRecords = 0;
    let journalFailure: unknown;
    let journalFailed = false;
    function persistRecord() {
      if (pendingRecords >= 4) {
        journalFailed = true;
        journalFailure = new RangeError('Journal credit exhausted');
        return Promise.reject(journalFailure);
      }
      const snapshot = structuredClone(record);
      pendingRecords++;
      const write = journalTail.then(() => options.journal.put(principal!.namespaceId, key!, snapshot));
      journalTail = write.catch(error => { journalFailed = true; journalFailure = error; });
      return write.finally(() => { pendingRecords--; });
    }
    let endpoint: Awaited<ReturnType<WorkerOptions['driver']['acquire']>>;
    try { endpoint = await hostingOperation(signal, () => options.driver.acquire(principal.namespaceId)); }
    catch { record.state = 'recovery-required'; await persistRecord(); return new Response('Container unavailable', { status: 503 }); }
    if (principal.expiresAt <= Date.now()) {
      record.state = 'recovery-required'; await persistRecord();
      return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const authorization = request.headers.get('Authorization') ?? '';
    const client = createClient({ baseUrl: 'https://container.internal', token: async () => authorization.startsWith('Bearer ') ? authorization.slice(7) : '', fetch: createWorkerTransport(endpoint, signal, abort), maxInputBatchBytes: 65536, maxResponseBytes: 65536 });
    let nativePublicationOpen = true;
    let runtime: Awaited<ReturnType<WorkerOptions['runtime']>>;
    try { runtime = await hostingOperation(signal, () => options.runtime({ principal, client, signal, commandKey: key, async persistNative(jobs, receipts) {
      if (!nativePublicationOpen) throw new Error('Native publication admission closed');
      try {
      if (jobs.length > 128 || receipts.length > 128) throw new RangeError('Native receipt limit');
      const nativeJobs = structuredClone(record.nativeJobs ?? []);
      const effectReceipts = structuredClone(record.effectReceipts ?? []);
      for (const job of jobs) {
        if (![job.sessionId, job.epoch, job.jobId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)) throw new TypeError('Invalid native identity');
        const existing = nativeJobs.find(value => value.jobId === job.jobId);
        if (existing && (existing.sessionId !== job.sessionId || existing.epoch !== job.epoch)) throw new Error('Conflicting native identity');
        if (!existing) nativeJobs.push(structuredClone(job));
      }
      for (const receipt of receipts) {
        if (![receipt.jobId, receipt.receiptId, receipt.digest].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256) || !nativeJobs.some(job => job.jobId === receipt.jobId)) throw new TypeError('Invalid effect receipt identity');
        const existing = effectReceipts.find(value => value.jobId === receipt.jobId && value.receiptId === receipt.receiptId);
        if (existing && existing.digest !== receipt.digest) throw new Error('Conflicting effect receipt');
        if (!existing) effectReceipts.push(structuredClone(receipt));
      }
      if (nativeJobs.length > 128 || effectReceipts.length > 128 || new TextEncoder().encode(JSON.stringify({ nativeJobs, effectReceipts })).length > 32768) throw new RangeError('Native receipt limit');
      record.nativeJobs = nativeJobs; record.effectReceipts = effectReceipts;
      await persistRecord();
      } catch (error) {
        // A binding catching publication failure cannot turn conflicting or
        // missing recovery evidence into a successful command.
        journalFailed = true; journalFailure = error;
        throw error;
      }
    } }), lease => lease.close()); }
    catch {
      // A canceled acquisition may still resolve and retire its lease later.
      // It no longer owns authority to publish into this command's journal.
      nativePublicationOpen = false;
      record.state = 'recovery-required'; await persistRecord();
      return new Response('Canonical runtime unavailable', { status: 503 });
    }
    let shell: ReturnType<typeof createWorkerShell>;
    try { shell = createWorkerShell(runtime); }
    catch {
      try { await runtime.close(); }
      finally { nativePublicationOpen = false; record.state = 'recovery-required'; await persistRecord(); }
      return new Response('Canonical shell unavailable', { status: 503 });
    }
    // One chunk credit: writer.write waits for the response reader. The frame
    // prefix is channel byte + uint32 payload length, preserving binary output.
    const stream = new TransformStream<Uint8Array, Uint8Array>(undefined, { highWaterMark: 1 }, { highWaterMark: 0 });
    const writer = stream.writable.getWriter();
    void writer.closed.catch(error => abort.abort(error));
    const stopOutput = () => { void writer.abort(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', stopOutput, { once: true });
    let tail = Promise.resolve();
    let output = 0;
    let pendingOutput = 0;
    let outputFailure: Error | undefined;
    function sink(channel: number) { return { write(bytes: Uint8Array) {
      if (pendingOutput >= 2 || bytes.length > 65536 || bytes.length > 67108864 - output) {
        outputFailure ??= new RangeError(pendingOutput >= 2 ? 'Output credit exhausted' : 'Output byte limit');
        return Promise.reject(outputFailure);
      }
      pendingOutput++;
      output += bytes.length;
      const frame = new Uint8Array(5 + bytes.length); frame[0] = channel; new DataView(frame.buffer).setUint32(1, bytes.length); frame.set(bytes, 5);
      const work = tail.then(async () => { signal.throwIfAborted(); await writer.write(frame); const field = channel === 1 ? 'stdoutOffset' : 'stderrOffset'; record[field] = String(BigInt(record[field]) + BigInt(bytes.length)); await persistRecord(); });
      tail = work; return work.finally(() => { pendingOutput--; });
    } }; }
    const reader = request.body?.getReader();
    let inputRetirement: Promise<void> | undefined;
    const retireInput = () => inputRetirement ??= (async () => {
      signal.removeEventListener('abort', stopInput);
      if (reader) {
        try { await reader.cancel(signal.reason); }
        finally { reader.releaseLock(); }
      }
    })();
    const stopInput = () => { void retireInput().catch(() => {}); };
    signal.addEventListener('abort', stopInput, { once: true });
    if (signal.aborted) stopInput();
    let inputFailure: unknown;
    let inputFailed = false;
    const stdin = (async function* () {
      if (!reader) return;
      let count = 0;
      try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; count += part.value.length; if (part.value.length > 65536 || count > 67108864) throw new RangeError('Input byte limit'); yield part.value; } }
      catch (error) { inputFailed = true; inputFailure = error; throw error; }
      finally { await retireInput(); }
    })();
    const retirement = (async () => {
      try { const result = await shell.exec(command, { stdin, stdout: sink(1), stderr: sink(2), signal }); await tail; signal.throwIfAborted(); if (inputFailed) throw inputFailure; if (outputFailure) throw outputFailure; await journalTail; if (journalFailed) throw journalFailure; record.exitCode = result.exitCode; record.state = 'terminal'; }
      catch { record.state = 'recovery-required'; }
      finally {
        signal.removeEventListener('abort', stopOutput);
        try {
          try { await retireInput(); }
          finally {
            try { await shell.dispose(); }
            finally {
              try { await runtime.close(); }
              finally {
                nativePublicationOpen = false;
                abort.abort(new Error('Command retired'));
              }
            }
          }
          // Cleanup may publish final effects. A swallowed publication failure
          // still invalidates success after execution has already settled.
          await journalTail;
          if (journalFailed) { record.state = 'recovery-required'; delete record.exitCode; }
          await persistRecord(); await writer.close();
        }
        catch (error) { record.state = 'recovery-required'; delete record.exitCode; await persistRecord(); await writer.abort(error).catch(() => {}); }
      }
    })();
    // Give disconnect cleanup the platform's bounded grace period. This does
    // not preserve shell memory or extend jobs beyond Worker lifetime limits.
    const creditedRetirement = retirement.finally(() => { liveCommands--; });
    retiring = true;
    context?.waitUntil(creditedRetirement);
    void creditedRetirement.catch(() => {});
    return new Response(stream.readable, { headers: { 'Content-Type': 'application/vnd.poe.shell-chunks', 'Cache-Control': 'no-store' } });
    } finally {
      if (!retiring) { abort.abort(new Error('Command retired')); liveCommands--; }
    }
  } };
}
