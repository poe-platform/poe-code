/** Only data crosses the interpreter boundary; credentials and authority stay in closures. */
export type PythonHostValue = null | boolean | number | string | readonly PythonHostValue[] | { readonly [name: string]: PythonHostValue };
export interface PythonHostCapability {
  call?(value: PythonHostValue, context: { readonly signal: AbortSignal }): Promise<PythonHostValue>;
  stream?(value: PythonHostValue, context: { readonly signal: AbortSignal }): AsyncIterable<string | Uint8Array | PythonHostValue>;
}
export interface PythonHostBridgeOptions {
  readonly signal: AbortSignal;
  readonly maxMessageBytes?: number;
  readonly maxConcurrentCalls?: number;
  readonly maxStreams?: number;
}

/** Invocation-owned, pull-based protocol. An uncooperative host retains admission until it settles. */
export function createPythonHostBridge(capabilities: Readonly<Record<string, PythonHostCapability>>, options: PythonHostBridgeOptions) {
  const maxMessageBytes = options.maxMessageBytes ?? 65536;
  const maxConcurrentCalls = options.maxConcurrentCalls ?? 1;
  const maxStreams = options.maxStreams ?? 4;
  for (const limit of [maxMessageBytes, maxConcurrentCalls, maxStreams]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid Python host capability limit');
  }
  if (maxMessageBytes > 65536) throw new RangeError('Python host message limit cannot exceed 65536 bytes');
  const registry = new Map(Object.entries(capabilities));
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const pending = new Set<Promise<unknown>>();
  const streams = new Map<number, { iterator: AsyncIterator<string | Uint8Array | PythonHostValue>; busy: boolean }>();
  let nextHandle = 1;
  let retired = false;
  let closing: Promise<void> | undefined;
  const data = (value: unknown): PythonHostValue => {
    let nodes = 0;
    let estimatedBytes = 0;
    const inspect = (item: unknown, depth: number): void => {
      if (++nodes > maxMessageBytes || depth > 32) throw new RangeError('Python host message limit exceeded');
      if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
        estimatedBytes += JSON.stringify(item).length;
        if (estimatedBytes > maxMessageBytes) throw new RangeError('Python host message limit exceeded');
        return;
      }
      if (typeof item === 'string') {
        if (item.length > maxMessageBytes) throw new RangeError('Python host message limit exceeded');
        estimatedBytes += new TextEncoder().encode(JSON.stringify(item)).length;
        if (estimatedBytes > maxMessageBytes) throw new RangeError('Python host message limit exceeded');
        return;
      }
      if (typeof item !== 'object' || item === null || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Python host messages must contain data only');
      estimatedBytes += 2;
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Python host messages must contain data only');
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        estimatedBytes += 2;
        if (estimatedBytes > maxMessageBytes) throw new RangeError('Python host message limit exceeded');
        if (Array.isArray(item) && key === 'length') continue;
        if (typeof key !== 'string') throw new TypeError('Python host messages must contain data only');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) throw new TypeError('Python host messages must contain data only');
        if (!Array.isArray(item)) inspect(key, depth + 1);
        inspect(descriptor.value, depth + 1);
      }
    };
    inspect(value, 0);
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).length > maxMessageBytes) throw new RangeError('Python host message limit exceeded');
    return JSON.parse(encoded) as PythonHostValue;
  };
  const assertLive = (): void => {
    if (retired) throw new Error('Python host capability retired');
    signal.throwIfAborted();
  };
  const release = async (handle: number): Promise<void> => {
    const stream = streams.get(handle);
    if (!stream) throw new Error('Unknown Python host stream');
    streams.delete(handle);
    await stream.iterator.return?.();
  };
  const request = async (incoming: unknown): Promise<PythonHostValue> => {
    assertLive();
    if (pending.size >= maxConcurrentCalls) throw new Error('Python host call concurrency limit exceeded');
    const payload = data(incoming) as Record<string, PythonHostValue>;
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || payload.version !== 1) throw new TypeError('Unsupported Python host protocol');
    const operation = Promise.resolve().then(async (): Promise<PythonHostValue> => {
      assertLive();
      if (payload.operation === 'next' || payload.operation === 'release') {
        const handle = payload.handle;
        if (typeof handle !== 'number' || !Number.isSafeInteger(handle)) throw new TypeError('Invalid Python host stream handle');
        const stream = streams.get(handle);
        if (!stream) throw new Error('Unknown Python host stream');
        if (stream.busy) throw new Error('Python host stream already pulling');
        if (payload.operation === 'release') { await release(handle); return null; }
        stream.busy = true;
        try {
          const result = await stream.iterator.next();
          assertLive();
          if (result.done) { await release(handle); return { done: true }; }
          const value = result.value instanceof Uint8Array
            ? (() => { if (result.value.length > maxMessageBytes / 4) throw new RangeError('Python host message limit exceeded'); return { type: 'bytes', bytes: Array.from(result.value) }; })()
            : typeof result.value === 'string' ? { type: 'text', text: result.value } : { type: 'data', value: result.value };
          return data({ done: false, value });
        } catch (error) {
          if (streams.has(handle)) await release(handle);
          throw error;
        } finally { stream.busy = false; }
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
        const iterator = capability.stream(payload.value ?? null, { signal })[Symbol.asyncIterator]();
        const handle = nextHandle++;
        streams.set(handle, { iterator, busy: false });
        return handle;
      }
      throw new Error('Unsupported Python host capability operation');
    });
    pending.add(operation);
    try { return await operation; }
    finally { pending.delete(operation); }
  };
  const close = (): Promise<void> => {
    if (closing) return closing;
    retired = true;
    controller.abort(new Error('Python host capability retired'));
    closing = (async () => {
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...streams.keys()].map(release));
      registry.clear();
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    })();
    return closing;
  };
  return { request, close };
}
