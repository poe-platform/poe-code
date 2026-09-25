import type { CommandContext, InvocationCleanup } from "./command.js";
import { outputFailure, writeBytes, type ByteSink } from "./io.js";

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });
const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");

function isSyncResolved(promise: unknown): promise is Promise<never> {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

export interface OutputOperation {
  readonly signal: AbortSignal;
  readonly output: ByteSink;
  child(destination: ByteSink): OutputOperation;
  registerCleanup(cleanup: InvocationCleanup): void;
  acquire<Value>(start: (signal: AbortSignal) => Value | Promise<Value>, release: (resource: Value) => void | Promise<void>): Promise<Value>;
  close(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}

export function createOutputOperation(context: Pick<CommandContext, "signal" | "registerCleanup">, destination: ByteSink): OutputOperation {
  const controller = new AbortController();
  const signal = controller.signal;
  (signal as unknown as Record<symbol, unknown>)[managedSignalSymbol] = true;
  const capability = destination.ownedOutput;
  let callbacks: InvocationCleanup[] | undefined;
  let children: OutputOperation[] | undefined;
  let writes: Set<Promise<void>> | undefined;
  const closedReason = new Error("Output operation is closed");
  let accepting = true;
  let drain: Promise<void> | undefined;
  let callerWaiters: Set<() => void> | undefined;
  let outputWaiters: Set<() => void> | undefined;
  const assertOpen = (): void => {
    context.signal.throwIfAborted();
    signal.throwIfAborted();
    if (!accepting) throw closedReason;
  };
  const detachListeners = (): void => {
    if (callerWaiters) callerWaiters.delete(callerAbort);
    else context.signal.removeEventListener("abort", callerAbort);
    if (capability) {
      if (outputWaiters) outputWaiters.delete(outputAbort);
      else capability.consumerClosed.removeEventListener("abort", outputAbort);
    }
  };
  const close = (): Promise<void> => {
    if (drain) return drain;
    accepting = false;
    if ((!writes || writes.size === 0) && (!callbacks || callbacks.length === 0) && (!children || children.length === 0)) {
      detachListeners();
      drain = resolvedVoid;
      return resolvedVoid;
    }
    drain = Promise.resolve().then(async () => {
      try {
        const results = await Promise.allSettled([
          ...(writes ?? []),
          ...(callbacks ? callbacks.map(async cleanup => cleanup()) : []),
        ]);
        const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Output operation cleanup failed");
      } finally {
        detachListeners();
      }
    });
    void drain.catch(() => {});
    if (children) for (const child of children) void child.close().catch(() => {});
    return drain;
  };
  const abort = (reason: unknown): void => {
    controller.abort(reason);
    const symSet = (signal as unknown as Record<symbol, Set<() => void> | undefined>)[managedWaitersSymbol];
    if (symSet && symSet.size > 0) {
      const pending = [...symSet];
      symSet.clear();
      for (let i = 0; i < pending.length; i++) pending[i]!();
    }
    void close().catch(() => {});
  };
  const callerAbort = (): void => abort(context.signal.reason);
  const outputAbort = (): void => abort(capability?.consumerClosed.reason);
  const registerCleanup = (cleanup: InvocationCleanup): void => {
    assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    (callbacks ??= []).push(cleanup);
  };
  const wait = <Value>(pending: Promise<Value>): Promise<Value> => new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    if (signal.aborted) aborted();
    const symSet = ((signal as unknown as Record<symbol, Set<() => void> | undefined>)[managedWaitersSymbol] ??= new Set());
    if (!signal.aborted) symSet.add(aborted);
    pending.then(value => {
      symSet.delete(aborted);
      resolve(value);
    }, error => {
      symSet.delete(aborted);
      reject(error);
    });
  });
  context.registerCleanup?.(close);
  if (context.signal.aborted) callerAbort();
  else if (capability?.consumerClosed.aborted) outputAbort();
  else {
    if ((context.signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]) {
      callerWaiters = ((context.signal as unknown as Record<symbol, Set<() => void> | undefined>)[managedWaitersSymbol] ??= new Set());
      callerWaiters.add(callerAbort);
    } else {
      context.signal.addEventListener("abort", callerAbort, { once: true });
    }
    if (capability) {
      const consumerClosed = capability.consumerClosed;
      if ((consumerClosed as unknown as Record<symbol, unknown>)[managedSignalSymbol]) {
        outputWaiters = ((consumerClosed as unknown as Record<symbol, Set<() => void> | undefined>)[managedWaitersSymbol] ??= new Set());
        outputWaiters.add(outputAbort);
      } else {
        consumerClosed.addEventListener("abort", outputAbort, { once: true });
      }
    }
  }
  return {
    signal,
    output: {
      ...(destination[outputFailure] ? { [outputFailure]: destination[outputFailure] } : {}),
      async write(chunk) {
        assertOpen();
        if (!capability) return writeBytes(destination, chunk, signal);
        let settled!: () => void;
        const admitted = new Promise<void>(resolve => { settled = resolve; });
        (writes ??= new Set()).add(admitted);
        // Cancellation can settle the caller while the owned destination is still writing.
        const pending = writeBytes(capability, chunk);
        const finish = (): void => { writes?.delete(admitted); settled(); };
        void pending.then(finish, finish);
        await wait(pending);
      },
    },
    registerCleanup,
    child(destination) {
      assertOpen();
      const child = createOutputOperation({ signal, registerCleanup }, destination);
      (children ??= []).push(child);
      return child;
    },
    async acquire<Value>(start: (signal: AbortSignal) => Value | Promise<Value>, release: (resource: Value) => void | Promise<void>) {
      assertOpen();
      let resource: { value: Value } | undefined;
      let settled!: () => void;
      const admitted = new Promise<void>(resolve => { settled = resolve; });
      let released: Promise<void> | undefined;
      const dispose = (): Promise<void> => {
        released ??= admitted.then(async () => { if (resource) await release(resource.value); });
        return released;
      };
      registerCleanup(dispose);
      let acquisition: Promise<Value>;
      try { acquisition = Promise.resolve(start(signal)); }
      catch (error) { acquisition = Promise.reject(error); }
      const pending = acquisition.then(async value => {
        resource = { value };
        settled();
        if (!accepting) {
          await dispose();
          throw signal.aborted ? signal.reason : closedReason;
        }
        return value;
      }, error => {
        settled();
        throw error;
      });
      return wait(pending);
    },
    close,
    abort(reason) {
      abort(reason);
      return close();
    },
  };
}
