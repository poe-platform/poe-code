import { FsError } from "../contracts/errors.js";
import type { PipeReadEndpoint, PipeWriteEndpoint } from "../contracts/io.js";
import { monotonicNow } from "../contracts/yield.js";
import type { ShellInputObserver, ShellReadProbe } from "./extensions.js";
import { throwCleanupFailures, type InvocationScope } from "./cleanup.js";
import type { Budget } from "./runtime.js";

export interface DescriptorObservationSource {
  readonly readable: boolean;
  probeRead(signal: AbortSignal): Promise<ShellReadProbe>;
  waitRead?(options: { readonly timeoutMs: number; readonly deadline: number; readonly signal: AbortSignal }): Promise<"ready" | "timeout" | "unknown">;
}

export function pipeObservation(endpoint: PipeReadEndpoint | PipeWriteEndpoint, buffered?: () => ShellReadProbe): DescriptorObservationSource {
  const { direction } = endpoint;
  const probe = endpoint.probe.bind(endpoint);
  const wait = endpoint.waitForChange.bind(endpoint);
  const ready = (): boolean => direction === "read" && buffered?.().readiness === "ready";
  return {
    readable: direction === "read",
    async probeRead(signal) {
      signal.throwIfAborted();
      return { readiness: probe().ready || ready() ? "ready" : "blocked", timeout: "honor" };
    },
    async waitRead({ deadline, signal }) {
      while (true) {
        signal.throwIfAborted();
        const snapshot = probe();
        if (snapshot.ready || ready()) return "ready";
        const remaining = deadline - monotonicNow();
        if (remaining <= 0) return "timeout";
        await wait(snapshot.revision, { timeoutMs: Math.min(2_147_483_647, Math.ceil(remaining)), signal });
      }
    },
  };
}

export interface PipeDescriptorReference {
  readonly endpoint: PipeReadEndpoint | PipeWriteEndpoint;
  acquire(): PipeDescriptorReference;
  close(): Promise<void>;
}

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

function isSyncResolved(promise: unknown): boolean {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

export class PipeDescriptorFrame {
  readonly references = new Set<PipeDescriptorReference>();
  #closing: Promise<void> | undefined;
  #closingSync = false;
  #reentrantResolve: (() => void) | undefined;
  #reentrantReject: ((reason: unknown) => void) | undefined;
  #retireCleanup: (() => void) | undefined;

  constructor(readonly scope: InvocationScope) {}

  open(endpoint: PipeReadEndpoint | PipeWriteEndpoint, budget: Budget): PipeDescriptorReference {
    if (this.#closing) throw new FsError("EBADF", { syscall: "open" });
    this.scope.assertOpen();
    this.#retireCleanup ??= this.scope.register(() => this.close());
    const reference = ownPipeDescriptor(endpoint, budget);
    this.references.add(reference);
    return reference;
  }

  acquire(source: PipeDescriptorReference): PipeDescriptorReference {
    if (this.#closing) throw new FsError("EBADF", { syscall: "dup" });
    this.scope.assertOpen();
    this.#retireCleanup ??= this.scope.register(() => this.close());
    const reference = source.acquire();
    this.references.add(reference);
    return reference;
  }

  closeSyncIfEmpty(): boolean {
    if (this.#closing) return false;
    if (this.references.size !== 0) return false;
    this.#closing = resolvedVoid;
    this.#retireCleanup?.();
    return true;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    if (this.#closingSync) {
      this.#closing = new Promise<void>((accept, refuse) => {
        this.#reentrantResolve = accept;
        this.#reentrantReject = refuse;
      });
      return this.#closing;
    }
    if (this.closeSyncIfEmpty()) return resolvedVoid;
    this.#closingSync = true;
    let asyncWork: Promise<void>[] | undefined;
    let failures: { reason: unknown }[] | undefined;
    let position = 0;
    for (const reference of this.references) {
      const index = position++;
      try {
        const pending = reference.close();
        if (!isSyncResolved(pending)) {
          (asyncWork ??= []).push(pending.catch(reason => { (failures ??= [])[index] = { reason }; }));
        }
      } catch (reason) {
        (failures ??= [])[index] = { reason };
      }
    }
    this.#closingSync = false;
    if (!asyncWork) {
      this.references.clear();
      this.#retireCleanup?.();
      if (failures && failures.length > 0) {
        try { throwCleanupFailures(failures.flatMap(failure => [failure.reason])); }
        catch (err) {
          if (this.#closing) {
            this.#reentrantReject?.(err);
            return this.#closing;
          }
          this.#closing = Promise.reject(err);
          return this.#closing;
        }
      }
      if (this.#closing) {
        this.#reentrantResolve?.();
        Object.defineProperty(this.#closing, syncResolved, { value: true });
        return this.#closing;
      }
      this.#closing = resolvedVoid;
      return resolvedVoid;
    }
    const done = Promise.all(asyncWork).then(() => {
      this.references.clear();
      if (failures) throwCleanupFailures(failures.flatMap(failure => [failure.reason]));
      this.#retireCleanup?.();
    });
    if (this.#closing) {
      void done.then(this.#reentrantResolve, this.#reentrantReject);
    } else {
      this.#closing = done;
    }
    return this.#closing;
  }
}

export function ownPipeDescriptor(endpoint: PipeReadEndpoint | PipeWriteEndpoint, budget: Budget): PipeDescriptorReference {
  let references = 0;
  const acquire = (): PipeDescriptorReference => {
    const allocation = budget.values.scope();
    try { allocation.reserve(96, 1); }
    catch (reason) { allocation.close(); throw reason; }
    references++;
    let closing: Promise<void> | undefined;
    let closingSync = false;
    let reentrantResolve: (() => void) | undefined;
    let reentrantReject: ((reason: unknown) => void) | undefined;
    return {
      endpoint,
      acquire() {
        if (closing || closingSync) throw new FsError("EBADF", { syscall: "dup" });
        return acquire();
      },
      close() {
        if (closing) return closing;
        if (closingSync) {
          closing = new Promise<void>((accept, refuse) => {
            reentrantResolve = accept;
            reentrantReject = refuse;
          });
          return closing;
        }
        references--;
        if (references > 0) {
          closing = resolvedVoid;
          allocation.close();
          return resolvedVoid;
        }
        closingSync = true;
        let pending: Promise<void>;
        try {
          pending = endpoint.close();
        } catch (reason) {
          closingSync = false;
          allocation.close();
          if (closing) {
            reentrantReject?.(reason);
            return closing;
          }
          closing = Promise.reject(reason);
          return closing;
        }
        closingSync = false;
        if (isSyncResolved(pending)) {
          allocation.close();
          if (closing) {
            reentrantResolve?.();
            Object.defineProperty(closing, syncResolved, { value: true });
            return closing;
          }
          closing = resolvedVoid;
          return resolvedVoid;
        }
        const done = pending.then(
          () => { allocation.close(); },
          reason => { allocation.close(); throw reason; },
        );
        if (closing) {
          void done.then(reentrantResolve, reentrantReject);
        } else {
          closing = done;
        }
        return closing;
      },
    };
  };
  return acquire();
}

export function observeDescriptor(source: DescriptorObservationSource, scope: InvocationScope, budget: Budget, signal: AbortSignal): ShellInputObserver {
  signal.throwIfAborted();
  scope.assertOpen();
  const allocation = budget.values.scope();
  const controller = new AbortController();
  const work = new Set<Promise<unknown>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const release = (): Promise<void> => {
    closed = true;
    controller.abort(new FsError("EBADF", { syscall: "observe" }));
    return closing ??= Promise.allSettled([...work]).then(() => { allocation.close(); });
  };
  const check = (forwarded?: AbortSignal): void => {
    signal.throwIfAborted();
    forwarded?.throwIfAborted();
    if (closed) throw new FsError("EBADF", { syscall: "observe" });
    scope.assertOpen();
  };
  try {
    scope.register(release);
    allocation.reserve(256, 1);
    const { readable, probeRead, waitRead } = source;
    const probe = probeRead.bind(source);
    const wait = waitRead?.bind(source);
    const run = <Value>(forwarded: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<Value>): Promise<Value> => {
      try {
        check(forwarded);
        const reservation = allocation.reserve(128, 1);
        let drained!: () => void;
        const admitted = new Promise<void>(resolve => { drained = resolve; });
        work.add(admitted);
        const finish = (): void => {
          reservation.release();
          work.delete(admitted);
          drained();
        };
        let active: Promise<Value>;
        try {
          const local = AbortSignal.any([signal, controller.signal, ...(forwarded ? [forwarded] : [])]);
          active = scope.run(async () => {
            try {
              const result = await action(local);
              check(forwarded);
              return result;
            } catch (reason) { check(forwarded); throw reason; }
          });
        } catch (reason) { finish(); throw reason; }
        return active.finally(finish);
      } catch (reason) { return Promise.reject(reason); }
    };
    const checkedProbe = async (local: AbortSignal): Promise<ShellReadProbe> => {
      const { readiness, timeout } = await probe(local);
      if (!["ready", "blocked", "unknown"].includes(readiness) || !["honor", "ignore", "unknown"].includes(timeout)) throw new TypeError("Invalid descriptor observation");
      return Object.freeze({ readiness, timeout });
    };
    return Object.freeze({
      readable,
      probeRead: () => run(undefined, checkedProbe),
      waitRead(options: { readonly timeoutMs: number; readonly signal?: AbortSignal | undefined }) {
        try {
          signal.throwIfAborted();
          const { timeoutMs, signal: forwarded } = options;
          check(forwarded);
          if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Observation timeout must be finite and positive");
          const deadline = monotonicNow() + timeoutMs;
          return run(forwarded, async local => {
            const result = await checkedProbe(local);
            local.throwIfAborted();
            if (result.readiness === "ready") return "ready";
            if (result.readiness === "unknown" || result.timeout !== "honor" || !wait) return "unknown";
            const remaining = deadline - monotonicNow();
            if (remaining <= 0) return "timeout";
            const readiness = await wait({ timeoutMs, deadline, signal: local });
            if (readiness !== "ready" && readiness !== "timeout" && readiness !== "unknown") throw new TypeError("Invalid descriptor wait result");
            return readiness;
          });
        } catch (reason) { return Promise.reject(reason); }
      },
      release,
    });
  } catch (reason) { void release(); throw reason; }
}
