import { Worker } from "node:worker_threads";
import type { ByteSource } from "../../contracts/io.js";
import { defaults, inputBytes, policy, RegexExecutionError, validateReply, type Descriptor, type Match, type RegexExecutionOptions, type Row } from "./protocol.js";

export type { RegexExecutionOptions } from "./protocol.js";
export { RegexExecutionError } from "./protocol.js";

interface Pending {
  readonly descriptor: Descriptor;
  readonly rows: readonly Row[];
  readonly signal: AbortSignal;
  readonly bytes: number;
  readonly resolve: (matches: Match[][]) => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
  slot?: Slot;
}

class Slot {
  readonly worker: Worker;
  busy = true;
  ready = false;
  retired: Promise<void> | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  private receiver: ((value: unknown) => void) | undefined;
  private failure: ((error: unknown) => void) | undefined;
  private terminal: unknown;
  private exited = false;
  private readonly message = (value: unknown) => {
    if (this.receiver) this.receiver(value);
    else this.fail(new RegexExecutionError("PROTOCOL", "unexpected idle message"));
  };
  private readonly error = (error: Error) => this.fail(new RegexExecutionError("WORKER_ERROR", error.message));
  private readonly exit = (code: number) => {
    this.exited = true;
    this.fail(new RegexExecutionError("WORKER_EXIT", `worker exited (${code})`));
  };
  constructor(private readonly owner: RegexExecutor) {
    this.worker = new Worker(new URL(import.meta.url.endsWith(".ts") ? "../../../dist/commands/regex-execution/worker.js" : "./worker.js", import.meta.url), {
      execArgv: [], resourceLimits: {
        maxOldGenerationSizeMb: owner.options.workerOldGenerationMb,
        stackSizeMb: owner.options.workerStackMb,
      },
    });
    this.worker.on("message", this.message);
    this.worker.on("error", this.error);
    this.worker.on("exit", this.exit);
  }
  fail(error: unknown): void {
    this.terminal ??= error;
    if (this.failure) this.failure(error);
    else if (!this.busy) void this.retire();
  }
  exchange(timeout: number, startup: boolean, signal: AbortSignal, send?: () => void): Promise<unknown> {
    signal.throwIfAborted();
    if (this.terminal !== undefined) return Promise.reject(this.terminal);
    return new Promise((resolve, reject) => {
      const finish = (error: unknown, value?: unknown) => {
        clearTimeout(timer);
        this.receiver = undefined;
        this.failure = undefined;
        if (error !== undefined) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new RegexExecutionError(startup ? "STARTUP_TIMEOUT" : "REQUEST_TIMEOUT", `${startup ? "startup" : "active request"} exceeded ${timeout}ms`)), timeout);
      this.receiver = value => finish(undefined, value);
      this.failure = error => finish(error);
      try { signal.throwIfAborted(); send?.(); } catch (error) { finish(error); }
    });
  }
  retire(): Promise<void> {
    if (this.retired) return this.retired;
    clearTimeout(this.idleTimer);
    this.worker.ref();
    this.retired = (async () => {
      if (!this.exited) await this.worker.terminate();
    })().finally(() => {
      this.worker.off("message", this.message);
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
  private readonly queue: Pending[] = [];
  private queuedBytes = 0;
  private sessions = 0;
  private sequence = 0;
  private disposed = false;
  constructor(options: RegexExecutionOptions = defaults) { this.options = policy(options); }
  open(signal: AbortSignal): RegexSession {
    signal.throwIfAborted();
    if (this.disposed) throw new RegexExecutionError("CLOSED", "executor is disposed");
    this.sessions++;
    return new RegexSession(this, signal);
  }
  async close(): Promise<void> {
    this.sessions--;
    if (this.sessions === 0) await Promise.all([...this.slots].filter(slot => !slot.busy || slot.retired).map(slot => slot.retire()));
  }
  async dispose(): Promise<void> {
    this.disposed = true;
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
    this.slots.delete(slot);
    this.pump();
  }
  request(descriptor: Descriptor, rows: readonly Row[], signal: AbortSignal): Promise<Match[][]> {
    signal.throwIfAborted();
    if (this.disposed) return Promise.reject(new RegexExecutionError("CLOSED", "executor is disposed"));
    const bytes = inputBytes(descriptor, rows, signal);
    const available = this.queue.length === 0 && ([...this.slots].some(slot => !slot.busy && !slot.retired) || this.slots.size < this.options.maxWorkers);
    if (!available && (this.queue.length >= this.options.maxQueuedRequests || bytes > this.options.maxQueuedBytes - this.queuedBytes)) return Promise.reject(new RegexExecutionError("QUEUE_EXHAUSTED", "queued request count or input byte limit exceeded"));
    const ownedDescriptor = { ...descriptor, patterns: descriptor.patterns.map(pattern => { signal.throwIfAborted(); return pattern; }) };
    const ownedRows = rows.map(row => { signal.throwIfAborted(); return { ...row, bytes: Uint8Array.from(row.bytes) }; });
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        descriptor: ownedDescriptor, rows: ownedRows, signal, bytes, resolve, reject,
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
        slot.worker.ref();
        void this.run(slot, pending);
      } catch (error) {
        pending.signal.removeEventListener("abort", pending.abort);
        pending.reject(error);
      }
    }
  }
  private async run(slot: Slot, pending: Pending): Promise<void> {
    let result: Match[][] | undefined;
    let failure: unknown;
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
      const reply = await slot.exchange(this.options.requestTimeoutMs, false, pending.signal, () => slot.worker.postMessage({ id, descriptor: pending.descriptor, rows: pending.rows }));
      result = validateReply(reply, id, pending.rows, pending.signal);
      if (performance.now() - started > this.options.requestTimeoutMs) throw new RegexExecutionError("REQUEST_TIMEOUT", `active request exceeded ${this.options.requestTimeoutMs}ms`);
      pending.signal.throwIfAborted();
    } catch (error) {
      failure = pending.signal.aborted ? pending.signal.reason : error;
      try { await slot.retire(); } catch { }
    } finally {
      pending.signal.removeEventListener("abort", pending.abort);
      slot.busy = false;
      if (slot.retired) this.retired(slot);
      else {
        slot.worker.unref();
        slot.idleTimer = setTimeout(() => { if (!slot.busy) void slot.retire(); }, this.options.idleTimeoutMs);
        slot.idleTimer.unref();
      }
      this.pump();
    }
    if (failure !== undefined) pending.reject(failure); else pending.resolve(result!);
  }
}

export class RegexSession {
  private closed: Promise<void> | undefined;
  private readonly pending = new Set<Promise<Match[][]>>();
  constructor(private readonly executor: RegexExecutor, private readonly signal: AbortSignal) {}
  run(descriptor: Descriptor, rows: readonly Row[]): Promise<Match[][]> {
    this.signal.throwIfAborted();
    if (this.closed) throw new RegexExecutionError("CLOSED", "invocation is closed");
    const result = this.executor.request(descriptor, rows, this.signal);
    this.pending.add(result);
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result));
    return result;
  }
  close(): Promise<void> {
    return this.closed ??= (async () => {
      await Promise.allSettled([...this.pending]);
      await this.executor.close();
    })();
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
