import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { BudgetOptions } from "../../src/interp/budget.js";

export type AgentHost = {
  start?(source: string): Promise<void>;
  broadcast?(buffer: SharedArrayBuffer, id: number | bigint): Promise<void>;
  getReport?(): string | null;
  receiveBroadcast?(): Promise<{ buffer: SharedArrayBuffer; id: number | bigint }>;
  report?(message: string): void;
  leaving?(): void;
};

type Pending = { resolve(): void; reject(error: Error): void };
type Child = { worker: Worker; pending: Map<number, Pending>; ready: Pending; leaving: boolean };

export class Test262Agents implements AgentHost {
  private readonly children = new Set<Child>();
  private readonly reports: string[] = [];
  private nextMessage = 0;
  private closed = false;
  private closing?: Promise<void>;
  private failure?: Error;

  constructor(private readonly budget: BudgetOptions, private readonly fail: (error: Error) => void) {}

  async start(source: string): Promise<void> {
    if (this.closed) throw new Error("Test262 agents are disposed");
    if (this.failure) throw this.failure;
    const require = nodeModule.createRequire(import.meta.url);
    const canRegister = typeof nodeModule.register === "function";
    const entry = new URL("./agent-worker.ts", import.meta.url);
    const worker = new Worker(canRegister ? `
      const { workerData } = require('node:worker_threads');
      import(workerData.loader).then(({ register }) => {
        register();
        return import(workerData.entry);
      }).catch(error => { throw error; });
    ` : entry, { eval: canRegister,
      execArgv: canRegister ? [] : ["--loader", pathToFileURL(require.resolve("tsx")).href],
      workerData: { source, budget: this.budget,
        loader: pathToFileURL(require.resolve("tsx/esm/api")).href, entry: entry.href } });
    let ready!: Pending;
    const started = new Promise<void>((resolve, reject) => { ready = { resolve, reject }; });
    const child: Child = { worker, ready, pending: new Map(), leaving: false };
    this.children.add(child);
    const failed = (error: Error) => {
      ready.reject(error);
      for (const pending of child.pending.values()) pending.reject(error);
      child.pending.clear();
      if (!this.closed) { this.failure ??= error; this.fail(error); }
    };
    worker.on("error", failed);
    worker.on("exit", code => {
      if (!this.closed && !child.leaving) failed(new Error(`Test262 agent exited unexpectedly (${code})`));
    });
    worker.on("message", (message: { type: string; id: number; message: string }) => {
      if (this.closed) return;
      if (message.type === "ready") ready.resolve();
      else if (message.type === "received") {
        child.pending.get(message.id)?.resolve();
        child.pending.delete(message.id);
      } else if (message.type === "report") this.reports.push(message.message);
      else if (message.type === "leaving") child.leaving = true;
      else if (message.type === "error") failed(new Error(message.message));
      else failed(new Error("Invalid Test262 agent message"));
    });
    await started;
  }

  async broadcast(buffer: SharedArrayBuffer, id: number | bigint): Promise<void> {
    if (this.closed) throw new Error("Test262 agents are disposed");
    if (this.failure) throw this.failure;
    const messageId = ++this.nextMessage;
    await Promise.all([...this.children].filter(child => !child.leaving).map(child =>
      new Promise<void>((resolve, reject) => {
        child.pending.set(messageId, { resolve, reject });
        try { child.worker.postMessage({ type: "broadcast", messageId, buffer, id }); }
        catch (error) { child.pending.delete(messageId); reject(error); }
      })));
  }

  getReport(): string | null {
    if (this.failure) throw this.failure;
    return this.reports.shift() ?? null;
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const error = new Error("Test262 agents disposed");
    for (const child of this.children) {
      child.ready.reject(error);
      for (const pending of child.pending.values()) pending.reject(error);
      child.pending.clear();
    }
    this.closing = Promise.allSettled([...this.children].map(async child => child.worker.terminate())).then(results => {
      this.children.clear();
      this.reports.length = 0;
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
    return this.closing;
  }
}
