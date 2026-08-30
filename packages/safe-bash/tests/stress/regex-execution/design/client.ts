import { Worker } from "node:worker_threads";
import { caps, descriptors, result, rows, type Descriptor, type Result, type Row } from "./protocol.js";

export class Capacity {
  private active = 0;
  acquire(): () => void {
    if (this.active) throw new Error("CAPACITY_BUSY");
    this.active++;
    return () => { this.active--; };
  }
}

export class Client {
  readonly metrics = { created: 0, terminated: 0, requests: 0, execCalls: 0, inputBytes: 0, responseBytes: 0, startupMs: 0, workMs: 0, terminationMs: 0, peakInflight: 0, listenersAfter: -1, exitCode: null as number | null };
  private worker: Worker | undefined;
  private release: (() => void) | undefined;
  private pending: { id: number; resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  private stopPromise: Promise<void> | undefined;
  private ended: unknown;
  private busy = false;
  private initialized = false;
  private sequence = 0;
  private readonly abort = () => { this.fail(this.signal!.reason); void this.dispose().catch(() => {}); };
  constructor(private readonly patterns: Descriptor[], private readonly capacity: Capacity, private readonly signal?: AbortSignal) {}
  private fail(error: unknown): void {
    this.ended ??= error;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  private check(): void {
    this.signal?.throwIfAborted();
    if (this.ended !== undefined) throw this.ended;
  }
  private readonly message = (value: unknown): void => {
    if (this.ended !== undefined) return;
    const reply = value as { ready?: boolean; id?: number; ok?: boolean; data?: unknown; error?: string };
    const pending = this.pending;
    if (!pending) { this.fail(new Error("UNEXPECTED_REPLY")); return; }
    if (pending.id === 0 ? !reply || Object.keys(reply).join() !== "ready" || reply.ready !== true : !reply || reply.id !== pending.id || (reply.ok === true ? Object.keys(reply).sort().join() !== "data,id,ok" : reply.ok !== false || Object.keys(reply).sort().join() !== "error,id,ok" || typeof reply.error !== "string" || reply.error.length > 512)) {
      this.fail(new Error("RESPONSE_PROTOCOL")); return;
    }
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (reply.ok === false) pending.reject(new Error(reply.error));
    else pending.resolve(reply.data);
  };
  private readonly error = (error: Error): void => { this.fail(error); void this.dispose().catch(() => {}); };
  private readonly exit = (code: number): void => { this.metrics.exitCode = code; this.fail(new Error("WORKER_EXIT")); void this.dispose().catch(() => {}); };
  private wait(id: number, timeout: number, send?: () => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(id === 0 ? "STARTUP_DEADLINE" : "WORK_DEADLINE")), timeout);
      this.pending = { id, resolve, reject, timer };
      this.metrics.peakInflight = 1;
      try { this.check(); send?.(); } catch (error) { this.fail(error); }
    });
  }
  private async request(kind: "init" | "scan", data: unknown): Promise<unknown> {
    this.check();
    if (++this.metrics.requests > caps.calls || this.metrics.workMs >= caps.workMs) throw new Error("COMMAND_WORK_CAP");
    const start = performance.now();
    const id = ++this.sequence;
    try { return await this.wait(id, Math.min(caps.batchMs, caps.workMs - this.metrics.workMs), () => { this.check(); this.worker!.postMessage({ id, kind, data }); }); }
    finally { this.metrics.workMs += performance.now() - start; }
  }
  private async initialize(): Promise<void> {
    this.check();
    if (this.initialized) return;
    descriptors(this.patterns);
    this.release = this.capacity.acquire();
    this.check();
    const start = performance.now();
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }, stdout: true, stderr: true });
    this.metrics.created++;
    this.worker.stdout.on("data", () => this.fail(new Error("UNEXPECTED_STDOUT")));
    this.worker.stderr.on("data", () => this.fail(new Error("UNEXPECTED_STDERR")));
    this.worker.on("message", this.message).on("error", this.error).on("exit", this.exit).on("messageerror", this.error);
    this.signal?.addEventListener("abort", this.abort, { once: true });
    await this.wait(0, caps.startupMs);
    this.metrics.startupMs = performance.now() - start;
    await this.request("init", this.patterns);
    this.initialized = true;
  }
  async ready(): Promise<void> {
    this.check();
    if (this.busy) throw new Error("BUSY");
    this.busy = true;
    try { await this.initialize(); }
    catch (error) { await this.dispose(); throw error; }
    finally { this.busy = false; }
  }
  async batch(input: Row[]): Promise<Result> {
    this.check();
    if (this.busy) throw new Error("BUSY");
    this.busy = true;
    try {
      rows(input);
      this.metrics.inputBytes += input.reduce((sum, row) => sum + row.text.length * 2, 0);
      if (this.metrics.inputBytes > caps.inputBytes) throw new Error("COMMAND_INPUT_CAP");
      await this.initialize();
      const reply = await this.request("scan", input);
      result(reply, input, this.patterns.length);
      this.metrics.execCalls += reply.execCalls;
      this.metrics.responseBytes += reply.bytes;
      if (this.metrics.responseBytes > caps.outputBytes) throw new Error("COMMAND_OUTPUT_CAP");
      this.check();
      return reply;
    } catch (error) { await this.dispose(); throw error; }
    finally { this.busy = false; }
  }
  async *stream(source: AsyncIterable<Row>, batchSize: number): AsyncGenerator<Result> {
    this.check();
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > caps.rows) throw new Error("BATCH_SIZE");
    let iterator: AsyncIterator<Row> | undefined;
    let finished = false;
    let failed = false;
    try {
      iterator = source[Symbol.asyncIterator]();
      while (true) {
        this.check();
        const next = await iterator.next();
        this.check();
        if (next.done) { finished = true; break; }
        yield await this.batch([next.value]);
      }
    } catch (error) { failed = true; throw error; }
    finally {
      try { await this.dispose(); }
      finally {
        if (iterator && !finished) {
          try { await iterator.return?.(); }
          catch (error) { if (!failed) throw error; }
        }
      }
    }
  }
  async dispose(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.fail(new Error("DISPOSED"));
    this.signal?.removeEventListener("abort", this.abort);
    this.stopPromise = (async () => {
      const start = performance.now();
      if (this.worker) {
        const code = await this.worker.terminate();
        if (typeof code === "number") this.metrics.exitCode = code;
        this.metrics.terminated++;
        this.worker.removeListener("message", this.message).removeListener("error", this.error).removeListener("exit", this.exit).removeListener("messageerror", this.error);
        this.worker.stdout.removeAllListeners("data");
        this.worker.stderr.removeAllListeners("data");
        this.metrics.listenersAfter = this.worker.listenerCount("message") + this.worker.listenerCount("error") + this.worker.listenerCount("exit") + this.worker.listenerCount("messageerror");
      } else this.metrics.listenersAfter = 0;
      this.metrics.terminationMs = performance.now() - start;
      this.release?.(); this.release = undefined;
    })();
    void this.stopPromise.catch(() => {});
    return this.stopPromise;
  }
}
