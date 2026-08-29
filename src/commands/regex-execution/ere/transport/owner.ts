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
  #retirementState: "NOT_ACQUIRED" | "PENDING" | "RETIRED" | "UNCONFIRMED" = "NOT_ACQUIRED";
  #cleanupPresent = false;
  #cleanupReason: unknown;
  #exitObserved = false;
  #stdoutObserved = false;
  #stderrObserved = false;
  constructor(readonly onFailure: (reason: unknown) => void, readonly transport: TransportAccounting) {}

  get retirementState(): "NOT_ACQUIRED" | "PENDING" | "RETIRED" | "UNCONFIRMED" { return this.#retirementState; }
  get cleanupFailurePresent(): boolean { return this.#cleanupPresent; }
  get cleanupFailureReason(): unknown { return this.#cleanupReason; }

  #cleanupFailure(reason: unknown): void {
    if (!this.#cleanupPresent) { this.#cleanupPresent = true; this.#cleanupReason = reason; }
  }

  #throwFailure(): void {
    if (this.#failed) throw this.#failure;
    if (this.#cleanupPresent) throw this.#cleanupReason;
    if (this.#notificationFailed) throw this.#notificationFailure;
  }

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

  #stream(stream: Readable, channel: "stdout" | "stderr"): Promise<void> {
    let resolveEnd: () => void = () => {};
    const ended = new Promise<void>(resolve => { resolveEnd = resolve; });
    const observe = (): void => {
      if (channel === "stdout") this.#stdoutObserved = true; else this.#stderrObserved = true;
      resolveEnd();
    };
    stream.once("end", observe); stream.once("close", observe);
    stream.on("error", (reason: unknown) => this.#fail(reason));
    stream.on("data", () => this.#fail(new EreTransportError("PROTOCOL", "unexpected ERE Worker output")));
    if (stream.readableEnded || stream.closed) observe();
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
        this.#worker = worker; this.#retirementState = "PENDING";
        let setupFailed = false;
        let setupFailure: unknown;
        try {
          worker.once("exit", () => {
            this.#exitObserved = true; this.#exitResolve?.();
            if (!this.#closing) this.#fail(new EreTransportError("WORKER_EXIT", "owned ERE Worker exited"));
          });
          this.#exitListenerInstalled = true;
          worker.on("error", (reason: unknown) => this.#fail(reason));
          worker.on("messageerror", (reason: unknown) => this.#fail(reason));
        } catch (reason) { setupFailed = true; setupFailure = reason; }
        try { this.#stdout = this.#stream(worker.stdout, "stdout"); }
        catch (reason) { this.#cleanupFailure(reason); if (!setupFailed) { setupFailed = true; setupFailure = reason; } }
        try { this.#stderr = this.#stream(worker.stderr, "stderr"); }
        catch (reason) { this.#cleanupFailure(reason); if (!setupFailed) { setupFailed = true; setupFailure = reason; } }
        if (setupFailed) throw setupFailure;
        if (this.#failed) throw this.#failure;
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
      let terminationFailed = false;
      try {
        if (worker) {
          await worker.terminate();
          this.#exitObserved = true;
          if (!this.#exitListenerInstalled) this.#exitResolve?.();
        }
      } catch (reason) { terminationFailed = true; this.#cleanupFailure(reason); }
      if (worker && ((terminationFailed && !(this.#exitObserved && this.#stdoutObserved && this.#stderrObserved)) ||
          (!this.#stdout && !this.#stdoutObserved) || (!this.#stderr && !this.#stderrObserved))) {
        this.#retirementState = "UNCONFIRMED";
        await Promise.allSettled([ready, request]);
        this.#throwFailure();
        return;
      }
      await Promise.allSettled([this.#exited, this.#stdout, this.#stderr, ready, request]);
      this.#retirementState = "RETIRED";
      this.#worker = undefined;
      this.#throwFailure();
    });
    this.#settle(this.#failed ? this.#failure : new EreTransportError("CLOSED", "ERE Worker closed"));
    void this.#closing.catch(() => {});
    return this.#closing;
  }
}
