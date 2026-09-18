import type { PlaywrightContext, PlaywrightStorageState } from './adapter.js';
import { parsePlaywrightStorageState } from './storage-state.js';
import { collectStorageOrigin, type NativeStorageGlobals, type NativeStorageRequest } from './native-storage-realm.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

export interface PlaywrightStorageCDP {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  detach(): Promise<void>;
}

export interface PlaywrightStorageOriginLease {
  readonly cdp: PlaywrightStorageCDP;
  readonly targetId: string;
  readonly browserContextId: string;
  release(): Promise<void>;
}

export type PlaywrightStorageOriginPreparer = (request: {
  readonly context: PlaywrightContext;
  readonly browserContextId: string;
  readonly origin: string;
  readonly signal: AbortSignal;
}) => Promise<PlaywrightStorageOriginLease>;

interface Binding {
  readonly browserContextId: string;
  readonly prepare: PlaywrightStorageOriginPreparer;
  readonly controller: AbortController;
  readonly operations: Set<Promise<void>>;
  readonly origins: Set<string>;
  refreshOrigins(): void;
}

const bindings = new WeakMap<PlaywrightContext, Binding>();

async function finish(actions: (() => Promise<unknown>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) { try { await action(); } catch (error) { errors.push(error); } }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Native storage cleanup failed');
}

export async function bindPlaywrightStorageContext(context: PlaywrightContext, prepare: PlaywrightStorageOriginPreparer, signal: AbortSignal, initialOrigins: readonly string[] = []): Promise<() => Promise<void>> {
  signal.throwIfAborted();
  if (!context.newCDPSession) throw new Error('Native storage context identity requires CDP');
  if (bindings.has(context)) throw new Error('Native storage context is already bound');
  const existing = context.pages()[0];
  const page = existing ?? await context.newPage();
  let cdp: PlaywrightStorageCDP | undefined;
  let browserContextId: string;
  try {
    signal.throwIfAborted();
    cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const identity = targetInfo as { browserContextId?: unknown; targetId?: unknown } | undefined;
    if (typeof identity?.browserContextId !== 'string' || !identity.browserContextId || typeof identity.targetId !== 'string' || !identity.targetId) throw new Error('Invalid native storage context identity');
    browserContextId = identity.browserContextId;
  } finally { await finish([async () => cdp?.detach(), async () => { if (!existing) await page.close(); }]); }
  signal.throwIfAborted();
  const observed = new Map<import('./adapter.js').PlaywrightPage, () => void>();
  const remember = (value: string | undefined) => {
    if (!value) return;
    try { const origin = new URL(value).origin; if (origin !== 'null') binding.origins.add(origin); } catch {}
  };
  const record = (page: import('./adapter.js').PlaywrightPage) => {
    remember(page.url?.());
    for (const frame of page.frames?.() ?? []) remember(frame.url?.());
  };
  const onPage = (page: import('./adapter.js').PlaywrightPage) => {
    record(page);
    if (observed.has(page)) return;
    const navigated = () => record(page);
    const cleanup = () => { page.off?.('framenavigated', navigated); page.off?.('close', closed); observed.delete(page); };
    const closed = () => { record(page); cleanup(); };
    observed.set(page, cleanup);
    page.on?.('framenavigated', navigated);
    page.on?.('close', closed);
  };
  const binding: Binding = { browserContextId, prepare, controller: new AbortController(), operations: new Set(), origins: new Set(initialOrigins),
    refreshOrigins() { for (const page of context.pages()) onPage(page); } };
  bindings.set(context, binding);
  context.on('page', onPage);
  binding.refreshOrigins();
  let retirement: Promise<void> | undefined;
  return () => retirement ??= (async () => {
    bindings.delete(context);
    context.off('page', onPage);
    for (const cleanup of observed.values()) cleanup();
    binding.controller.abort(new Error('Native storage context retired'));
    await Promise.allSettled(binding.operations);
    binding.origins.clear();
  })();
}

async function restoreOrigin(origin: PlaywrightStorageState['origins'][number]): Promise<boolean> {
  const { location, navigator, indexedDB, localStorage } = globalThis as unknown as NativeStorageGlobals;
  const helpers = {
    request<Result>(request: NativeStorageRequest<Result>): Promise<Result> {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Native IndexedDB request blocked by an open connection'));
      });
    },
    decode(value: unknown, refs = new Map<number, unknown>()): unknown {
      if (value === null || typeof value !== 'object') return value;
      const item = value as { ref?: number; v?: string; d?: string; u?: string; bi?: string; e?: { n: string; m: string; s: string }; r?: { p: string; f: string }; id?: number; a?: unknown[]; o?: { k: string; v: unknown }[]; ta?: { k: string; b: string }; ab?: { b: string } };
      if (item.ref !== undefined) return refs.get(item.ref);
      if (item.v !== undefined) return ({ undefined: undefined, null: null, NaN, Infinity, '-Infinity': -Infinity, '-0': -0 } as Record<string, unknown>)[item.v];
      if (item.d !== undefined) return new Date(item.d);
      if (item.u !== undefined) return new URL(item.u);
      if (item.bi !== undefined) return BigInt(item.bi);
      if (item.e !== undefined) { const error = new Error(item.e.m); error.name = item.e.n; error.stack = item.e.s; return error; }
      if (item.r !== undefined) return new RegExp(item.r.p, item.r.f);
      if (item.a !== undefined) {
        const array: unknown[] = []; refs.set(item.id!, array);
        for (const child of item.a) array.push(this.decode(child, refs));
        return array;
      }
      if (item.o !== undefined) {
        const object: Record<string, unknown> = {}; refs.set(item.id!, object);
        for (const child of item.o) if (child.k !== '__proto__') object[child.k] = this.decode(child.v, refs);
        return object;
      }
      if (item.ta !== undefined || item.ab !== undefined) {
        const binary = atob(item.ta?.b ?? item.ab!.b);
        const buffer = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) buffer[index] = binary.charCodeAt(index);
        if (item.ab) return buffer.buffer;
        const constructors: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = { i8: Int8Array, ui8: Uint8Array, ui8c: Uint8ClampedArray, i16: Int16Array, ui16: Uint16Array, i32: Int32Array, ui32: Uint32Array, f32: Float32Array, f64: Float64Array, bi64: BigInt64Array, bui64: BigUint64Array };
        return new constructors[item.ta!.k]!(buffer.buffer);
      }
      return value;
    },
  };
  if (location.origin !== origin.origin) throw new Error('Native storage origin changed');
  for (const registration of await navigator.serviceWorker?.getRegistrations() ?? []) await registration.unregister();
  for (const database of await indexedDB.databases()) if (database.name) await helpers.request(indexedDB.deleteDatabase(database.name));
  for (const info of origin.indexedDB ?? []) {
    const opening = indexedDB.open(info.name, info.version);
    opening.onupgradeneeded = () => {
      for (const store of info.stores) {
        const created = opening.result.createObjectStore(store.name, { autoIncrement: store.autoIncrement, keyPath: store.keyPathArray ?? store.keyPath });
        for (const index of store.indexes) created.createIndex(index.name, (index.keyPathArray ?? index.keyPath)!, { unique: index.unique, multiEntry: index.multiEntry });
      }
    };
    const database = await helpers.request(opening);
    try {
      if (!database.objectStoreNames.length) continue;
      const transaction = database.transaction(database.objectStoreNames, 'readwrite');
      const completed = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')); });
      try {
        for (const store of info.stores) for (const record of store.records) {
          const value = record.value ?? helpers.decode(record.valueEncoded);
          const key = record.key ?? helpers.decode(record.keyEncoded);
          transaction.objectStore(store.name).add(value, key);
        }
      } catch (error) { transaction.abort(); await completed.catch(() => {}); throw error; }
      await completed;
    } finally { database.close(); }
  }
  localStorage.clear();
  for (const item of origin.localStorage) localStorage.setItem(item.name, item.value);
  return true;
}

export interface PlaywrightStorageOperationOptions {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  registerCleanup(cleanup: () => Promise<void>): void;
}

async function inOrigin(binding: Binding, context: PlaywrightContext, origin: string, signal: AbortSignal, expression: string, clearIndexedDB = false): Promise<unknown> {
  signal.throwIfAborted();
  const lease = await binding.prepare({ context, browserContextId: binding.browserContextId, origin, signal });
  let retirement: Promise<void> | undefined;
  const release = () => retirement ??= Promise.resolve().then(() => lease.release());
  const abort = () => { void release().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const [operation] = await Promise.allSettled([(async () => {
    try {
      signal.throwIfAborted();
      const { targetInfo } = await lease.cdp.send('Target.getTargetInfo');
      const native = targetInfo as { targetId?: unknown; browserContextId?: unknown; url?: unknown } | undefined;
      if (lease.browserContextId !== binding.browserContextId || !lease.targetId || native?.targetId !== lease.targetId || native.browserContextId !== binding.browserContextId) throw new Error('Native storage target identity mismatch');
      if (typeof native.url !== 'string' || new URL(native.url).origin !== origin) throw new Error('Native storage target origin mismatch');
      const { frameTree } = await lease.cdp.send('Page.getFrameTree');
      const frame = (frameTree as { frame?: { id?: unknown; url?: unknown } } | undefined)?.frame;
      if (typeof frame?.id !== 'string' || typeof frame.url !== 'string' || new URL(frame.url).origin !== origin) throw new Error('Native storage frame origin mismatch');
      signal.throwIfAborted();
      if (clearIndexedDB) await lease.cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
      const { executionContextId } = await lease.cdp.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'safe-bash-native-storage' });
      signal.throwIfAborted();
      const result = await lease.cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
      signal.throwIfAborted();
      if (result.exceptionDetails) {
        const exception = result.exceptionDetails as { exception?: { description?: unknown }; text?: unknown };
        const description = exception.exception?.description ?? exception.text;
        throw new Error('Native storage origin operation failed' + (typeof description === 'string' ? ': ' + description.slice(0, 1024) : ''));
      }
      return (result.result as { value?: unknown } | undefined)?.value;
    } catch (error) { signal.throwIfAborted(); throw error; }
  })()]);
  signal.removeEventListener('abort', abort);
  const [retired] = await Promise.allSettled([finish([() => lease.cdp.detach(), release])]);
  if (operation!.status === 'rejected' && retired!.status === 'rejected') throw new AggregateError([operation!.reason, retired!.reason], 'Native storage operation and cleanup failed');
  if (retired!.status === 'rejected') throw retired!.reason;
  if (operation!.status === 'rejected') throw operation!.reason;
  return operation!.value;
}

async function storageOperation<Result>(binding: Binding, options: PlaywrightStorageOperationOptions, action: (signal: AbortSignal) => Promise<Result>): Promise<Result> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal, binding.controller.signal]);
  const owned: { operation?: Promise<Result> } = {};
  options.registerCleanup(async () => { controller.abort(new Error('Native storage operation retired')); await owned.operation?.catch(() => {}); });
  const operation = Promise.resolve().then(async () => {
    signal.throwIfAborted();
    return action(signal);
  });
  owned.operation = operation;
  const tracked = operation.then(() => {}, () => {});
  binding.operations.add(tracked);
  try { return await operation; } finally { binding.operations.delete(tracked); }
}

async function censusState(context: PlaywrightContext, binding: Binding, options: PlaywrightStorageOperationOptions, indexedDB: boolean, signal: AbortSignal): Promise<PlaywrightStorageState> {
  if (!context.storageState) throw new Error('Native storage census is required');
  // Provider IndexedDB collectors may leave live-page connections open. Read
  // databases only in owned targets, whose collector closes every connection.
  const census = parsePlaywrightStorageState(await context.storageState(), { maxBytes: options.maxBytes });
  binding.refreshOrigins();
  const origins = new Set([...census.origins.map(item => item.origin), ...binding.origins]);
  for (const origin of origins) {
    const existing = census.origins.findIndex(item => item.origin === origin);
    if (!indexedDB && existing !== -1) continue;
    signal.throwIfAborted();
    const remainingBytes = options.maxBytes - new TextEncoder().encode(JSON.stringify({ ...census, origins: census.origins.filter(item => item.origin !== origin) })).length;
    if (remainingBytes <= 0) throw new PlaywrightResourceLimitError('Browser storage state byte limit exceeded');
    const result = await inOrigin(binding, context, origin, signal, `(${collectStorageOrigin.toString()})(${JSON.stringify({ origin, indexedDB, maxBytes: remainingBytes })})`);
    if (result === false) throw new PlaywrightResourceLimitError('Browser storage state byte limit exceeded');
    if (typeof result !== 'string') throw new Error('Invalid native storage readback');
    const current = parsePlaywrightStorageState({ cookies: [], origins: [JSON.parse(result)] }, { maxBytes: options.maxBytes }).origins[0]!;
    if (existing !== -1) census.origins.splice(existing, 1);
    if (current.localStorage.length || current.indexedDB?.length) census.origins.push(current);
    parsePlaywrightStorageState(census, { maxBytes: options.maxBytes });
  }
  signal.throwIfAborted();
  return parsePlaywrightStorageState(census, { maxBytes: options.maxBytes });
}

export async function readPlaywrightStorageState(context: PlaywrightContext, options: PlaywrightStorageOperationOptions & { readonly indexedDB?: boolean }): Promise<PlaywrightStorageState> {
  const binding = bindings.get(context);
  if (!context.storageState) throw new Error('Native storage state is required');
  if (!binding) return context.storageState(options.indexedDB ? { indexedDB: true } : undefined);
  return storageOperation(binding, options, signal => censusState(context, binding, options, options.indexedDB === true, signal));
}

export async function replacePlaywrightStorageState(context: PlaywrightContext, input: PlaywrightStorageState, options: PlaywrightStorageOperationOptions): Promise<void> {
  const binding = bindings.get(context);
  if (!binding) throw new Error('Same-context storage restoration requires trusted acquired native storage control');
  await storageOperation(binding, options, async signal => {
    const state = parsePlaywrightStorageState(input, { maxBytes: options.maxBytes });
    if (!context.clearCookies || !context.addCookies) throw new Error('Native storage cookie controls are required');
    const census = await censusState(context, binding, options, true, signal);
    const origins = new Map(census.origins.map(item => [item.origin, { origin: item.origin, localStorage: [] } as PlaywrightStorageState['origins'][number]]));
    for (const origin of binding.origins) if (!origins.has(origin)) origins.set(origin, { origin, localStorage: [] });
    for (const origin of state.origins) origins.set(origin.origin, origin);
    parsePlaywrightStorageState({ cookies: [], origins: [...origins.keys()].map(origin => ({ origin, localStorage: [] })) }, { maxBytes: options.maxBytes });
    for (const origin of state.origins) binding.origins.add(origin.origin);
    await context.clearCookies();
    signal.throwIfAborted();
    await context.addCookies(state.cookies);
    for (const [origin, replacement] of origins) {
      signal.throwIfAborted();
      const result = await inOrigin(binding, context, origin, signal, `(${restoreOrigin.toString()})(${JSON.stringify(replacement)})`, true);
      if (result !== true) throw new Error('Native storage origin restoration failed');
    }
    signal.throwIfAborted();
    binding.origins.clear();
    for (const origin of state.origins) binding.origins.add(origin.origin);
  });
}
