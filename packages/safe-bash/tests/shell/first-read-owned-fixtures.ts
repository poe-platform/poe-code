import assert from "node:assert/strict";
import { ClientRequest } from "node:http";
import { setImmediate as turn } from "node:timers/promises";
import type { ByteSource, HttpResponse, HttpTransport } from "../../src/index.js";
import { gate } from "../stress/remote-cancellation/helpers.js";

export type FirstReadScenario =
  | "first-read-head-zero"
  | "first-read-local-unenrolled-controlled"
  | "first-read-local-owned"
  | "first-read-s3"
  | "first-read-webdav"
  | "first-read-curl-body"
  | "first-read-curl-headers"
  | "first-read-webdav-body-acquired"
  | "first-read-curl-body-acquired"
  | "first-read-required-destinations";

export type FixturePhase = "setup" | "execution" | "public-settled" | "passive-close" | "dispose" | "cleanup";

export interface FirstReadCounters {
  activeSource: number;
  sourceReads: number;
  sourceReturns: number;
  acquiredResources: number;
  resourceReleases: number;
  serverResponses: number;
  serverCloses: number;
  fetchCalls: number;
  fetchPending: number;
  fetchSettled: number;
  getFetchCalls: number;
  getFetchSettled: number;
  getFetchRejected: number;
  getResponses: number;
  getBodyReaders: number;
  getReadCalls: number;
  getReadsPending: number;
  getReaderReleases: number;
  getReaderCancelCalls: number;
  getReaderCancelFulfilled: number;
  getReaderCancelRejected: number;
  getBodyCancelCalls: number;
  getBodyCancelFulfilled: number;
  getBodyCancelRejected: number;
  transportCleanupRegistrations: number;
  transportCleanupCalls: number;
  transportCleanupCompleted: number;
  clientRequests: number;
  clientCloses: number;
  responseAcquired: number;
  responseReadCalls: number;
  responseReadsPending: number;
  responseIteratorReturns: number;
  responseIteratorReturnsDone: number;
  responseDisposals: number;
  responseDisposalsDone: number;
}

export interface FirstReadSnapshot {
  readonly phase: FixturePhase;
  readonly counters: Readonly<FirstReadCounters>;
  readonly signals: Readonly<Record<string, { readonly aborted: boolean; readonly code?: unknown }>>;
  readonly eventCount: number;
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function observed<Value>(pending: PromiseLike<Value>, complete: () => void, failed: (error: unknown) => void): void {
  void Promise.resolve(pending).then(() => complete(), error => failed(error));
}

export async function settlesWithin(pending: PromiseLike<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(pending).then(() => true, () => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class FirstReadOwnedFixtures {
  readonly started = gate();
  readonly closed = gate();
  readonly hostRelease = gate();
  readonly requiredRelease = gate();
  readonly counters: FirstReadCounters = {
    activeSource: 0,
    sourceReads: 0,
    sourceReturns: 0,
    acquiredResources: 0,
    resourceReleases: 0,
    serverResponses: 0,
    serverCloses: 0,
    fetchCalls: 0,
    fetchPending: 0,
    fetchSettled: 0,
    getFetchCalls: 0,
    getFetchSettled: 0,
    getFetchRejected: 0,
    getResponses: 0,
    getBodyReaders: 0,
    getReadCalls: 0,
    getReadsPending: 0,
    getReaderReleases: 0,
    getReaderCancelCalls: 0,
    getReaderCancelFulfilled: 0,
    getReaderCancelRejected: 0,
    getBodyCancelCalls: 0,
    getBodyCancelFulfilled: 0,
    getBodyCancelRejected: 0,
    transportCleanupRegistrations: 0,
    transportCleanupCalls: 0,
    transportCleanupCompleted: 0,
    clientRequests: 0,
    clientCloses: 0,
    responseAcquired: 0,
    responseReadCalls: 0,
    responseReadsPending: 0,
    responseIteratorReturns: 0,
    responseIteratorReturnsDone: 0,
    responseDisposals: 0,
    responseDisposalsDone: 0,
  };
  readonly signals = new Map<string, AbortSignal>();
  readonly events: string[] = [];
  readonly observerErrors: { readonly site: string; readonly error: unknown }[] = [];
  readonly getCancellationErrors: unknown[] = [];
  phase: FixturePhase = "setup";
  #restores: (() => void)[] = [];
  #observersInstalled = false;

  constructor(readonly scenario: FirstReadScenario) {}

  mark(event: string): void {
    assert.ok(this.events.length < 512, "first-read observer journal is bounded");
    this.events.push(`${this.phase}:${event}`);
  }

  watchSignal(name: string, signal: AbortSignal | undefined | null): void {
    if (!signal) return;
    const existing = this.signals.get(name);
    if (existing) {
      assert.equal(existing, signal, `stable signal binding: ${name}`);
      return;
    }
    this.signals.set(name, signal);
    this.mark(`signal:${name}:${signal.aborted ? "aborted" : "live"}`);
    const aborted = (): void => this.mark(`signal-abort:${name}:${String(errorCode(signal.reason) ?? "no-code")}`);
    signal.addEventListener("abort", aborted, { once: true });
    this.#restores.push(() => signal.removeEventListener("abort", aborted));
  }

  snapshot(): FirstReadSnapshot {
    return {
      phase: this.phase,
      counters: { ...this.counters },
      signals: Object.fromEntries([...this.signals].map(([name, signal]) => [name, {
        aborted: signal.aborted,
        ...(signal.aborted ? { code: errorCode(signal.reason) } : {}),
      }])),
      eventCount: this.events.length,
    };
  }

  signal(name: string): AbortSignal {
    const signal = this.signals.get(name);
    assert.ok(signal, `observed signal: ${name}`);
    return signal;
  }

  pendingSource(signal: AbortSignal, controlled = false): ByteSource & AsyncIterator<Uint8Array> {
    this.watchSignal("source", signal);
    return (async function* (fixture: FirstReadOwnedFixtures) {
      fixture.counters.sourceReads++;
      fixture.counters.activeSource++;
      fixture.mark("source-next-pending");
      fixture.started.resolve();
      let abortListener: (() => void) | undefined;
      try {
        const aborted = new Promise<never>((_resolve, reject) => {
          signal.throwIfAborted();
          abortListener = () => reject(signal.reason);
          signal.addEventListener("abort", abortListener, { once: true });
        });
        await (controlled ? Promise.race([aborted, fixture.hostRelease.promise]) : aborted);
      } finally {
        if (abortListener) signal.removeEventListener("abort", abortListener);
        fixture.counters.activeSource--;
        fixture.counters.sourceReturns++;
        fixture.mark("source-finally");
        fixture.closed.resolve();
      }
    })(this);
  }

  serverResponseStarted(): void {
    this.counters.serverResponses++;
    this.counters.sourceReads++;
    this.counters.activeSource++;
    this.mark("server-response-pending");
  }

  serverResponseClosed(): void {
    this.counters.serverCloses++;
    this.counters.sourceReturns++;
    this.counters.activeSource--;
    this.mark("server-response-close");
    this.closed.resolve();
  }

  installObservers(): void {
    assert.equal(this.#observersInstalled, false, "observers install once");
    this.#observersInstalled = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
      const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET");
      const isGet = method === "GET";
      this.counters.fetchCalls++;
      this.counters.fetchPending++;
      if (isGet) this.counters.getFetchCalls++;
      this.mark(`fetch-start:${method}`);
      let pending: ReturnType<typeof fetch>;
      try { pending = Reflect.apply(originalFetch, globalThis, args) as ReturnType<typeof fetch>; }
      catch (error) {
        this.counters.fetchPending--;
        this.counters.fetchSettled++;
        if (isGet) { this.counters.getFetchSettled++; this.counters.getFetchRejected++; }
        throw error;
      }
      return pending.then(response => {
        this.counters.fetchPending--;
        this.counters.fetchSettled++;
        if (isGet) { this.counters.getFetchSettled++; this.counters.getResponses++; }
        this.mark(`fetch-response:${method}`);
        if (response.body) this.#observeBody(response.body, isGet);
        return response;
      }, error => {
        this.counters.fetchPending--;
        this.counters.fetchSettled++;
        if (isGet) { this.counters.getFetchSettled++; this.counters.getFetchRejected++; }
        this.mark(`fetch-reject:${method}:${String(errorCode(error) ?? "no-code")}`);
        throw error;
      });
    }) as typeof fetch;
    this.#restores.push(() => { globalThis.fetch = originalFetch; });

    const requests = new WeakSet<ClientRequest>();
    const closes = new WeakSet<ClientRequest>();
    const originalEmit = ClientRequest.prototype.emit;
    const fixture = this;
    ClientRequest.prototype.emit = function(this: ClientRequest, event: string | symbol, ...args: unknown[]): boolean {
      if (!requests.has(this)) {
        requests.add(this);
        fixture.counters.clientRequests++;
        fixture.mark("client-request-observed");
      }
      if (event === "close" && !closes.has(this)) {
        closes.add(this);
        fixture.counters.clientCloses++;
        fixture.mark("client-request-close");
      }
      return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
    } as typeof ClientRequest.prototype.emit;
    this.#restores.push(() => { ClientRequest.prototype.emit = originalEmit; });
  }

  async restoreObservers(): Promise<void> {
    this.phase = "cleanup";
    await turn();
    for (const restore of this.#restores.reverse()) restore();
    this.#restores = [];
    this.#observersInstalled = false;
  }

  observeTransport(transport: HttpTransport): HttpTransport {
    return async input => {
      this.watchSignal("curl-transport", input.signal);
      const request = input.registerCleanup ? {
        ...input,
        registerCleanup: (cleanup: () => void | Promise<void>): void => {
          this.counters.transportCleanupRegistrations++;
          this.mark("transport-cleanup-registered");
          input.registerCleanup!(async () => {
            this.counters.transportCleanupCalls++;
            this.mark("transport-cleanup-start");
            try {
              await cleanup();
              this.counters.transportCleanupCompleted++;
              this.mark("transport-cleanup-finish");
            } catch (error) {
              this.observerErrors.push({ site: "transport-cleanup", error });
              throw error;
            }
          });
        },
      } : input;
      const response = await transport(request);
      this.counters.responseAcquired++;
      this.mark("curl-response-acquired");
      return this.#observeResponse(response);
    };
  }

  assertGetCancellationErrorsAreEpipe(): void {
    assert.equal(this.getCancellationErrors.length,
      this.counters.getReaderCancelRejected + this.counters.getBodyCancelRejected);
    for (const error of this.getCancellationErrors) assert.equal(errorCode(error), "EPIPE");
  }

  assertNoObserverErrors(): void {
    assert.deepEqual(this.observerErrors, []);
  }

  #observeBody(body: ReadableStream<Uint8Array>, isGet: boolean): void {
    const originalCancel = body.cancel.bind(body);
    const originalGetReader = body.getReader.bind(body);
    body.cancel = ((reason?: unknown) => {
      const result = originalCancel(reason);
      if (isGet) {
        this.counters.getBodyCancelCalls++;
        observed(result,
          () => { this.counters.getBodyCancelFulfilled++; this.mark("GET-body-cancel-finish"); },
          error => { this.counters.getBodyCancelRejected++; this.getCancellationErrors.push(error); this.mark("GET-body-cancel-reject"); });
      }
      return result;
    }) as typeof body.cancel;
    body.getReader = ((...args: Parameters<typeof originalGetReader>) => {
      const reader = originalGetReader(...args);
      if (!isGet || args.length > 0) return reader;
      const defaultReader = reader as ReadableStreamDefaultReader<Uint8Array>;
      this.counters.getBodyReaders++;
      this.mark("GET-reader-acquire");
      const originalRead = defaultReader.read.bind(defaultReader);
      const originalReaderCancel = defaultReader.cancel.bind(defaultReader);
      const originalReleaseLock = defaultReader.releaseLock.bind(defaultReader);
      defaultReader.read = (() => {
        this.counters.getReadCalls++;
        this.counters.getReadsPending++;
        this.mark("GET-reader-read");
        const result = originalRead();
        if (this.scenario === "first-read-webdav-body-acquired") this.started.resolve();
        observed(result,
          () => { this.counters.getReadsPending--; this.mark("GET-reader-read-finish"); },
          error => { this.counters.getReadsPending--; this.mark(`GET-reader-read-reject:${String(errorCode(error) ?? "no-code")}`); });
        return result;
      }) as typeof defaultReader.read;
      defaultReader.cancel = ((reason?: unknown) => {
        this.counters.getReaderCancelCalls++;
        this.mark("GET-reader-cancel-start");
        const result = originalReaderCancel(reason);
        observed(result,
          () => { this.counters.getReaderCancelFulfilled++; this.mark("GET-reader-cancel-finish"); },
          error => { this.counters.getReaderCancelRejected++; this.getCancellationErrors.push(error); this.mark("GET-reader-cancel-reject"); });
        return result;
      }) as typeof defaultReader.cancel;
      defaultReader.releaseLock = (() => {
        const result = originalReleaseLock();
        this.counters.getReaderReleases++;
        this.mark("GET-reader-release-lock");
        return result;
      }) as typeof defaultReader.releaseLock;
      return defaultReader;
    }) as typeof body.getReader;
  }

  #observeResponse(response: HttpResponse): HttpResponse {
    const fixture = this;
    const originalDispose = response.dispose.bind(response);
    const body: ByteSource = {
      [Symbol.asyncIterator]() {
        const iterator = response.body[Symbol.asyncIterator]();
        return {
          next() {
            fixture.counters.responseReadCalls++;
            fixture.counters.responseReadsPending++;
            fixture.mark("curl-body-read");
            const result = iterator.next();
            if (fixture.scenario === "first-read-curl-body-acquired") fixture.started.resolve();
            observed(result,
              () => { fixture.counters.responseReadsPending--; fixture.mark("curl-body-read-finish"); },
              error => { fixture.counters.responseReadsPending--; fixture.mark(`curl-body-read-reject:${String(errorCode(error) ?? "no-code")}`); });
            return result;
          },
          return() {
            fixture.counters.responseIteratorReturns++;
            fixture.mark("curl-body-return");
            const result = iterator.return?.() ?? Promise.resolve({ done: true as const, value: undefined });
            observed(result,
              () => { fixture.counters.responseIteratorReturnsDone++; fixture.mark("curl-body-return-finish"); },
              error => fixture.observerErrors.push({ site: "curl-body-return", error }));
            return result;
          },
        };
      },
    };
    return {
      ...response,
      body,
      async dispose() {
        fixture.counters.responseDisposals++;
        fixture.mark("curl-response-dispose-start");
        try {
          await originalDispose();
          fixture.counters.responseDisposalsDone++;
          fixture.mark("curl-response-dispose-finish");
        } catch (error) {
          fixture.observerErrors.push({ site: "curl-response-dispose", error });
          throw error;
        }
      },
    };
  }
}
