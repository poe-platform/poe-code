/** Only data crosses the interpreter boundary; credentials and authority stay in closures. */
export type PythonHostValue = null | boolean | number | string | readonly PythonHostValue[] | { readonly [name: string]: PythonHostValue };
export interface PythonHostCapability {
  /** Invocation-owned cleanup, awaited after calls and streams retire. */
  close?(): Promise<void>;
  call?(value: PythonHostValue, context: { readonly signal: AbortSignal }): Promise<PythonHostValue>;
  stream?(value: PythonHostValue, context: { readonly signal: AbortSignal }): AsyncIterable<string | Uint8Array | PythonHostValue>;
}
export interface PythonHostBridgeOptions {
  readonly signal: AbortSignal;
  readonly maxMessageBytes?: number;
  readonly maxMessageDepth?: number;
  readonly maxConcurrentCalls?: number;
  readonly maxStreams?: number;
  readonly maxStreamBytes?: number;
}

export type PythonHostFailureCode = 'limit' | 'timeout' | 'service';
interface HostJob {
  controller: AbortController;
  reservation: object;
  settled: boolean;
  result?: PythonHostValue;
  failed?: PythonHostFailureCode;
}
export function pythonHostFailureCode(error: unknown): PythonHostFailureCode {
  if (error instanceof RangeError) return 'limit';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'service';
}

/** Invocation-owned, pull-based protocol. An uncooperative host retains admission until it settles. */
export function createPythonHostBridge(capabilities: Readonly<Record<string, PythonHostCapability>>, options: PythonHostBridgeOptions) {
  const maxMessageBytes = options.maxMessageBytes ?? Infinity;
  const maxConcurrentCalls = options.maxConcurrentCalls ?? Infinity;
  const maxStreams = options.maxStreams ?? Infinity;
  const maxStreamBytes = options.maxStreamBytes ?? Infinity;
  const maxMessageDepth = options.maxMessageDepth ?? Infinity;
  for (const limit of [maxMessageBytes, maxMessageDepth, maxConcurrentCalls, maxStreams, maxStreamBytes]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('Invalid Python host capability limit');
  }
  const checkMessageLimit = (size:number,maximum=maxMessageBytes):void => {
    if(size>maximum)throw new RangeError('Python host message limit exceeded');
  };
  const registry = new Map(Object.entries(capabilities));
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const pending = new Set<Promise<unknown>>();
  const streams = new Map<number, { iterator: AsyncIterator<string | Uint8Array | PythonHostValue>; busy: boolean; controller: AbortController; bytes: number; closing?: Promise<void> }>();
  const jobs = new Map<number, HostJob>();
  const activeCalls = new Set<object>();
  const cleanupFailures: unknown[] = [];
  const jobWork = new Set<Promise<void>>();
  let nextJob = 1;
  let nextHandle = 1;
  let retired = false;
  let closing: Promise<void> | undefined;
  const data = (value: unknown): PythonHostValue => {
    const ancestors = new Set<object>();
    let nodes = 0;
    let estimatedBytes = 0;
    const inspect = (item: unknown, depth: number): void => {
      checkMessageLimit(++nodes);checkMessageLimit(depth,maxMessageDepth);
      if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
        estimatedBytes += JSON.stringify(item).length;
        checkMessageLimit(estimatedBytes);
        return;
      }
      if (typeof item === 'string') {
        checkMessageLimit(item.length);
        estimatedBytes += new TextEncoder().encode(JSON.stringify(item)).length;
        checkMessageLimit(estimatedBytes);
        return;
      }
      if (typeof item !== 'object' || item === null || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Python host messages must contain data only');
      if(Array.isArray(item))checkMessageLimit(item.length);
      if (ancestors.has(item)) throw new TypeError('Python host messages must not contain cycles');
      ancestors.add(item);
      estimatedBytes += 2;
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Python host messages must contain data only');
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        estimatedBytes += 2;
        checkMessageLimit(estimatedBytes);
        if (Array.isArray(item) && key === 'length') continue;
        if (typeof key !== 'string') throw new TypeError('Python host messages must contain data only');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) throw new TypeError('Python host messages must contain data only');
        if (!Array.isArray(item)) inspect(key, depth + 1);
        inspect(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
    };
    inspect(value, 0);
    const encoded = JSON.stringify(value);
    checkMessageLimit(new TextEncoder().encode(encoded).length);
    return JSON.parse(encoded) as PythonHostValue;
  };
  const assertLive = (): void => {
    if (retired) throw new Error('Python host capability retired');
    signal.throwIfAborted();
  };
  const release = async (handle: number, cancel = true): Promise<void> => {
    const stream = streams.get(handle);
    if (!stream) throw new Error('Unknown Python host stream');
    if (!stream.closing) {
      stream.closing = Promise.resolve().then(async () => {
        if (cancel) stream.controller.abort(new Error('Python host stream released'));
        await stream.iterator.return?.();
        // Retained iterators consume admission until cleanup succeeds, including
        // when a host ignores cancellation or its cleanup fails.
        streams.delete(handle);
      }).catch(error => { cleanupFailures.push(error); throw error; });
    }
    await stream.closing;
  };
  const pull = async (handle: number): Promise<PythonHostValue> => {
    const stream = streams.get(handle);
    if (!stream) throw new Error('Unknown Python host stream');
        try {
          const result = await stream.iterator.next();
          assertLive();
          stream.controller.signal.throwIfAborted();
          if (result.done) { await release(handle, false); return { done: true }; }
          const chunkBytes = result.value instanceof Uint8Array ? result.value.length
            : new TextEncoder().encode(typeof result.value === 'string' ? result.value : JSON.stringify(data(result.value))).length;
          if (chunkBytes > maxStreamBytes - stream.bytes) throw new RangeError('Python host stream byte limit exceeded');
          stream.bytes += chunkBytes;
          const value = result.value instanceof Uint8Array
            ? (() => { checkMessageLimit(result.value.length,maxMessageBytes/4); return { type: 'bytes', bytes: Array.from(result.value) }; })()
            : typeof result.value === 'string' ? { type: 'text', text: result.value } : { type: 'data', value: result.value };
          return data({ done: false, value });
        } catch (error) {
          if (streams.has(handle)) await release(handle);
          throw error;
        }
  };
  const request = async (incoming: unknown): Promise<PythonHostValue> => {
    assertLive();
    if (pending.size >= maxConcurrentCalls) throw new Error('Python host call concurrency limit exceeded');
    const payload = data(incoming) as Record<string, PythonHostValue>;
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || payload.version !== 1) throw new TypeError('Unsupported Python host protocol');
    let reservation: object | undefined;
    const operation = Promise.resolve().then(async (): Promise<PythonHostValue> => {
      assertLive();
      if (payload.operation === 'poll' || payload.operation === 'cancel') {
        const handle = payload.handle;
        if (typeof handle !== 'number') throw new TypeError('Invalid Python host job');
        const job = jobs.get(handle);
        if (!job) throw new Error('Unknown Python host job');
        if (payload.operation === 'cancel') {
          jobs.delete(handle);
          if (job.settled) activeCalls.delete(job.reservation);
          job.controller.abort(new Error('Python guest cancelled host operation'));
          return null;
        }
        if (job.result === undefined && !job.failed) return { done: false };
        jobs.delete(handle);
        if (job.settled) activeCalls.delete(job.reservation);
        return job.failed ? { done: true, error: 'Python host operation failed', errorCode: job.failed } : { done: true, value: job.result! };
      }
      if (activeCalls.size >= maxConcurrentCalls) throw new Error('Python host call concurrency limit exceeded');
      reservation = {};
      activeCalls.add(reservation);
      if (payload.operation === 'begin' || payload.operation === 'begin-next') {
        let work: (childSignal: AbortSignal) => Promise<PythonHostValue>;
        let child: AbortController;
        let reservedStream: { busy: boolean } | undefined;
        if (payload.operation === 'begin-next') {
          const stream = typeof payload.handle === 'number' ? streams.get(payload.handle) : undefined;
          if (!stream || stream.busy || stream.closing) throw new Error('Unknown or busy Python host stream');
          reservedStream = stream;
          stream.busy = true;
          child = stream.controller;
          work = () => pull(payload.handle as number);
        } else {
          const capability = typeof payload.capability === 'string' ? registry.get(payload.capability) : undefined;
          if (!capability?.call) throw new Error('Unknown Python host capability');
          child = new AbortController();
          work = childSignal => capability.call!(payload.value ?? null, { signal: childSignal });
        }
        const handle = nextJob++;
        const job: HostJob = { controller: child, reservation, settled: false };
        jobs.set(handle, job);
        // Transfer admission to the job until both host work and guest ownership end.
        reservation = undefined;
        const task = Promise.resolve().then(() => {
          const childSignal = AbortSignal.any([signal, child.signal]);
          childSignal.throwIfAborted();
          return work(childSignal);
        }).then(value => {
          assertLive();
          child.signal.throwIfAborted();
          job.result = data(value);
        }).catch(error => { job.failed = pythonHostFailureCode(error); }).finally(() => {
          job.settled = true;
          if (!jobs.has(handle)) activeCalls.delete(job.reservation);
          if (reservedStream) reservedStream.busy = false;
          jobWork.delete(task);
        });
        jobWork.add(task);
        return handle;
      }
      if (payload.operation === 'next' || payload.operation === 'release') {
        const handle = payload.handle;
        if (typeof handle !== 'number' || !Number.isSafeInteger(handle)) throw new TypeError('Invalid Python host stream handle');
        const stream = streams.get(handle);
        if (!stream) throw new Error('Unknown Python host stream');
        if (stream.busy || stream.closing) throw new Error('Python host stream already pulling or closing');
        if (payload.operation === 'release') { await release(handle); return null; }
        stream.busy = true;
        try { return await pull(handle); }
        finally { stream.busy = false; }
      }
      if (typeof payload.capability !== 'string') throw new TypeError('Invalid Python host capability');
      const capability = registry.get(payload.capability);
      if (!capability) throw new Error('Unknown Python host capability');
      if (payload.operation === 'call' && capability.call) {
        const result = await capability.call(payload.value ?? null, { signal });
        assertLive();
        return data(result);
      }
      if (payload.operation === 'stream' && capability.stream) {
        if (streams.size >= maxStreams) throw new Error('Python host stream limit exceeded');
        const child = new AbortController();
        const iterator = capability.stream(payload.value ?? null, { signal: AbortSignal.any([signal, child.signal]) })[Symbol.asyncIterator]();
        const handle = nextHandle++;
        streams.set(handle, { iterator, busy: false, controller: child, bytes: 0 });
        return handle;
      }
      throw new Error('Unsupported Python host capability operation');
    });
    pending.add(operation);
    try { return await operation; }
    finally {
      pending.delete(operation);
      if (reservation) activeCalls.delete(reservation);
    }
  };
  const close = (): Promise<void> => {
    if (closing) return closing;
    retired = true;
    controller.abort(new Error('Python host capability retired'));
    closing = (async () => {
      for (const job of jobs.values()) job.controller.abort(controller.signal.reason);
      await Promise.allSettled([...pending, ...jobWork]);
      jobs.clear();
      activeCalls.clear();
      const results = await Promise.allSettled([...streams.keys()].map(handle => release(handle)));
      const cleanup = await Promise.allSettled([...new Set(registry.values())].map(capability => Promise.resolve().then(() => capability.close?.())));
      registry.clear();
      results.push(...cleanup);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (cleanupFailures.length) throw cleanupFailures[0];
    })();
    return closing;
  };
  return { request, close };
}
