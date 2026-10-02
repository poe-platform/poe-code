import { expect, it, vi } from 'vitest';
import { MemoryFileSystem } from '@poe-platform/safe-bash';
import { createMediaWorker, type CommandRecord, type WorkerOptions } from '../deploy/entrypoint.js';
function fixture() {
  const records = new Map<string, CommandRecord>();
  const acquire = vi.fn(async () => ({ fetch: async () => new Response() }));
  const runtime = vi.fn(async (_input: Parameters<WorkerOptions['runtime']>[0]) => ({ fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute(request: import('./engine.js').MediaEngineRequest) {
    for await (const bytes of request.stdin) await request.stdout.write(bytes);
    return { exitCode: 0 };
  } } }));
  const worker = createMediaWorker({ authenticate: async request => request.headers.get('Authorization') === 'Bearer valid' ? { namespaceId: 'caller-a', expiresAt: Date.now() + 60000 } : null, driver: { acquire, destroy: async () => {} }, runtime, journal: {
    async accept(owner, key, record) { const id = owner + ':' + key; if (records.has(id)) return false; records.set(id, structuredClone(record)); return true; },
    async inspect(owner, key) { return records.get(owner + ':' + key); },
    async put(owner, key, record) { records.set(owner + ':' + key, structuredClone(record)); },
  } });
  return { worker, records, acquire, runtime };
}
function command(bytes: Uint8Array = new Uint8Array()) { return new Request('https://worker/command', { method: 'POST', headers: { Authorization: 'Bearer valid', 'Idempotency-Key': 'one', 'Shell-Command': 'ffmpeg -i pipe:0' }, body: bytes }); }
it('bounds command authentication across factories until the authorization operation retires', async () => {
  const f = fixture();
  const authorizations = Array.from({ length: 4 }, () => Promise.withResolvers<null>());
  const controllers = authorizations.map(() => new AbortController());
  const authenticate = vi.fn(() => authorizations[authenticate.mock.calls.length - 1]!.promise);
  const options = {
    authenticate, driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
    journal: { accept: vi.fn(), inspect: vi.fn(), put: vi.fn() },
  };
  const pending = controllers.map(controller => createMediaWorker(options)
    .fetch(new Request(command(), { signal: controller.signal })).catch(() => null));
  const replacementAuthentication = vi.fn(async () => null);
  const replacement = createMediaWorker({ ...options, authenticate: replacementAuthentication });
  try {
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(4));
    const overflow = await replacement.fetch(command());
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get('Cache-Control')).toBe('no-store');
    expect(replacementAuthentication).not.toHaveBeenCalled();
    // Disconnect cannot return a credit while an uncancelable service still runs.
    controllers[0]!.abort(new Error('disconnect'));
    await pending[0];
    expect((await replacement.fetch(command())).status).toBe(429);
    authorizations[0]!.resolve(null);
    await vi.waitFor(async () => expect((await replacement.fetch(command())).status).toBe(401));
    expect(f.acquire).not.toHaveBeenCalled();
  } finally {
    authorizations.forEach(value => value.resolve(null));
    await Promise.all(pending);
  }
});
it('bounds live job-route streams across factories and returns credits on disconnect and EOF', async () => {
  const first = fixture();
  const second = fixture();
  const cancel = vi.fn();
  first.acquire.mockResolvedValue({ fetch: async () => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })) });
  second.acquire.mockResolvedValue({ fetch: async () => new Response(new Uint8Array([0, 128, 255])) });
  const request = () => new Request('https://worker/v1/jobs/job/stdout', { headers: { Authorization: 'Bearer valid' } });
  const responses: Response[] = [];
  try {
    for (let index = 0; index < 4; index++) responses.push(await first.worker.fetch(request()));
    const overflow = await second.worker.fetch(request());
    if (overflow.status === 200) responses.push(overflow);
    expect(overflow.status).toBe(429);
    expect(second.acquire).not.toHaveBeenCalled();
    await responses.shift()!.body!.cancel('disconnect');
    expect(cancel).toHaveBeenCalledOnce();
    const replacement = await second.worker.fetch(request());
    responses.push(replacement);
    expect(replacement.status).toBe(200);
    const reader = replacement.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([0, 128, 255]));
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
    const afterEOF = await second.worker.fetch(request());
    responses.push(afterEOF);
    expect(afterEOF.status).toBe(200);
  } finally {
    await Promise.all(responses.map(response => response.body?.cancel('fixture retirement')));
  }
});
it('closes retained canonical client authority after command retirement', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  const fetch = vi.fn(async () => new Response(new Uint8Array([42]), { headers: { 'Execution-Epoch': 'epoch' } }));
  f.acquire.mockResolvedValue({ fetch });
  let client!: Parameters<WorkerOptions['runtime']>[0]['client'];
  f.runtime.mockImplementation(input => { client = input.client; return implementation(input); });
  const response = await f.worker.fetch(command());
  await response.arrayBuffer(); // Empty fixture; waits for command retirement.
  await expect(client.readBlobRange({ sessionId: 'session', epoch: 'epoch' }, 'blob', 0n)).rejects.toThrow('Transport interrupted');
  expect(fetch).not.toHaveBeenCalled();
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'terminal', exitCode: 0 });
});

it('bounds canonical client blob reads and retains a swallowed transport failure', async () => {
  const f = fixture();
  const cancel = vi.fn();
  f.acquire.mockResolvedValue({ fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel,
  }, { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'epoch' } }) });
  let failure: unknown;
  f.runtime.mockImplementation(async input => ({
    fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute() {
      const response = await input.client.readBlobRange({ sessionId: 'session', epoch: 'epoch' }, 'blob', 0n);
      try { await response.body!.getReader().read(); }
      catch (error) { failure = error; }
      return { exitCode: 0 };
    } },
  }));
  const retirement: Promise<unknown>[] = [];
  const response = await f.worker.fetch(command(), { waitUntil: task => { retirement.push(task); } });
  await response.body!.getReader().read().catch(() => {});
  await Promise.all(retirement);
  expect(failure).toEqual(new RangeError('Transfer byte limit'));
  expect(cancel).toHaveBeenCalledOnce();
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'recovery-required' });
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});

it('binds canonical client reads to command cancellation even when no signal is supplied', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let producer!: ReadableStreamDefaultController<Uint8Array>;
  f.acquire.mockResolvedValue({ fetch: async () => new Response(new ReadableStream({
    start(controller) { producer = controller; }, cancel,
  },
    { highWaterMark: 0 }), { headers: { 'Execution-Epoch': 'epoch' } }) });
  f.runtime.mockImplementation(async input => ({
    fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute() {
      const response = await input.client.readBlobRange({ sessionId: 'session', epoch: 'epoch' }, 'blob', 0n);
      const read = response.body!.getReader().read();
      entered.resolve();
      await read;
      return { exitCode: 0 };
    } },
  }));
  const retirement: Promise<unknown>[] = [];
  const response = await f.worker.fetch(command(), { waitUntil: task => { retirement.push(task); } });
  await entered.promise;
  await response.body!.cancel('disconnect');
  // Inspect before waiting for retirement, so a missing signal fails promptly.
  try { expect(cancel).toHaveBeenCalledOnce(); }
  finally {
    if (!cancel.mock.calls.length) producer.close();
    await Promise.all(retirement);
  }
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'recovery-required' });
});
it('pins caller identity and expiry before durable admission yields', async () => {
  const f = fixture();
  const principal = { namespaceId: 'caller-a', expiresAt: Date.now() + 60000 };
  const expiresAt = principal.expiresAt;
  const put = vi.fn(async () => {});
  const worker = createMediaWorker({
    authenticate: async () => principal,
    driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
    journal: {
      async accept() {
        // An authorization provider may reuse a borrowed record for another caller.
        principal.namespaceId = 'caller-b';
        principal.expiresAt = Date.now() + 120000;
        return true;
      },
      inspect: async () => undefined, put,
    },
  });
  const response = await worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture; waits for retirement.
  expect(f.acquire).toHaveBeenCalledWith('caller-a');
  expect(f.runtime.mock.calls[0]![0].principal).toEqual({ namespaceId: 'caller-a', expiresAt });
  expect(put).toHaveBeenCalledWith('caller-a', 'one', expect.objectContaining({ state: 'terminal' }));
});
it('rejects native publications after command retirement without mutating recovery metadata', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  let publish!: Parameters<WorkerOptions['runtime']>[0]['persistNative'];
  f.runtime.mockImplementation(async input => {
    publish = input.persistNative;
    return implementation(input);
  });
  const response = await f.worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture; waits for retirement.
  const completed = structuredClone(f.records.get('caller-a:one'));
  await expect(publish([{ sessionId: 's', epoch: 'e', jobId: 'late' }], []))
    .rejects.toThrow('publication admission closed');
  expect(f.records.get('caller-a:one')).toEqual(completed);
});
it('persists native recovery evidence produced during runtime cleanup', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  f.runtime.mockImplementation(async input => ({
    ...await implementation(input),
    async close() {
      await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'cleanup' }],
        [{ jobId: 'cleanup', receiptId: 'receipt', digest: 'digest' }]);
    },
  }));
  const response = await f.worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture; waits for retirement.
  expect(f.records.get('caller-a:one')).toMatchObject({
    state: 'terminal', nativeJobs: [{ sessionId: 's', epoch: 'e', jobId: 'cleanup' }],
    effectReceipts: [{ jobId: 'cleanup', receiptId: 'receipt', digest: 'digest' }],
  });
});
it('does not report terminal success when cleanup swallows an effect receipt conflict', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  f.runtime.mockImplementation(async input => {
    await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'job' }],
      [{ jobId: 'job', receiptId: 'receipt', digest: 'original' }]);
    return {
      ...await implementation(input),
      async close() {
        await input.persistNative([], [{ jobId: 'job', receiptId: 'receipt', digest: 'conflict' }])
          .catch(() => {});
      },
    };
  });
  const retirement: Promise<unknown>[] = [];
  const response = await f.worker.fetch(command(), { waitUntil: task => { retirement.push(task); } });
  await response.body!.getReader().read().catch(() => {});
  await Promise.all(retirement);
  expect(f.records.get('caller-a:one')).toMatchObject({
    state: 'recovery-required',
    effectReceipts: [{ jobId: 'job', receiptId: 'receipt', digest: 'original' }],
  });
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});
it('retires canceled container admission before a resolver settles', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.acquire>>>();
  f.acquire.mockImplementation(() => { entered.resolve(); return pending.promise; });
  const controller = new AbortController();
  let response: Response | undefined;
  const completion = f.worker.fetch(new Request(command(), { signal: controller.signal })).then(value => { response = value; });
  await entered.promise;
  controller.abort(new Error('disconnect'));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try {
    expect(response?.status).toBe(503);
    expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
    expect(f.runtime).not.toHaveBeenCalled();
  } finally {
    pending.resolve({ fetch: async () => new Response() });
    await completion;
  }
});

it('retires canceled runtime admission and closes a late canonical lease', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.runtime>>>();
  const close = vi.fn(async () => {});
  f.runtime.mockImplementation(() => { entered.resolve(); return pending.promise; });
  const controller = new AbortController();
  let response: Response | undefined;
  const completion = f.worker.fetch(new Request(command(), { signal: controller.signal })).then(value => { response = value; });
  await entered.promise;
  controller.abort(new Error('disconnect'));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try {
    expect(response?.status).toBe(503);
    expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
  } finally {
    pending.resolve({ fs: new MemoryFileSystem(), close, engine: { execute: async () => ({ exitCode: 0 }) } });
    await completion;
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  expect(close).toHaveBeenCalledOnce();
});
it('closes native publication authority when runtime admission is canceled', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.runtime>>>();
  const close = vi.fn(async () => {});
  let publish!: Parameters<WorkerOptions['runtime']>[0]['persistNative'];
  f.runtime.mockImplementation(input => {
    publish = input.persistNative;
    entered.resolve();
    return pending.promise;
  });
  const controller = new AbortController();
  const completion = f.worker.fetch(new Request(command(), { signal: controller.signal }));
  await entered.promise;
  controller.abort(new Error('disconnect'));
  expect((await completion).status).toBe(503);
  const recovered = structuredClone(f.records.get('caller-a:one'));
  try {
    await expect(publish([{ sessionId: 's', epoch: 'e', jobId: 'late' }], []))
      .rejects.toThrow('publication admission closed');
    expect(f.records.get('caller-a:one')).toEqual(recovered);
  } finally {
    pending.resolve({ fs: new MemoryFileSystem(), close, engine: { execute: async () => ({ exitCode: 0 }) } });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  }
});
it('registers command retirement with the Worker execution context', async () => {
  const f = fixture();
  const waitUntil = vi.fn();
  const response = await f.worker.fetch(command(), { waitUntil });
  expect(waitUntil).toHaveBeenCalledTimes(1);
  await response.body!.cancel('Disconnected');
  await waitUntil.mock.calls[0]![0];
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'recovery-required' });
});
it('orders concurrent native recovery publications before acknowledging them', async () => {
  const f = fixture();
  let active = 0;
  let maximum = 0;
  const stored: CommandRecord[] = [];
  const worker = createMediaWorker({
    authenticate: async () => ({ namespaceId: 'caller-a', expiresAt: Date.now() + 60000 }),
    driver: { acquire: f.acquire, destroy: async () => {} },
    journal: {
      accept: async () => true, inspect: async () => undefined,
      async put(_owner, _key, record) {
        active++; maximum = Math.max(maximum, active);
        const snapshot = structuredClone(record);
        await Promise.resolve();
        stored.push(snapshot); active--;
      },
    },
    async runtime(input) {
      await Promise.all([
        input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'first' }], []),
        input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'second' }], []),
      ]);
      return f.runtime(input);
    },
  });
  const response = await worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture.
  expect(maximum).toBe(1);
  expect(stored[0]?.nativeJobs?.map(job => job.jobId)).toEqual(['first']);
  expect(stored.at(-1)).toMatchObject({ state: 'terminal', nativeJobs: [{ jobId: 'first' }, { jobId: 'second' }] });
});
it('bounds journal publication credits and retains a swallowed overflow failure', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  let rejected = 0;
  f.runtime.mockImplementation(async input => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      input.persistNative([{ sessionId: 's', epoch: 'e', jobId: String(index) }], [])));
    rejected = results.filter(result => result.status === 'rejected').length;
    return implementation(input);
  });
  const response = await f.worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture.
  expect(rejected).toBe(1);
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'recovery-required' });
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});
it('fails closed on authorization service failure before acquiring a container', async () => {
  const f = fixture();
  const worker = createMediaWorker({
    authenticate: async () => { throw new Error('Authorization unavailable'); },
    driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
    journal: { accept: vi.fn(), inspect: vi.fn(), put: vi.fn() },
  });
  for (const path of ['/command', '/command/status', '/v1/capabilities']) {
    const response = await worker.fetch(new Request('https://worker' + path));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(f.acquire).not.toHaveBeenCalled();
});
it('retires disconnected command authentication even when the service ignores its signal', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<import('../deploy/entrypoint.js').Principal | null>();
  const worker = createMediaWorker({
    authenticate: async () => { entered.resolve(); return authorization.promise; },
    driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
    journal: { accept: vi.fn(), inspect: vi.fn(), put: vi.fn() },
  });
  const controller = new AbortController();
  let retired = false;
  const completion = worker.fetch(new Request(command(), { signal: controller.signal }))
    .catch(() => { retired = true; });
  await entered.promise;
  controller.abort(new Error('disconnect'));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try { expect(retired).toBe(true); }
  finally { authorization.resolve(null); await completion; }
  expect(f.acquire).not.toHaveBeenCalled();
});

it('does not acquire after a disconnected durable admission resolves late', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<boolean>();
  const worker = createMediaWorker({
    authenticate: async () => ({ namespaceId: 'caller-a', expiresAt: Date.now() + 60000 }),
    driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
    journal: { accept: async () => { entered.resolve(); return admission.promise; }, inspect: vi.fn(), put: vi.fn() },
  });
  const controller = new AbortController();
  let retired = false;
  const completion = worker.fetch(new Request(command(), { signal: controller.signal }))
    .catch(() => { retired = true; });
  await entered.promise;
  controller.abort(new Error('disconnect'));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try { expect(retired).toBe(true); }
  finally { admission.resolve(true); await completion; }
  expect(f.acquire).not.toHaveBeenCalled();
});
it('rejects unauthenticated callers before acquiring a container', async () => {
  const f = fixture(); expect((await f.worker.fetch(new Request('https://worker/command'))).status).toBe(401); expect(f.acquire).not.toHaveBeenCalled();
});
it('prevents caching authentication failures on command routes', async () => {
  const f = fixture();
  for (const path of ['/command', '/command/status']) {
    const response = await f.worker.fetch(new Request('https://worker' + path));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
});
it('applies Worker transfer limits to native job routes as well as shell commands', async () => {
  const f = fixture();
  f.acquire.mockResolvedValue({ fetch: async () => new Response(new Uint8Array(65537)) });
  const response = await f.worker.fetch(new Request('https://worker/v1/jobs/job/stdout', { headers: { Authorization: 'Bearer valid', 'Namespace-Id': 'forged' } }));
  await expect(response.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
  expect(f.acquire).toHaveBeenCalledWith('caller-a');
  expect(f.runtime).not.toHaveBeenCalled();
});
it('streams binary chunks, records delivered offsets, and rejects duplicate admission', async () => {
  const f = fixture(); const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const response = await f.worker.fetch(command(bytes));
  const output = new Uint8Array(await response.arrayBuffer()); // bounded fixture only
  expect(output[0]).toBe(1); expect(new DataView(output.buffer).getUint32(1)).toBe(256); expect(output.slice(5)).toEqual(bytes);
  expect(f.acquire).toHaveBeenCalledWith('caller-a');
  expect(f.records.get('caller-a:one')).toMatchObject({ state: 'terminal', stdoutOffset: '256', exitCode: 0 });
  expect((await f.worker.fetch(command())).status).toBe(409);
});
it('does not replay an accepted command after a Worker restart', async () => {
  const f = fixture(); f.records.set('caller-a:one', { command: 'ffmpeg', state: 'accepted', stdoutOffset: '0', stderrOffset: '0' });
  expect((await f.worker.fetch(command())).status).toBe(409); expect(f.runtime).not.toHaveBeenCalled();
});
it('prevents caching caller-specific command recovery metadata', async () => {
  const f = fixture();
  f.records.set('caller-a:one', { command: 'ffmpeg', state: 'accepted', stdoutOffset: '0', stderrOffset: '0' });
  const response = await f.worker.fetch(new Request('https://worker/command/status', {
    headers: { Authorization: 'Bearer valid', 'Idempotency-Key': 'one' },
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ state: 'accepted', recovery: 'inspect-native-job-and-effects; start-new-shell' });
  expect(f.acquire).not.toHaveBeenCalled();
});
it('fails closed when the canonical runtime is unavailable', async () => {
  const f = fixture(); f.runtime.mockRejectedValue(new Error('not qualified'));
  expect((await f.worker.fetch(command())).status).toBe(503);
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
});
it('rejects oversized input chunks without collecting media', async () => {
  const f = fixture(); const response = await f.worker.fetch(command(new Uint8Array(65537)));
  const reader = response.body!.getReader();
  while (!(await reader.read()).done) { /* Return response credit until EOF. */ }
  expect(f.records.get('caller-a:one')?.exitCode).not.toBe(0);
});
it('cancels a disconnected response instead of continuing a blocked write', async () => {
  const f = fixture(); const response = await f.worker.fetch(command(new Uint8Array(256)));
  await response.body!.cancel('disconnect');
  await vi.waitFor(() => expect(f.records.get('caller-a:one')?.state).toBe('recovery-required'));
});

it('persists accepted native identities and effect receipt digests in the caller journal', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  f.runtime.mockImplementation(async input => {
    await input.persistNative([{ sessionId: 'session', epoch: 'epoch', jobId: 'job' }], [{ jobId: 'job', receiptId: 'receipt', digest: 'digest' }]);
    return implementation(input);
  });
  const response = await f.worker.fetch(command());
  const reader = response.body!.getReader();
  while (!(await reader.read()).done) { /* Return response credit until EOF. */ }
  expect(f.records.get('caller-a:one')).toMatchObject({ nativeJobs: [{ jobId: 'job' }], effectReceipts: [{ receiptId: 'receipt', digest: 'digest' }] });
});

it('retains earlier native jobs and receipts across incremental publication', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  f.runtime.mockImplementation(async input => {
    await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'first' }], [{ jobId: 'first', receiptId: 'r', digest: 'd' }]);
    await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'second' }], []);
    return implementation(input);
  });
  const response = await f.worker.fetch(command());
  await response.arrayBuffer();
  expect(f.records.get('caller-a:one')).toMatchObject({
    nativeJobs: [{ jobId: 'first' }, { jobId: 'second' }],
    effectReceipts: [{ jobId: 'first', receiptId: 'r', digest: 'd' }],
  });
});

it('rejects conflicting effect receipts instead of replacing recovery evidence', async () => {
  const f = fixture();
  f.runtime.mockImplementation(async input => {
    await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'job' }], [{ jobId: 'job', receiptId: 'r', digest: 'first' }]);
    await input.persistNative([], [{ jobId: 'job', receiptId: 'r', digest: 'different' }]);
    throw new Error('Conflict should have rejected');
  });
  expect((await f.worker.fetch(command())).status).toBe(503);
  expect(f.records.get('caller-a:one')?.effectReceipts).toEqual([{ jobId: 'job', receiptId: 'r', digest: 'first' }]);
});

it('retains a receipt conflict when the native binding catches publication failure', async () => {
  const f = fixture();
  const implementation = f.runtime.getMockImplementation()!;
  f.runtime.mockImplementation(async input => {
    await input.persistNative([{ sessionId: 's', epoch: 'e', jobId: 'job' }], [{ jobId: 'job', receiptId: 'r', digest: 'first' }]);
    await input.persistNative([], [{ jobId: 'job', receiptId: 'r', digest: 'different' }]).catch(() => {});
    return implementation(input);
  });
  const response = await f.worker.fetch(command());
  await response.arrayBuffer(); // Empty bounded fixture.
  expect(f.records.get('caller-a:one')).toMatchObject({
    state: 'recovery-required', effectReceipts: [{ jobId: 'job', receiptId: 'r', digest: 'first' }],
  });
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});

it('records unavailable container acquisition as recovery-required', async () => {
  const f = fixture(); f.acquire.mockRejectedValue(new Error('container unavailable'));
  expect((await f.worker.fetch(command())).status).toBe(503);
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
});

it('enforces two output credits even when an engine does not await writes', async () => {
  const f = fixture();
  let rejected = false;
  f.runtime.mockImplementation(async () => ({ fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute(request) {
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => request.stdout.write(new Uint8Array(65536))));
    rejected = results.some(result => result.status === 'rejected');
    return { exitCode: 0 };
  } } }));
  const response = await f.worker.fetch(command());
  const reader = response.body!.getReader();
  while (!(await reader.read()).done) { /* Return bounded output credits. */ }
  expect(rejected).toBe(true);
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});

it('does not report success when an engine swallows an oversized output rejection', async () => {
  const f = fixture();
  f.runtime.mockImplementation(async () => ({ fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute(request) {
    await request.stdout.write(new Uint8Array(65537)).catch(() => {});
    return { exitCode: 0 };
  } } }));
  const response = await f.worker.fetch(command());
  expect((await response.body!.getReader().read()).done).toBe(true);
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
  expect(f.records.get('caller-a:one')?.stdoutOffset).toBe('0');
});

it('accepts a fractional credential lifetime without an invalid timeout', async () => {
  const f = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const worker = createMediaWorker({
      authenticate: async () => ({ namespaceId: 'caller-a', expiresAt: 61000.5 }),
      driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
      journal: { accept: async () => true, inspect: async () => undefined, put: async () => {} },
    });
    const response = await worker.fetch(command());
    expect(response.status).toBe(200);
    expect((await response.body!.getReader().read()).done).toBe(true);
  } finally { now.mockRestore(); }
});

it('does not acquire a container when credentials expire during durable admission', async () => {
  const f = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const put = vi.fn(async () => {});
  try {
    const worker = createMediaWorker({
      authenticate: async () => ({ namespaceId: 'caller-a', expiresAt: 2000 }),
      driver: { acquire: f.acquire, destroy: async () => {} }, runtime: f.runtime,
      journal: { accept: async () => { now.mockReturnValue(3000); return true; }, inspect: async () => undefined, put },
    });
    const response = await worker.fetch(command());
    await response.body?.cancel();
    expect(response.status).toBe(401);
    expect(f.acquire).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith('caller-a', 'one', expect.objectContaining({ state: 'recovery-required' }));
  } finally { now.mockRestore(); }
});

it('closes the canonical runtime even when shell cleanup fails', async () => {
  const f = fixture();
  const close = vi.fn(async () => {});
  f.runtime.mockImplementation(async () => ({ fs: new MemoryFileSystem(), close, engine: { async execute(request) {
    request.registerCleanup?.(async () => { throw new Error('native retirement unknown'); });
    return { exitCode: 0 };
  } } }));
  const response = await f.worker.fetch(command());
  await response.body!.getReader().read().catch(() => {});
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
});

it('retires a runtime when shell construction rejects its filesystem', async () => {
  const f = fixture();
  const close = vi.fn(async () => {});
  f.runtime.mockImplementation(async () => ({ fs: undefined, close, engine: { execute: async () => ({ exitCode: 0 }) } }) as never);
  expect((await f.worker.fetch(command())).status).toBe(503);
  expect(close).toHaveBeenCalledOnce();
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
});

it('retains an input byte-limit failure when the engine catches it', async () => {
  const f = fixture();
  f.runtime.mockImplementation(async () => ({ fs: new MemoryFileSystem(), close: async () => {}, engine: { async execute(request) {
    try { for await (const ignoredBytes of request.stdin) { /* Consume bounded input. */ } }
    catch { /* A native engine must not hide the transport failure. */ }
    return { exitCode: 0 };
  } } }));
  const response = await f.worker.fetch(command(new Uint8Array(65537)));
  const reader = response.body!.getReader();
  while (!(await reader.read()).done) { /* Return output credit. */ }
  expect(f.records.get('caller-a:one')?.state).toBe('recovery-required');
  expect(f.records.get('caller-a:one')?.exitCode).toBeUndefined();
});

it('cancels unread request input when the shell finishes', async () => {
  const f = fixture();
  const cancel = vi.fn();
  f.runtime.mockImplementation(async () => ({ fs: new MemoryFileSystem(), close: async () => {}, engine: { execute: async () => ({ exitCode: 0 }) } }));
  const request = new Request('https://worker/command', {
    method: 'POST', headers: { Authorization: 'Bearer valid', 'Idempotency-Key': 'one', 'Shell-Command': 'ffmpeg -version' },
    body: new ReadableStream({ cancel }), duplex: 'half',
  } as RequestInit);
  const response = await f.worker.fetch(request);
  expect((await response.body!.getReader().read()).done).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
});

it('bounds live command credits across Worker factories and returns credit after disconnect', async () => {
  const first = fixture();
  const second = fixture();
  const responses: Response[] = [];
  const request = (key: string) => {
    const value = command(new Uint8Array([42]));
    value.headers.set('Idempotency-Key', key);
    return value;
  };
  try {
    for (let index = 0; index < 4; index++) {
      responses.push(await first.worker.fetch(request(String(index))));
    }
    const rejected = await second.worker.fetch(request('overflow'));
    if (rejected.status === 200) responses.push(rejected);
    expect(rejected.status).toBe(429);
    expect(second.acquire).not.toHaveBeenCalled();
    expect(second.records.size).toBe(0);
    // Status inspection does not require a streaming command credit.
    expect((await first.worker.fetch(new Request('https://worker/command/status', {
      headers: { Authorization: 'Bearer valid', 'Idempotency-Key': '0' },
    }))).status).toBe(200);
    await responses.shift()!.body!.cancel('disconnect');
    await vi.waitFor(() => expect(first.records.get('caller-a:0')?.state).toBe('recovery-required'));
    const replacement = await second.worker.fetch(request('replacement'));
    responses.push(replacement);
    expect(replacement.status).toBe(200);
  } finally {
    await Promise.all(responses.map(response => response.body?.cancel('fixture retirement')));
    await vi.waitFor(() => expect([...first.records.values(), ...second.records.values()]
      .every(record => record.state === 'recovery-required')).toBe(true));
  }
});
