import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import type { BrowserContext } from "@cloudflare/playwright";
import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";
import { serializeTraceStacks, writeTraceArchive, type TraceArchiveEntry, type TraceCallData, type TraceLimits } from "./browser-trace-archive.js";
import { guardTraceRecord, traceRecordBytes } from "./browser-trace-record.js";

export type { TraceLimits } from "./browser-trace-archive.js";
interface Progress { race<T>(promise: Promise<T>): Promise<T> }
interface NativeFS {
  mkdir(path: string): void;
  writeFile(path: string, content: string | Uint8Array, skipIfExists?: boolean): void;
  appendFile(path: string, text: string, flush: boolean): void;
  copyFile(from: string, to: string): void;
  zip(entries: TraceArchiveEntry[], path: string): void;
  syncAndGetError(): Promise<Error | undefined>;
}
interface NativeRecorder {
  _context: object;
  _fs: NativeFS;
  _state?: { tracesDir: string; recording: boolean };
  _isStopping?: boolean;
  _snapshotter?: Snapshotter;
  _harTracer?: HarTracer;
  _pendingHarEntries?: Set<object>;
  start(options: object): void;
  startChunk(progress?: Progress, options?: object): Promise<{ traceName: string }>;
  stopChunk(progress: Progress | undefined, options: { mode: string }): Promise<{ entries?: TraceArchiveEntry[] }>;
  stop(progress?: Progress): Promise<void>;
  group(...args: unknown[]): void;
  groupEnd(): void;
  abort(): void;
  flush(): Promise<void>;
  resetForReuse(progress?: Progress): Promise<void>;
  deleteTmpTracesDir(): Promise<void>;
  onEntryStarted?(entry: object): void;
  onEntryFinished?(entry: object): void;
}
interface Snapshotter {
  _delegate: NativeRecorder;
  stop(): void;
  dispose(): void;
  resetForReuse(): Promise<void>;
  captureSnapshot(...args: unknown[]): Promise<void>;
}
interface NativeFrame {
  listeners(event: string): ((...args: unknown[]) => void)[];
}
interface HarTracer {
  _entrySymbol: symbol;
  _pageEntries: Map<object, object>;
  _eventListeners: { emitter: NativeFrame; eventName: string; handler: (...args: unknown[]) => void }[];
  _onRequest(request: Record<symbol, object | undefined>): void;
  _onAPIRequest(event: Record<symbol, object | undefined>): void;
  _createPageEntryIfNeeded(page?: { mainFrame(): NativeFrame }): object | undefined;
  _onLoad(page: object, entry: object): void;
  _onDOMContentLoaded(page: object, entry: object): void;
  stop(): void;
}
interface StackSession {
  callStacks: TraceCallData[];
  file: string;
  writer: Promise<void>;
  live: boolean;
}
interface LocalUtils {
  _stackSessions: Map<string, StackSession>;
  tracingStarted(params: { tracesDir?: string; traceName: string; live: boolean }, progress: Progress): Promise<{ stacksId: string }>;
  traceDiscarded(params: { stacksId: string }, progress: Progress): Promise<void>;
  zip(params: { entries: TraceArchiveEntry[]; zipFile: string; stacksId?: string; mode: string; includeSources?: boolean }, progress: Progress): Promise<void>;
}
interface ClientTracing {
  _tracesDir?: string;
  _connection: {
    toImpl(value: unknown): unknown;
    localUtils(): { _guid: string } | undefined;
    isRemote(): boolean;
  };
  _resetStackCounter?(): void;
  start(options?: object): Promise<void>;
}
interface Reservation { bytes: number; released: boolean }
interface OwnedStacks { session: StackSession; reservations: Reservation[]; live: boolean; dirty: boolean }
interface OwnedRecord { reservation: Reservation; guard: ReturnType<typeof guardTraceRecord> }
interface DispatcherGuard { recordings: Map<string, Recording>; stacks: Map<string, Recording> }
const dispatchers = new WeakMap<LocalUtils, DispatcherGuard>();

export function validateTraceLimits(limits: TraceLimits): TraceLimits {
  for (const key of ["maxBytes", "maxFiles", "maxArchiveBytes"] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new TypeError(`Invalid Cloudflare trace ${key} limit`);
  return Object.freeze({ ...limits });
}

class Recording {
  readonly signal = new AbortController();
  readonly files = new Map<string, Reservation>();
  readonly stacks = new Map<string, OwnedStacks>();
  readonly operations = new Set<Promise<unknown>>();
  private readonly exportingStacks = new Set<OwnedStacks>();
  readonly syncNative: NativeFS["syncAndGetError"];
  private readonly retired: Reservation[] = [];
  private readonly pending = new Map<object, OwnedRecord>();
  private readonly records = new WeakMap<object, OwnedRecord>();
  private readonly pageRecords = new Set<OwnedRecord>();
  private readonly requestRecords = new Map<object, { request: Record<symbol, object | undefined>; symbol: symbol; value: object }>();
  private bytes = 0;
  private count = 0;
  private accepting = true;
  private producerStop?: Promise<void>;
  private disposal?: Promise<void>;
  private readonly captureStopErrors = new Map<string, unknown>();
  private readonly stopErrors = new Set<unknown>();
  failure?: Error;

  constructor(readonly native: NativeRecorder, readonly directory: string, readonly limits: TraceLimits, readonly local: LocalUtils, readonly dispatcher: DispatcherGuard) {
    const writer = native._fs;
    this.syncNative = writer.syncAndGetError.bind(writer);
    const mkdir = writer.mkdir.bind(writer), write = writer.writeFile.bind(writer);
    const append = writer.appendFile.bind(writer), copy = writer.copyFile.bind(writer);
    writer.mkdir = path => { if (this.accepting && (path === directory || this.owned(path))) mkdir(path); };
    writer.writeFile = (path, content, skipIfExists) => {
      if (!this.accepting || skipIfExists && this.files.has(path)) return;
      if (this.admitFile(path, Buffer.byteLength(content))) write(path, content, false);
    };
    writer.appendFile = (path, text, flush) => {
      if (text && this.admitFile(path, Buffer.byteLength(text), true)) append(path, text, flush);
    };
    writer.copyFile = (from, to) => {
      if (!this.accepting) return;
      const source = this.files.get(from);
      if (!source || !this.owned(from)) { this.fail(new Error("Unowned native trace copy")); return; }
      if (this.admitFile(to, source.bytes)) copy(from, to);
    };
    // The pinned in-process client exports entries through LocalUtils. Refuse a
    // changed provider route before its unbounded native ZIP collector runs.
    writer.zip = () => { this.fail(new Error("Bounded Cloudflare tracing requires in-process entries export")); };
    writer.syncAndGetError = async () => {
      const retired = this.retired.splice(0);
      const error = await this.syncNative();
      for (const reservation of retired) this.release(reservation);
      if (error) this.fail(error);
      return this.failure;
    };
    // Mutations must use the same guarded object in request storage, native
    // pending entries, and completion callbacks (including API requests).
    if (native.onEntryStarted && native.onEntryFinished) {
      const started = native.onEntryStarted.bind(native), finished = native.onEntryFinished.bind(native);
      native.onEntryStarted = entry => {
        const record = this.guardRecord(entry);
        if (!record) return;
        this.pending.set(record.guard.value, record);
        started(record.guard.value);
      };
      native.onEntryFinished = entry => {
        const record = this.pending.get(entry);
        if (!record) return;
        this.pending.delete(entry);
        this.release(record.reservation);
        if (this.accepting) finished(entry);
        this.dropRequest(entry);
        record.guard.stop();
      };
    }
    const har = native._harTracer;
    if (har) {
      for (const name of ["_onRequest", "_onAPIRequest"] as const) {
        const create = har[name].bind(har);
        har[name] = request => {
          if (!this.accepting) return;
          create(request);
          const original = request[har._entrySymbol];
          if (original) {
            const value = this.records.get(original)?.guard.value;
            request[har._entrySymbol] = value;
            if (value) this.requestRecords.set(value, { request, symbol: har._entrySymbol, value });
          }
        };
      }
      const setPage = har._pageEntries.set.bind(har._pageEntries);
      har._pageEntries.set = (page, entry) => {
        const record = this.guardRecord(entry);
        if (record) { this.pageRecords.add(record); setPage(page, record.guard.value); }
        return har._pageEntries;
      };
      const createPage = har._createPageEntryIfNeeded.bind(har);
      har._createPageEntryIfNeeded = page => {
        if (!this.accepting) return;
        const frame = page?.mainFrame();
        const before = new Set(frame?.listeners("addlifecycle"));
        const entry = createPage(page);
        // The provider does not enroll this listener itself. It is installed
        // synchronously by this call, so keep its exact identity for HAR.stop.
        for (const listener of frame?.listeners("addlifecycle") ?? []) if (!before.has(listener))
          har._eventListeners.push({ emitter: frame!, eventName: "addlifecycle", handler: listener });
        return entry ? this.records.get(entry)?.guard.value : undefined;
      };
      for (const name of ["_onLoad", "_onDOMContentLoaded"] as const) {
        const onLifecycle = har[name].bind(har);
        har[name] = (page, entry) => {
          const record = this.records.get(entry);
          if (this.accepting && record) onLifecycle(page, record.guard.value);
        };
      }
    }
    // Old HAR/snapshot callbacks keep this recorder, never the next generation.
    for (const name of ["_appendTraceEvent", "_appendResource", "onContentBlob", "onSnapshotterBlob", "onFrameSnapshot"] as const) {
      const methods = native as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
      const method = methods[name]?.bind(native);
      if (method) methods[name] = (...args) => { if (this.accepting) return method(...args); };
    }
  }

  private owned(path: string): boolean {
    const relative = path.slice(this.directory.length + 1);
    if (path.startsWith(`${this.directory}/`) && relative && relative.split("/").every(part => part && part !== "." && part !== "..")) return true;
    this.fail(new Error("Unowned native trace path"));
    return false;
  }
  private reserve(bytes: number): Reservation | undefined {
    if (!this.accepting) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.maxBytes - this.bytes) {
      this.fail(new PlaywrightResourceLimitError("Browser trace byte limit exceeded")); return;
    }
    if (this.count >= this.limits.maxFiles) { this.fail(new PlaywrightResourceLimitError("Browser trace file limit exceeded")); return; }
    this.bytes += bytes; this.count++;
    return { bytes, released: false };
  }
  private guardRecord(value: object): OwnedRecord | undefined {
    const previous = this.records.get(value);
    if (previous) return previous;
    const reservation = this.reserve(traceRecordBytes(value, this.limits.maxBytes));
    if (!reservation) return;
    const guard = guardTraceRecord(value, this.limits.maxBytes, bytes => {
      if (!this.accepting || reservation.released) return false;
      const growth = bytes - reservation.bytes;
      if (growth > this.limits.maxBytes - this.bytes) { this.fail(new PlaywrightResourceLimitError("Browser trace byte limit exceeded")); return false; }
      this.bytes += growth; reservation.bytes = bytes;
      return true;
    });
    const record = { reservation, guard };
    this.records.set(value, record); this.records.set(guard.value, record);
    return record;
  }
  private dropRequest(entry: object) {
    const owned = this.requestRecords.get(entry);
    if (!owned) return;
    if (owned.request[owned.symbol] === owned.value) delete owned.request[owned.symbol];
    this.requestRecords.delete(entry);
  }
  private release(reservation: Reservation) {
    if (reservation.released) return;
    reservation.released = true; this.bytes -= reservation.bytes; this.count--;
  }
  private admitFile(path: string, bytes: number, append = false): boolean {
    if (!this.accepting || !this.owned(path)) return false;
    const previous = this.files.get(path);
    if (append && previous) {
      if (bytes > this.limits.maxBytes - this.bytes) { this.fail(new PlaywrightResourceLimitError("Browser trace byte limit exceeded")); return false; }
      previous.bytes += bytes; this.bytes += bytes;
      return true;
    }
    const reservation = this.reserve(bytes);
    if (!reservation) return false;
    if (previous) this.retired.push(previous);
    this.files.set(path, reservation);
    return true;
  }
  fail(error: Error) {
    this.failure ??= error;
    this.signal.abort(this.failure);
    this.halt();
  }
  halt() {
    this.accepting = false;
    this.stopCapture();
    // Stop after the current producer callback returns: startChunk installs
    // listeners immediately after its first trace append.
    this.producerStop ??= Promise.resolve().then(async () => {
      if (!this.native._isStopping) await this.native.stopChunk(undefined, { mode: "discard" });
    }).catch(error => {
      this.stopErrors.add(error);
      this.failure ??= error instanceof Error ? error : new Error("Browser trace producer shutdown failed", { cause: error });
    });
  }
  private stopCapture() {
    const stop = (phase: string, operation: () => void) => {
      try { operation(); }
      catch (error) { if (!this.captureStopErrors.has(phase)) this.captureStopErrors.set(phase, error); }
    };
    // Provider close notifications run after synchronous tracing.abort(). Keep
    // cleanup failures for release without interrupting that notification path.
    if (this.native._harTracer) stop("har", () => this.native._harTracer!.stop());
    if (this.native._snapshotter) stop("snapshots", () => this.native._snapshotter!.stop());
    if (!this.native._harTracer && !this.native._snapshotter) stop("recorder", () => this.native.abort());
  }
  throwIfFailed() { if (this.failure) throw this.failure; }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.throwIfFailed();
    const work = Promise.resolve().then(operation);
    this.operations.add(work);
    try { const result = await work; this.throwIfFailed(); return result; }
    catch (error) { this.throwIfFailed(); throw error; }
    finally { this.operations.delete(work); }
  }
  async stop<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (this.failure) { await this.dispose(); return; }
    const work = Promise.resolve().then(operation);
    this.operations.add(work);
    let result: T | undefined;
    try { result = await work; }
    catch (error) {
      if (!this.failure) throw error;
      this.stopErrors.add(error);
    } finally { this.operations.delete(work); }
    // A recording limit rejects capture, but cannot prevent no-output teardown.
    // Retire after unenrolling this stop; disposal must never wait on itself.
    if (this.failure) await this.dispose();
    return result;
  }
  finish() { this.accepting = false; }

  startStacks(name: string, live: boolean): string {
    this.throwIfFailed();
    const file = `${this.directory}/${name}.stacks`;
    if (!this.owned(file)) { this.throwIfFailed(); }
    const previous = this.stacks.get(file);
    if (previous) {
      if (this.exportingStacks.has(previous)) throw new Error("Cannot replace browser trace stacks during export");
      this.dropStacks(file, previous);
    }
    const initial = this.reserve(Buffer.byteLength('{"files":[],"stacks":[]}'));
    if (!initial) { this.throwIfFailed(); throw new Error("Browser trace recording is closed"); }
    const session: StackSession = { callStacks: [], file, writer: Promise.resolve(), live: false };
    const owned: OwnedStacks = { session, reservations: [initial], live, dirty: false };
    // Avoid the provider's unbounded promise chain of full-array live rewrites.
    // The same admitted queue persists the current stack snapshot on check/stop.
    session.callStacks.push = (...calls) => {
      for (const call of calls) {
        const reservation = this.reserve(traceRecordBytes(call, this.limits.maxBytes));
        if (!reservation) break;
        owned.reservations.push(reservation);
        Array.prototype.push.call(session.callStacks, call);
        owned.dirty = true;
      }
      return session.callStacks.length;
    };
    this.stacks.set(file, owned);
    this.dispatcher.stacks.set(file, this);
    this.local._stackSessions.set(file, session);
    return file;
  }
  async discardStacks(id: string) {
    const owned = this.stacks.get(id);
    if (!owned) return;
    await owned.session.writer;
    this.dropStacks(id, owned);
  }
  private dropStacks(id: string, owned: OwnedStacks) {
    if (this.local._stackSessions.get(id) === owned.session) this.local._stackSessions.delete(id);
    this.dispatcher.stacks.delete(id);
    this.stacks.delete(id);
    owned.session.callStacks.length = 0;
    for (const reservation of owned.reservations) this.release(reservation);
  }
  async check(signal: AbortSignal) {
    signal.throwIfAborted();
    for (const { session, live, dirty } of this.stacks.values()) if (live && dirty && this.accepting) {
      this.native._fs.writeFile(session.file, serializeTraceStacks(session.callStacks));
      this.stacks.get(session.file)!.dirty = false;
    }
    const error = await this.native._fs.syncAndGetError();
    signal.throwIfAborted();
    if (error) throw error;
  }
  async zip(params: Parameters<LocalUtils["zip"]>[0], progress: Progress) {
    this.throwIfFailed();
    if (params.mode !== "write") throw new Error("Bounded Cloudflare tracing requires in-process entries export");
    const sourceReservations: Reservation[] = [];
    const stack = params.stacksId ? this.stacks.get(params.stacksId) : undefined;
    if (stack) this.exportingStacks.add(stack);
    const work = (async () => {
      const error = await this.native._fs.syncAndGetError();
      if (error) throw error;
      const calls = stack?.session.callStacks ?? [];
      await writeTraceArchive({ ...params, calls, includeSources: !!params.includeSources, limits: this.limits, signal: this.signal.signal,
        admitInput: (path, size, source) => {
          if (source) {
            const reservation = this.reserve(size);
            if (!reservation) {
              this.throwIfFailed(); this.signal.signal.throwIfAborted();
              throw new Error("Browser trace recording is closed");
            }
            sourceReservations.push(reservation);
          }
          else if (!this.owned(path) || !this.files.has(path) || size > this.files.get(path)!.bytes) throw new Error("Unadmitted native trace archive input");
        },
      });
      if (params.stacksId) await this.discardStacks(params.stacksId);
    })();
    this.operations.add(work);
    try { await progress.race(work); }
    catch (error) {
      this.fail(error instanceof Error ? error : new Error("Browser trace export failed", { cause: error }));
      await work.catch(() => {});
      throw error;
    } finally {
      this.operations.delete(work);
      if (stack) this.exportingStacks.delete(stack);
      for (const reservation of sourceReservations) this.release(reservation);
    }
  }
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.accepting = false;
      this.signal.abort(new Error("Browser trace recording closed"));
      this.stopCapture();
      await this.producerStop;
      while (this.operations.size) await Promise.allSettled([...this.operations]);
      // An export can fail and schedule producer shutdown while it is draining.
      await this.producerStop;
      const errors: unknown[] = [...this.captureStopErrors.values(), ...this.stopErrors];
      try { await this.native.stopChunk(undefined, { mode: "discard" }); } catch (error) { errors.push(error); }
      this.native._pendingHarEntries?.clear();
      try { await this.native.stop(); } catch (error) { errors.push(error); }
      const nativeError = await this.syncNative();
      if (nativeError) errors.push(nativeError);
      for (const id of this.stacks.keys()) await this.discardStacks(id);
      this.dispatcher.recordings.delete(this.directory);
      await rm(this.directory, { recursive: true, force: true });
      for (const record of [...this.pending.values(), ...this.pageRecords]) record.guard.stop();
      for (const entry of this.requestRecords.keys()) this.dropRequest(entry);
      this.files.clear(); this.retired.length = 0; this.pending.clear(); this.pageRecords.clear();
      if (errors.length) throw new AggregateError(errors, "Browser trace cleanup failed");
    })();
  }
}

function prepareDispatcher(local: LocalUtils): DispatcherGuard {
  const existing = dispatchers.get(local);
  if (existing) return existing;
  const guard: DispatcherGuard = { recordings: new Map(), stacks: new Map() };
  const started = local.tracingStarted.bind(local), discarded = local.traceDiscarded.bind(local), zip = local.zip.bind(local);
  local.tracingStarted = async (params, progress) => {
    const recording = params.tracesDir ? guard.recordings.get(params.tracesDir) : undefined;
    return recording ? { stacksId: recording.startStacks(params.traceName, params.live) } : started(params, progress);
  };
  local.traceDiscarded = (params, progress) => guard.stacks.get(params.stacksId)?.discardStacks(params.stacksId) ?? discarded(params, progress);
  local.zip = (params, progress) => {
    let recording = params.stacksId ? guard.stacks.get(params.stacksId) : undefined;
    for (const candidate of guard.recordings.values()) if (params.entries.some(entry => entry.value.startsWith(`${candidate.directory}/`))) {
      if (recording && recording !== candidate) throw new Error("Mixed native trace archive ownership");
      recording = candidate;
    }
    return recording ? recording.zip(params, progress) : zip(params, progress);
  };
  dispatchers.set(local, guard);
  return guard;
}

/** Private bridge qualified only against @cloudflare/playwright 1.3.6. A new
 * recorder owns every callback, dedup set, queue and pathname for one recording. */
export function prepareBrowserTraceBudget(context: BrowserContext, limits: TraceLimits): { check(signal: AbortSignal): Promise<void>; release(): Promise<void> } {
  const client = context.tracing as unknown as ClientTracing;
  const connection = client._connection;
  const native = connection?.toImpl(client) as NativeRecorder | undefined;
  const localClient = connection?.localUtils();
  const bridge = connection?.toImpl(connection) as { _dispatcherByGuid?: Map<string, LocalUtils> } | undefined;
  const local = localClient && bridge?._dispatcherByGuid?.get(localClient._guid);
  if (!native?._fs?.syncAndGetError || !local?._stackSessions || connection.isRemote()) throw new Error("Playwright provider does not support bounded native tracing");
  const Recorder = native.constructor as new (context: object, tracesDir: string) => NativeRecorder;
  const dispatcher = prepareDispatcher(local);
  const sourceStart = client.start.bind(client);
  const originalFS = native._fs;
  const snapshotter = native._snapshotter;
  let active: Recording | undefined;
  let starting = false;
  let startWork: Promise<void> | undefined;
  let released = false;
  if (snapshotter) {
    const capture = snapshotter.captureSnapshot.bind(snapshotter);
    snapshotter.captureSnapshot = (...args) => {
      const recording = active;
      return recording ? recording.run(() => capture(...args)) : Promise.resolve();
    };
  }
  const requireRecording = () => {
    if (!active) throw new Error("Native browser trace has not started");
    return active;
  };
  Object.defineProperties(native, {
    _state: { configurable: true, get: () => active?.native._state },
    _fs: { configurable: true, get: () => active?.native._fs ?? originalFS },
  });
  native.start = options => { const recording = requireRecording(); recording.native.start(options); recording.throwIfFailed(); };
  native.startChunk = (progress, options) => { const recording = requireRecording(); return recording.run(() => recording.native.startChunk(progress, options)); };
  native.stopChunk = async (progress, options) => {
    const recording = active;
    if (!recording) return {};
    if (options.mode !== "discard") return recording.run(() => recording.native.stopChunk(progress, options));
    const result = await recording.stop(() => recording.native.stopChunk(progress, options));
    if (recording.failure && active === recording) active = undefined;
    return result ?? {};
  };
  native.stop = async progress => {
    if (!active) return;
    const recording = active;
    await recording.stop(() => recording.native.stop(progress));
    if (recording.failure && active === recording) active = undefined;
    recording.finish();
  };
  native.group = (...args) => { if (active) { active.native.group(...args); active.throwIfFailed(); } };
  native.groupEnd = () => { if (active) { active.native.groupEnd(); active.throwIfFailed(); } };
  native.abort = () => { active?.halt(); };
  native.flush = async () => { await active?.dispose(); };
  native.resetForReuse = async () => { await active?.dispose(); await snapshotter?.resetForReuse(); active = undefined; };
  native.deleteTmpTracesDir = async () => { await active?.dispose(); };
  client.start = options => {
    if (released) return Promise.reject(new Error("Browser trace context is closed"));
    if (starting) return Promise.reject(new Error("Browser tracing is already starting"));
    if (active?.native._state && !active.failure) return sourceStart(options);
    starting = true;
    startWork = (async () => { try {
      if (active?.failure) client._resetStackCounter?.();
      await active?.dispose();
      const directory = await mkdtemp("/tmp/playwright-artifacts-");
      if (released) { await rm(directory, { recursive: true, force: true }); throw new Error("Browser trace context is closed"); }
      try {
        const recorder = new Recorder(native._context, directory);
        if (snapshotter) { recorder._snapshotter = snapshotter; snapshotter._delegate = recorder; }
        active = new Recording(recorder, directory, limits, local, dispatcher);
      }
      catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      dispatcher.recordings.set(directory, active);
      client._tracesDir = directory;
      try { await sourceStart(options); active.throwIfFailed(); }
      catch (error) { client._resetStackCounter?.(); await active.dispose(); throw error; }
    } finally { starting = false; } })();
    return startWork;
  };
  return {
    async check(signal) { signal.throwIfAborted(); await active?.check(signal); },
    async release() {
      released = true; await startWork?.catch(() => {}); await active?.dispose();
      snapshotter?.dispose();
    },
  };
}
