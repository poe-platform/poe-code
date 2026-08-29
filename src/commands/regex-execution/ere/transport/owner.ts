import { Worker } from "node:worker_threads";
import type { Readable } from "node:stream";
import type { TransportAccounting } from "./accounting.js";
import { EreTransportError, operation } from "./protocol.js";
import type { EreTransportRequest } from "./protocol.js";
import { record } from "./validation.js";

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class EreWorkerOwner {
  #worker: Worker | undefined;
  #exited: Promise<void> | undefined;
  #exitResolve: (() => void) | undefined;
  #ready: Promise<void> | undefined;
  #readyResolve: (() => void) | undefined;
  #readyReject: ((reason: unknown) => void) | undefined;
  #startupTimer: ReturnType<typeof setTimeout> | undefined;
  #pending: Pending | undefined;
  #request: Promise<unknown> | undefined;
  #stdout: Promise<void> | undefined;
  #stderr: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #failed = false;
  #failure: unknown;
  #readySeen = false;
  #exitListenerInstalled = false;
  #notificationFailed = false;
  #notificationFailure: unknown;
  constructor(readonly onFailure: (reason: unknown) => void, readonly transport: TransportAccounting) {}

  #settle(reason: unknown): void {
    clearTimeout(this.#startupTimer); this.#startupTimer = undefined;
    this.#readyReject?.(reason);
    this.#readyReject = undefined; this.#readyResolve = undefined;
    const pending = this.#pending; this.#pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(reason); }
  }

  #fail(reason: unknown): void {
    if (this.#failed) return;
    this.#failed = true; this.#failure = reason;
    this.#settle(reason);
    try { this.onFailure(reason); }
    catch (notificationFailure) { this.#notificationFailed = true; this.#notificationFailure = notificationFailure; }
    void this.close().catch(() => {});
  }

  #stream(stream: Readable): Promise<void> {
    const ended = new Promise<void>(resolve => {
      stream.once("end", resolve); stream.once("close", resolve);
      stream.on("error", (reason: unknown) => this.#fail(reason));
      stream.on("data", () => this.#fail(new EreTransportError("PROTOCOL", "unexpected ERE Worker output")));
      if (stream.readableEnded || stream.closed) resolve();
    });
    return ended;
  }

  start(): Promise<void> {
    if (this.#failed) return Promise.reject(this.#failure);
    if (this.#closing) return Promise.reject(new EreTransportError("CLOSED", "ERE Worker is closing"));
    if (!this.#ready) {
      this.#ready = new Promise<void>((resolve, reject) => { this.#readyResolve = resolve; this.#readyReject = reject; });
      void this.#ready.catch(() => {});
      this.#exited = new Promise<void>(resolve => { this.#exitResolve = resolve; });
      try {
        const worker = new Worker(new URL("./worker-entry.js", import.meta.url), {
          workerData: { operation, version: 1 }, env: {}, execArgv: [], stdout: true, stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
        });
        this.#worker = worker;
        worker.once("exit", () => {
          this.#exitResolve?.();
          if (!this.#closing) this.#fail(new EreTransportError("WORKER_EXIT", "owned ERE Worker exited"));
        });
        this.#exitListenerInstalled = true;
        worker.on("error", (reason: unknown) => this.#fail(reason));
        worker.on("messageerror", (reason: unknown) => this.#fail(reason));
        this.#stdout = this.#stream(worker.stdout);
        this.#stderr = this.#stream(worker.stderr);
        worker.on("message", (message: unknown) => {
          if (this.#closing || this.#failed) return;
          try {
            if (!this.#readySeen) {
              const ready = record(message, ["version", "operation", "kind"], units => this.transport.visit(units), this.transport);
              if (ready.version !== 1 || ready.operation !== operation || ready.kind !== "ready") throw new EreTransportError("PROTOCOL", "invalid ERE startup frame");
              this.transport.visit(14);
              this.#readySeen = true; clearTimeout(this.#startupTimer); this.#startupTimer = undefined;
              this.#readyResolve?.(); this.#readyResolve = undefined; this.#readyReject = undefined; return;
            }
            const pending = this.#pending;
            if (!pending) throw new EreTransportError("PROTOCOL", "unsolicited ERE frame");
            this.#pending = undefined; clearTimeout(pending.timer); pending.resolve(message);
          } catch (reason) { this.#fail(reason); }
        });
        this.#startupTimer = setTimeout(() => this.#fail(new EreTransportError("STARTUP_TIMEOUT", "ERE startup timeout")), 3000);
      } catch (reason) {
        if (!this.#worker) this.#exitResolve?.();
        this.#fail(reason);
      }
    }
    return this.#ready;
  }

  request(request: EreTransportRequest, posted: () => void): Promise<unknown> {
    if (this.#failed) return Promise.reject(this.#failure);
    if (!this.#worker || !this.#readySeen || this.#pending || this.#closing) return Promise.reject(new EreTransportError("CLOSED", "ERE Worker request unavailable"));
    const pending = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new EreTransportError("REQUEST_TIMEOUT", "ERE request timeout")), 1000);
      this.#pending = { resolve, reject, timer };
    });
    this.#request = pending;
    void pending.catch(() => {});
    try { posted(); this.#worker.postMessage(request); }
    catch (reason) { this.#fail(reason); }
    const forget = (): void => { if (this.#request === pending) this.#request = undefined; };
    void pending.then(forget, forget);
    return pending;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    const ready = this.#ready;
    const request = this.#request;
    this.#closing = Promise.resolve().then(async () => {
      const worker = this.#worker;
      const termination = Promise.resolve().then(async () => {
        if (!worker) return;
        await worker.terminate();
        if (!this.#exitListenerInstalled) this.#exitResolve?.();
      });
      const retired = await Promise.allSettled([termination, this.#exited, this.#stdout, this.#stderr]);
      await Promise.allSettled([ready, request]);
      for (const result of retired) if (result.status === "rejected") throw result.reason;
      if (this.#notificationFailed) throw this.#notificationFailure;
      this.#worker = undefined;
    });
    this.#settle(this.#failed ? this.#failure : new EreTransportError("CLOSED", "ERE Worker closed"));
    void this.#closing.catch(() => {});
    return this.#closing;
  }
}
