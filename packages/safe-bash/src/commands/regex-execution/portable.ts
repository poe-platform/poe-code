import type { BoundedRegexProvider, RegexWorker } from "./provider.js";
import type { CommandContext, CommandResult } from "../../contracts/command.js";
import type { ByteSource } from "../../contracts/io.js";
import { inProcessRegexProviders, inProcessRegexWorkers, inputBytes, policy, RegexExecutionError, reusableTrustedRequest, trustedInputRows, trustedWorkerRequests, validateReply, validateExprInput, validateExprReply, validateBreSearchInput, validateBreSearchReply, type BreSearchDescriptor, type BreSearchResult, type ExprMatchDescriptor, type ExprMatchResult, type Descriptor, type Match, type RegexExecutionOptions, type Row } from "./protocol.js";

export type { RegexExecutionOptions } from "./protocol.js";
export { RegexExecutionError } from "./protocol.js";

const resolvedVoid = Promise.resolve();
const closedSessionError = new RegexExecutionError("CLOSED", "invocation is closed");
const sharedEmptyRetirements = new Set<Promise<void>>();
const idleProviderSlots = new WeakMap<object, Set<() => void>>();

interface Pending {
  readonly descriptor: Descriptor | ExprMatchDescriptor | BreSearchDescriptor;
  readonly rows: readonly Row[];
  readonly signal: AbortSignal;
  readonly bytes: number;
  readonly resolve: (matches: Match[][] | ExprMatchResult | BreSearchResult) => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
  readonly retirements: Set<Promise<void>>;
  slot?: Slot;
}

async function awaitRetirements(retirements: Iterable<Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(retirements);
  const failures = results.filter(result => result.status === "rejected").map(result => result.reason as unknown);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "regex retirement failed");
}

export async function withRegexSession(
  context: CommandContext,
  executor: RegexExecutor,
  execute: (session: RegexSession) => CommandResult | Promise<CommandResult>,
): Promise<CommandResult> {
  context.signal.throwIfAborted();
  let session: RegexSession | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) {
      if (!session || session.canCloseSync()) {
        session?.closeSync();
        closing = resolvedVoid;
      } else {
        closing = session.close();
      }
    }
    return closing;
  };
  try { context.registerCleanup?.(close); }
  catch (error) { context.signal.throwIfAborted(); throw error; }
  let outcome: { result: CommandResult } | { error: unknown };
  try {
    context.signal.throwIfAborted();
    if (closing) throw new RegexExecutionError("CLOSED", "invocation is closed");
    session = executor.open(context.signal);
    outcome = { result: await execute(session) };
  } catch (error) {
    outcome = { error };
  }
  let cleanupFailure: { error: unknown } | undefined;
  try {
    if (!closing && (!session || session.canCloseSync())) {
      session?.closeSync();
      closing = resolvedVoid;
    } else {
      await close();
    }
  }
  catch (error) { cleanupFailure = { error }; }
  context.signal.throwIfAborted();
  if ("error" in outcome) throw outcome.error;
  if (cleanupFailure) throw cleanupFailure.error;
  return outcome.result;
}

class Slot {
  readonly worker: RegexWorker;
  readonly inProcess: boolean;
  busy = true;
  ready = false;
  retired: Promise<void> | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  private receiver: ((value: unknown) => void) | undefined;
  private failure: ((error: unknown) => void) | undefined;
  private static readonly syncResultBox: { sync: true; value: unknown } = { sync: true, value: undefined };
  private syncSettled = false;
  private syncRejected = false;
  private syncValue: unknown;
  private readonly syncReceiver = (value: unknown) => {
    this.syncSettled = true;
    this.syncRejected = false;
    this.syncValue = value;
  };
  private readonly syncFailure = (error: unknown) => {
    this.syncSettled = true;
    this.syncRejected = true;
    this.syncValue = error;
  };
  private readonly onIdleTimeout = () => {
    if (!this.busy) void this.retire();
  };
  terminal: unknown;
  private exited = false;
  private readonly message = (value: unknown) => {
    if (this.inProcess && value !== null && typeof value === "object" && (value as { ready?: unknown }).ready === true) return;
    if (this.receiver) this.receiver(value);
    else this.fail(new RegexExecutionError("PROTOCOL", "unexpected idle message"));
  };
  private readonly error = (error: Error) => this.fail(new RegexExecutionError("WORKER_ERROR", "internal error", { cause: error }));
  private readonly messageerror = () => this.fail(new RegexExecutionError("PROTOCOL", "worker message could not be deserialized"));
  private readonly exit = (code: number) => {
    this.exited = true;
    this.fail(new RegexExecutionError("WORKER_EXIT", `worker exited (${code})`));
  };
  constructor(private readonly owner: RegexExecutor) {
    this.worker = owner.provider.createWorker(owner.options);
    this.inProcess = inProcessRegexWorkers.has(this.worker);
    if (this.inProcess) {
      this.ready = true;
      this.busy = false;
    }
    this.worker.on("message", this.message);
    this.worker.on("messageerror", this.messageerror);
    this.worker.on("error", this.error);
    this.worker.on("exit", this.exit);
  }
  fail(error: unknown): void {
    this.terminal ??= error;
    if (this.failure) this.failure(error);
    else if (!this.busy) void this.retire();
  }
  exchangeSyncOrAsync(timeout: number, startup: boolean, signal: AbortSignal, send?: () => void): { sync: true; value: unknown } | { sync: false; promise: Promise<unknown> } {
    signal.throwIfAborted();
    if (this.terminal !== undefined) return { sync: false, promise: Promise.reject(this.terminal) };
    let settled = false;
    let isRejected = false;
    let settledValue: unknown;
    let resolvePromise: ((v: unknown) => void) | undefined;
    let rejectPromise: ((e: unknown) => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (rej: boolean, value: unknown) => {
      if (timer !== undefined) clearTimeout(timer);
      this.receiver = undefined;
      this.failure = undefined;
      if (resolvePromise) {
        if (rej) rejectPromise!(value);
        else resolvePromise(value);
      } else {
        settled = true;
        isRejected = rej;
        settledValue = value;
      }
    };
    this.receiver = value => finish(false, value);
    this.failure = error => finish(true, error);
    try { signal.throwIfAborted(); send?.(); } catch (error) { finish(true, error); }
    if (settled) {
      if (isRejected) return { sync: false, promise: Promise.reject(settledValue) };
      return { sync: true, value: settledValue };
    }
    return {
      sync: false,
      promise: new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
        timer = timeout === Infinity ? undefined : setTimeout(() => finish(true, new RegexExecutionError(startup ? "STARTUP_TIMEOUT" : "REQUEST_TIMEOUT", `${startup ? "startup" : "active request"} exceeded ${timeout}ms`)), timeout);
      }),
    };
  }
  armIdleTimer(idleTimeoutMs: number): void {
    if (this.idleTimer === undefined && idleTimeoutMs !== Infinity) {
      this.idleTimer = setTimeout(this.onIdleTimeout, idleTimeoutMs);
      this.idleTimer?.unref?.();
    }
  }
  postInProcessSync(message: { id: number; descriptor: Descriptor; rows: readonly Row[] }, timeout: number, signal: AbortSignal): { sync: true; value: unknown } | { sync: false; promise: Promise<unknown> } {
    signal.throwIfAborted();
    if (this.terminal !== undefined) return { sync: false, promise: Promise.reject(this.terminal) };
    this.syncSettled = false;
    this.syncRejected = false;
    this.syncValue = undefined;
    this.receiver = this.syncReceiver;
    this.failure = this.syncFailure;
    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.syncSettled = true;
      this.syncRejected = true;
      this.syncValue = error;
    }
    if (this.syncSettled) {
      this.receiver = undefined;
      this.failure = undefined;
      const val = this.syncValue;
      this.syncValue = undefined;
      if (this.syncRejected) return { sync: false, promise: Promise.reject(val) };
      Slot.syncResultBox.value = val;
      return Slot.syncResultBox;
    }
    return this.awaitInProcessAsync(timeout, signal);
  }
  private awaitInProcessAsync(timeout: number, signal: AbortSignal): { sync: false; promise: Promise<unknown> } {
    return {
      sync: false,
      promise: new Promise((resolve, reject) => {
        const timer = timeout === Infinity ? undefined : setTimeout(() => {
          this.receiver = undefined;
          this.failure = undefined;
          reject(new RegexExecutionError("REQUEST_TIMEOUT", `active request exceeded ${timeout}ms`));
        }, timeout);
        this.receiver = value => {
          if (timer !== undefined) clearTimeout(timer);
          this.receiver = undefined;
          this.failure = undefined;
          resolve(value);
        };
        this.failure = error => {
          if (timer !== undefined) clearTimeout(timer);
          this.receiver = undefined;
          this.failure = undefined;
          reject(error);
        };
      }),
    };
  }
  exchange(timeout: number, startup: boolean, signal: AbortSignal, send?: () => void): Promise<unknown> {
    const res = this.exchangeSyncOrAsync(timeout, startup, signal, send);
    return res.sync ? Promise.resolve(res.value) : res.promise;
  }
  retire(): Promise<void> {
    if (this.retired) return this.retired;
    clearTimeout(this.idleTimer);
    this.worker.ref?.();
    this.retired = (async () => {
      if (!this.exited) await this.worker.terminate();
    })().finally(() => {
      this.worker.off("message", this.message);
      this.worker.off("messageerror", this.messageerror);
      this.worker.off("error", this.error);
      this.worker.off("exit", this.exit);
      this.receiver = undefined;
      this.failure = undefined;
      if (!this.busy) this.owner.retired(this);
    });
    void this.retired.catch(() => {});
    return this.retired;
  }
}

export class RegexExecutor {
  readonly options: Required<RegexExecutionOptions>;
  private readonly slots = new Set<Slot>();
  private cachedReadySlot: Slot | undefined;
  private readonly idleEvictor = (): void => {
    if (this.sessions === 0 && this.cachedReadySlot && !this.cachedReadySlot.busy && !this.cachedReadySlot.retired) {
      void this.cachedReadySlot.retire();
    }
  };
  private readonly queue: Pending[] = [];
  private queuedBytes = 0;
  private sessions = 0;
  private sequence = 0;
  private disposed = false;
  constructor(readonly provider: BoundedRegexProvider, options: RegexExecutionOptions = {}) {
    if (!provider || typeof provider.createWorker !== "function") throw new TypeError("a bounded regex provider is required");
    this.options = policy(options);
  }
  open(signal: AbortSignal): RegexSession {
    signal.throwIfAborted();
    if (this.disposed) throw new RegexExecutionError("CLOSED", "executor is disposed");
    if (this.sessions === 0 && this.cachedReadySlot !== undefined) {
      idleProviderSlots.get(this.provider)?.delete(this.idleEvictor);
    }
    this.sessions++;
    return new RegexSession(this, signal);
  }
  canCloseSync(): boolean {
    if (this.sessions > 1) return true;
    if (this.slots.size === 0) return true;
    if (
      this.slots.size === 1 &&
      this.cachedReadySlot !== undefined &&
      this.cachedReadySlot.inProcess &&
      !this.cachedReadySlot.busy &&
      !this.cachedReadySlot.retired &&
      this.cachedReadySlot.ready &&
      this.cachedReadySlot.terminal === undefined
    ) {
      return true;
    }
    return false;
  }
  closeSync(): void {
    this.sessions--;
    if (this.sessions === 0 && this.cachedReadySlot !== undefined) {
      let evictors = idleProviderSlots.get(this.provider);
      if (!evictors) {
        evictors = new Set();
        idleProviderSlots.set(this.provider, evictors);
      }
      evictors.add(this.idleEvictor);
    }
  }
  async close(): Promise<void> {
    if (this.canCloseSync()) {
      this.closeSync();
      return;
    }
    this.sessions--;
    if (this.sessions === 0) await awaitRetirements([...this.slots].filter(slot => !slot.busy || slot.retired).map(slot => slot.retire()));
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    idleProviderSlots.get(this.provider)?.delete(this.idleEvictor);
    const error = new RegexExecutionError("CLOSED", "executor is disposed");
    for (const pending of this.queue.splice(0)) {
      pending.signal.removeEventListener("abort", pending.abort);
      pending.reject(error);
    }
    this.queuedBytes = 0;
    for (const slot of this.slots) slot.fail(error);
    await Promise.all([...this.slots].map(slot => slot.retire()));
  }
  retired(slot: Slot): void {
    if (this.cachedReadySlot === slot) this.cachedReadySlot = undefined;
    this.slots.delete(slot);
    this.pump();
  }
  private findReadySlot(): Slot | undefined {
    const cached = this.cachedReadySlot;
    if (cached !== undefined && !cached.busy && !cached.retired && cached.ready && cached.terminal === undefined) {
      return cached;
    }
    for (const candidate of this.slots) {
      if (!candidate.busy && !candidate.retired && candidate.ready && candidate.terminal === undefined) {
        this.cachedReadySlot = candidate;
        return candidate;
      }
    }
    if (this.slots.size < this.options.maxWorkers && inProcessRegexProviders.has(this.provider)) {
      const evictors = idleProviderSlots.get(this.provider);
      if (evictors?.size) {
        const first = evictors.values().next().value as () => void;
        evictors.delete(first);
        first();
      }
      const candidate = new Slot(this);
      this.slots.add(candidate);
      if (!candidate.busy && candidate.ready && candidate.terminal === undefined) {
        this.cachedReadySlot = candidate;
        return candidate;
      }
    }
    return undefined;
  }
  private exchangeOutOfProcessSyncOrAsync(readySlot: Slot, id: number, descriptor: Descriptor, rows: readonly Row[], signal: AbortSignal) {
    const workerRows = rows.map(row => ({ bytes: row.bytes, all: row.all, terminated: row.terminated, ...(row.directory !== undefined ? { directory: row.directory } : {}), ...(row.ancestors !== undefined ? { ancestors: row.ancestors } : {}) }));
    const message = { id, descriptor, rows: workerRows };
    trustedWorkerRequests.add(message);
    return readySlot.exchangeSyncOrAsync(this.options.requestTimeoutMs, false, signal, () => readySlot.worker.postMessage(message));
  }
  private finishSyncRequestAsync(readySlot: Slot, promise: Promise<unknown>, id: number, rows: readonly Row[], signal: AbortSignal, retirements: Set<Promise<void>>): Promise<Match[][]> {
    clearTimeout(readySlot.idleTimer);
    readySlot.idleTimer = undefined;
    readySlot.worker.ref?.();
    const onAbort = () => readySlot.fail(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    return promise.then(
      reply => {
        const validated = validateReply(reply, id, rows, signal);
        signal.throwIfAborted();
        return validated;
      },
      async error => {
        const retirement = readySlot.retire();
        retirements.add(retirement);
        try { await retirement; } catch {}
        throw signal.aborted ? signal.reason : error;
      },
    ).finally(() => {
      signal.removeEventListener("abort", onAbort);
      readySlot.busy = false;
      if (readySlot.retired) this.retired(readySlot);
      else {
        readySlot.worker.unref?.();
        readySlot.armIdleTimer(this.options.idleTimeoutMs);
      }
      this.pump();
    });
  }
  requestSyncOrAsync(descriptor: Descriptor, rows: readonly Row[], signal: AbortSignal, retirements: Set<Promise<void>>): Match[][] | Promise<Match[][]> {
    signal.throwIfAborted();
    if (this.disposed) return Promise.reject(new RegexExecutionError("CLOSED", "executor is disposed"));
    if (this.queue.length === 0 && trustedInputRows.has(rows)) {
      const readySlot = this.findReadySlot();
      if (readySlot) {
        const id = ++this.sequence;
        readySlot.busy = true;
        let ex: { sync: true; value: unknown } | { sync: false; promise: Promise<unknown> };
        if (readySlot.inProcess) {
          reusableTrustedRequest.id = id;
          reusableTrustedRequest.descriptor = descriptor;
          reusableTrustedRequest.rows = rows;
          ex = readySlot.postInProcessSync(reusableTrustedRequest, this.options.requestTimeoutMs, signal);
        } else {
          ex = this.exchangeOutOfProcessSyncOrAsync(readySlot, id, descriptor, rows, signal);
        }
        if (ex.sync) {
          try {
            const validated = validateReply(ex.value, id, rows, signal);
            signal.throwIfAborted();
            return validated;
          } catch (error) {
            const retirement = readySlot.retire();
            retirements.add(retirement);
            throw signal.aborted ? signal.reason : error;
          } finally {
            readySlot.busy = false;
            if (readySlot.retired) this.retired(readySlot);
            else readySlot.armIdleTimer(this.options.idleTimeoutMs);
            if (this.queue.length > 0) this.pump();
          }
        }
        return this.finishSyncRequestAsync(readySlot, ex.promise, id, rows, signal, retirements);
      }
    }
    return this.request(descriptor, rows, signal, retirements);
  }
  request(descriptor: Descriptor, rows: readonly Row[], signal: AbortSignal, retirements?: Set<Promise<void>>): Promise<Match[][]>;
  request(descriptor: ExprMatchDescriptor, rows: readonly Row[], signal: AbortSignal, retirements?: Set<Promise<void>>): Promise<ExprMatchResult>;
  request(descriptor: BreSearchDescriptor, rows: readonly Row[], signal: AbortSignal, retirements?: Set<Promise<void>>): Promise<BreSearchResult>;
  request(descriptor: Descriptor | ExprMatchDescriptor | BreSearchDescriptor, rows: readonly Row[], signal: AbortSignal, retirements = new Set<Promise<void>>()): Promise<Match[][] | ExprMatchResult | BreSearchResult> {
    signal.throwIfAborted();
    if (this.disposed) return Promise.reject(new RegexExecutionError("CLOSED", "executor is disposed"));
    if (descriptor.kind === "expr-match") validateExprInput(descriptor, rows, signal);
    if (descriptor.kind === "bre-search") validateBreSearchInput(descriptor, rows, signal);
    const bytes = (descriptor.kind === "expr-match" || descriptor.kind === "bre-search") ? 256 + descriptor.pattern.length + rows[0]!.bytes.length : inputBytes(descriptor, rows, signal);
    const available = this.queue.length === 0 && ([...this.slots].some(slot => !slot.busy && !slot.retired) || this.slots.size < this.options.maxWorkers);
    if (!available && (this.queue.length >= this.options.maxQueuedRequests || bytes > this.options.maxQueuedBytes - this.queuedBytes)) return Promise.reject(new RegexExecutionError("QUEUE_EXHAUSTED", "queued request count or input byte limit exceeded"));
    const ownedDescriptor: Descriptor | ExprMatchDescriptor | BreSearchDescriptor = (descriptor.kind === "expr-match" || descriptor.kind === "bre-search")
      ? { ...descriptor, pattern: new Uint8Array(descriptor.pattern), limits: { ...descriptor.limits } }
      : { ...descriptor, patterns: descriptor.patterns.map(pattern => { signal.throwIfAborted(); return pattern; }) };
    if (ownedDescriptor.kind === "glob") {
      const globOptions = ownedDescriptor.globOptions.map(options => { signal.throwIfAborted(); return { ...options }; });
      Object.assign(ownedDescriptor, { globOptions });
    }
    const ownedRows = rows.map(row => { signal.throwIfAborted(); return { bytes: new Uint8Array(row.bytes), all: row.all, terminated: row.terminated, ...(row.directory !== undefined ? { directory: row.directory } : {}), ...(row.ancestors !== undefined ? { ancestors: row.ancestors } : {}) }; });
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        descriptor: ownedDescriptor, rows: ownedRows, signal, bytes, resolve, reject, retirements,
        abort: () => {
          if (pending.slot) pending.slot.fail(signal.reason);
          else {
            const index = this.queue.indexOf(pending);
            if (index >= 0) { this.queue.splice(index, 1); this.queuedBytes -= bytes; }
            signal.removeEventListener("abort", pending.abort);
            reject(signal.reason);
            this.pump();
          }
        },
      };
      signal.addEventListener("abort", pending.abort, { once: true });
      this.queue.push(pending);
      this.queuedBytes += bytes;
      this.pump();
    });
  }
  private pump(): void {
    if (this.disposed) return;
    while (this.queue.length) {
      let slot = [...this.slots].find(candidate => !candidate.busy && !candidate.retired);
      if (!slot && this.slots.size >= this.options.maxWorkers) return;
      const pending = this.queue.shift()!;
      this.queuedBytes -= pending.bytes;
      try {
        pending.signal.throwIfAborted();
        if (!slot) { slot = new Slot(this); this.slots.add(slot); }
        slot.busy = true;
        pending.slot = slot;
        clearTimeout(slot.idleTimer);
        slot.worker.ref?.();
        void this.run(slot, pending);
      } catch (error) {
        pending.signal.removeEventListener("abort", pending.abort);
        pending.reject(error);
      }
    }
  }
  private async run(slot: Slot, pending: Pending): Promise<void> {
    let result: Match[][] | ExprMatchResult | BreSearchResult | undefined;
    let failure: unknown;
    let rejected = false;
    try {
      pending.signal.throwIfAborted();
      if (!slot.ready) {
        const ready = await slot.exchange(this.options.startupTimeoutMs, true, pending.signal);
        if (!ready || typeof ready !== "object" || !("ready" in ready) || ready.ready !== true) throw new RegexExecutionError("PROTOCOL", "invalid startup reply");
        slot.ready = true;
      }
      pending.signal.throwIfAborted();
      const id = ++this.sequence;
      const started = performance.now();
      const message = { id, descriptor: pending.descriptor, rows: pending.rows };
      trustedWorkerRequests.add(message);
      const reply = await slot.exchange(this.options.requestTimeoutMs, false, pending.signal, () => slot.worker.postMessage(message));
      result = pending.descriptor.kind === "expr-match"
        ? validateExprReply(reply, id, pending.descriptor, pending.rows[0]!.bytes, pending.signal)
        : pending.descriptor.kind === "bre-search"
          ? validateBreSearchReply(reply, id, pending.descriptor, pending.rows[0]!.bytes, pending.signal)
          : validateReply(reply, id, pending.rows, pending.signal);
      if (performance.now() - started > this.options.requestTimeoutMs) throw new RegexExecutionError("REQUEST_TIMEOUT", `active request exceeded ${this.options.requestTimeoutMs}ms`);
      pending.signal.throwIfAborted();
    } catch (error) {
      rejected = true;
      failure = pending.signal.aborted ? pending.signal.reason : error;
      const retirement = slot.retire();
      pending.retirements.add(retirement);
      try { await retirement; } catch { }
    } finally {
      pending.signal.removeEventListener("abort", pending.abort);
      slot.busy = false;
      if (slot.retired) this.retired(slot);
      else {
        slot.worker.unref?.();
        slot.idleTimer = this.options.idleTimeoutMs === Infinity ? undefined : setTimeout(() => { if (!slot.busy) void slot.retire(); }, this.options.idleTimeoutMs);
        slot.idleTimer?.unref?.();
      }
      this.pump();
    }
    if (rejected) pending.reject(failure); else pending.resolve(result!);
  }
}

export class RegexSession {
  private closed: Promise<void> | undefined;
  private pending: Set<Promise<Match[][] | ExprMatchResult | BreSearchResult>> | undefined;
  private retirements: Set<Promise<void>> = sharedEmptyRetirements;
  private controller: AbortController | undefined;
  private requestSignal: AbortSignal;
  constructor(private readonly executor: RegexExecutor, private readonly signal: AbortSignal) {
    this.requestSignal = signal;
  }
  private ensureAsyncState(): AbortSignal {
    if (!this.controller) {
      this.controller = new AbortController();
      if (this.closed) this.controller.abort(this.signal.aborted ? this.signal.reason : closedSessionError);
      this.requestSignal = AbortSignal.any([this.signal, this.controller.signal]);
      this.retirements = new Set();
    }
    return this.requestSignal;
  }
  private trackPending<T extends Match[][] | ExprMatchResult | BreSearchResult>(result: Promise<T>): Promise<T> {
    this.ensureAsyncState();
    const pending = this.pending ??= new Set();
    pending.add(result);
    const cleanup = () => pending.delete(result);
    void result.then(cleanup, cleanup);
    return result;
  }
  runSync(descriptor: Descriptor, rows: readonly Row[]): Match[][] | Promise<Match[][]> {
    this.signal.throwIfAborted();
    if (this.closed) throw new RegexExecutionError("CLOSED", "invocation is closed");
    const result = this.executor.requestSyncOrAsync(descriptor, rows, this.requestSignal, this.retirements);
    if (!(result instanceof Promise)) return result;
    return this.trackPending(result);
  }
  run(descriptor: Descriptor, rows: readonly Row[]): Promise<Match[][]> {
    const res = this.runSync(descriptor, rows);
    return res instanceof Promise ? res : Promise.resolve(res);
  }
  matchExpr(descriptor: ExprMatchDescriptor, subject: Uint8Array): Promise<ExprMatchResult> {
    this.signal.throwIfAborted();
    if (this.closed) throw new RegexExecutionError("CLOSED", "invocation is closed");
    const sig = this.ensureAsyncState();
    const result = this.executor.request(descriptor, [{ bytes: subject, all: false, terminated: false }], sig, this.retirements);
    return this.trackPending(result);
  }
  searchBre(descriptor: BreSearchDescriptor, subject: Uint8Array): Promise<BreSearchResult> {
    this.signal.throwIfAborted();
    if (this.closed) throw new RegexExecutionError("CLOSED", "invocation is closed");
    const sig = this.ensureAsyncState();
    const result = this.executor.request(descriptor, [{ bytes: subject, all: false, terminated: false }], sig, this.retirements);
    return this.trackPending(result);
  }
  canCloseSync(): boolean {
    return !this.pending?.size && this.retirements.size === 0 && this.executor.canCloseSync();
  }
  closeSync(): void {
    if (!this.closed) {
      this.closed = resolvedVoid;
      this.controller?.abort(this.signal.aborted ? this.signal.reason : closedSessionError);
      this.executor.closeSync();
    }
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    if (this.canCloseSync()) {
      this.closeSync();
      return resolvedVoid;
    }
    return this.closed ??= Promise.resolve().then(async () => {
      this.controller?.abort(this.signal.aborted ? this.signal.reason : closedSessionError);
      try { if (this.pending?.size) await Promise.allSettled([...this.pending]); }
      finally {
        const rets = this.retirements.size ? [...this.retirements] : [];
        if (this.retirements === sharedEmptyRetirements) this.retirements.clear();
        await awaitRetirements([...rets, this.executor.close()]);
      }
    });
  }
}

export class AvailableRecords {
  private chunk = new Uint8Array(0);
  private offset = 0;
  constructor(private readonly delimiter: number, private readonly maxLineBytes: number, private readonly extraDelimiter = -1) {}
  async *source(source: ByteSource): ByteSource {
    for await (const chunk of source) {
      this.chunk = Uint8Array.from(chunk);
      this.offset = 0;
      yield this.chunk;
    }
  }
  private end(): number {
    if (this.extraDelimiter === -1) {
      return this.chunk.indexOf(this.delimiter, this.offset);
    }
    for (let offset = this.offset; offset < this.chunk.length; offset++) {
      if (this.chunk[offset] === this.delimiter || this.chunk[offset] === this.extraDelimiter) return offset;
    }
    return -1;
  }
  async *batches<Line>(source: AsyncIterable<Line>, size: (line: Line) => number, maxRecords: () => number = () => 128): AsyncGenerator<Line[]> {
    let batch: Line[] = [];
    let bytes = 0;
    for await (const line of source) {
      const end = this.end();
      this.offset = end < 0 ? this.chunk.length : end + 1;
      batch.push(line);
      bytes += size(line);
      const next = this.end();
      if (batch.length >= maxRecords() || bytes >= 64 * 1024 || next < 0 || bytes + next - this.offset > 64 * 1024 || next - this.offset > this.maxLineBytes) {
        yield batch;
        batch = [];
        bytes = 0;
      }
    }
    if (batch.length) yield batch;
  }
}
