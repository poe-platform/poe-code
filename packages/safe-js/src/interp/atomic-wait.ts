import { Worker } from "node:worker_threads";
import type { Budget } from "./budget.js";
import { runResources, type RunResources } from "./resources.js";

type WaitResult = { async: false; value: string } | { async: true; value: Promise<string>; startedAt?: number };
type Registration = {
  buffer: ArrayBufferLike;
  ready: (result: WaitResult) => void;
  failed: (reason: unknown) => void;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
  value: Promise<string>;
};
const nativeWait = Reflect.get(Atomics, "waitAsync") as (...args: unknown[]) => WaitResult;
const workers = new WeakMap<RunResources, AtomicWaiter>();
const workerSource = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ id, buffer, offset, bigint, expected, timeout }) => {
  try {
    const view = bigint ? new BigInt64Array(buffer, offset, 1) : new Int32Array(buffer, offset, 1);
    const startedAt = performance.timeOrigin + performance.now();
    const result = Atomics.waitAsync(view, 0, expected, timeout);
    parentPort.postMessage({ id, kind: "registered", async: result.async, startedAt, value: result.async ? undefined : result.value });
    if (result.async) result.value.then(value => parentPort.postMessage({ id, kind: "settled", value }));
  } catch (error) {
    parentPort.postMessage({ id, kind: "failed", name: error.name, message: error.message });
  }
});`;

class AtomicWaiter {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Registration>();
  private nextId = 1;
  private closing?: Promise<void>;
  private failure?: { reason: unknown };

  constructor(resources: RunResources, private readonly budget: Budget) {
    budget.setRetainedDataUsage(this, 1);
    try {
      this.worker = new Worker(workerSource, { eval: true, execArgv: [] });
    } catch (error) {
      budget.setRetainedDataUsage(this, 0);
      throw error;
    }
    budget.setRetainedValues(this, () => [...this.pending.values()].map(entry => entry.buffer));
    this.worker.on("message", (message: { id: number; kind: string; async?: boolean; startedAt?: number; value: string; name?: string; message?: string }) => {
      const entry = this.pending.get(message.id);
      if (entry === undefined) return;
      if (message.kind === "registered" && message.async) {
        entry.ready({ async: true, value: entry.value,
          startedAt: message.startedAt === undefined ? performance.now() : message.startedAt - performance.timeOrigin });
        return;
      }
      try { this.budget.setRetainedDataUsage(this, this.pending.size); }
      catch (error) { this.fail(error); return; }
      this.pending.delete(message.id);
      if (message.kind === "failed") {
        const error = new Error(message.message);
        error.name = message.name ?? "Error";
        entry.failed(error);
        entry.reject(error);
      } else {
        if (message.kind === "registered") entry.ready({ async: false, value: message.value });
        entry.resolve(message.value);
      }
    });
    this.worker.on("error", error => this.fail(error));
    this.worker.on("exit", code => this.fail(new Error(`Atomic waiter worker exited (${code}).`)));
    const abort = () => {
      this.fail(resources.signal.reason);
      void this.close().catch(() => undefined);
    };
    resources.signal.addEventListener("abort", abort, { once: true });
    resources.add(async () => {
      resources.signal.removeEventListener("abort", abort);
      try { await this.close(); }
      finally {
        this.budget.setRetainedValues(this, undefined);
        this.budget.setRetainedDataUsage(this, 0);
      }
    });
    if (resources.signal.aborted) abort();
  }

  wait(view: Int32Array | BigInt64Array, index: number, expected: number | bigint, timeout: number): Promise<WaitResult> {
    if (this.failure !== undefined) return Promise.reject(this.failure.reason);
    this.budget.setRetainedDataUsage(this, 2 + this.pending.size);
    const id = this.nextId++;
    let resolve!: (value: string) => void;
    let reject!: (reason: unknown) => void;
    const value = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    void value.catch(() => undefined);
    return new Promise<WaitResult>((ready, failed) => {
      this.pending.set(id, { buffer: view.buffer, ready, failed, resolve, reject, value });
      try {
        this.worker.postMessage({ id, buffer: view.buffer, offset: view.byteOffset + index * view.BYTES_PER_ELEMENT,
          bigint: typeof expected === "bigint", expected, timeout });
      } catch (error) {
        this.pending.delete(id);
        this.budget.setRetainedDataUsage(this, 1 + this.pending.size);
        failed(error);
        reject(error);
      }
    });
  }

  private fail(reason: unknown): void {
    if (this.failure !== undefined) return;
    this.failure = { reason };
    for (const entry of this.pending.values()) {
      entry.failed(reason);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  private close(): Promise<void> {
    return this.closing ??= this.worker.terminate().then(() => undefined);
  }
}

export async function waitForAtomicValue(
  view: Int32Array | BigInt64Array,
  index: number, expected: number | bigint, timeout: number, budget: Budget
): Promise<WaitResult> {
  const resources = runResources.getStore();
  if (resources === undefined) {
    const startedAt = performance.now();
    const result = Reflect.apply(nativeWait, Atomics, [view, index, expected, timeout]) as WaitResult;
    return result.async ? {...result, startedAt} : result;
  }
  resources.signal.throwIfAborted();
  const immediate = Reflect.apply(nativeWait, Atomics, [view, index, expected, 0]) as { async: false; value: string };
  if (immediate.value === "not-equal" || timeout <= 0) return immediate;
  let worker = workers.get(resources);
  if (worker === undefined) {
    worker = new AtomicWaiter(resources, budget);
    workers.set(resources, worker);
  }
  return worker.wait(view, index, expected, timeout);
}
