import type { CommandContext, InvocationCleanup } from "./command.js";
import { outputFailure, writeBytes, type ByteSink } from "./io.js";
import { addManagedAbortWaiter, managedSignalSymbol, notifyManagedAbortWaiters, removeManagedAbortWaiter } from "./managed-abort.js";

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

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
  const consumerClosed = capability?.consumerClosed;
  const callerManaged = Boolean((context.signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]);
  const outputManaged = Boolean(consumerClosed && (consumerClosed as unknown as Record<symbol, unknown>)[managedSignalSymbol]);
  let callbacks: InvocationCleanup[] | undefined;
  let children: OutputOperation[] | undefined;
  let writes: Set<Promise<void>> | undefined;
  const closedReason = new Error("Output operation is closed");
  let accepting = true;
  let drain: Promise<void> | undefined;
  const assertOpen = (): void => {
    context.signal.throwIfAborted();
    signal.throwIfAborted();
    if (!accepting) throw closedReason;
  };
  const detachListeners = (): void => {
    if (callerManaged) removeManagedAbortWaiter(context.signal, callerAbort);
    else context.signal.removeEventListener("abort", callerAbort);
    if (consumerClosed) {
      if (outputManaged) removeManagedAbortWaiter(consumerClosed, outputAbort);
      else consumerClosed.removeEventListener("abort", outputAbort);
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
    notifyManagedAbortWaiters(signal);
    void close().catch(() => {});
  };
  const callerAbort = (): void => abort(context.signal.reason);
  const outputAbort = (): void => abort(consumerClosed?.reason);
  const registerCleanup = (cleanup: InvocationCleanup): void => {
    assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    (callbacks ??= []).push(cleanup);
  };
  const wait = <Value>(pending: Promise<Value>): Promise<Value> => new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    if (signal.aborted) aborted();
    if (!signal.aborted) addManagedAbortWaiter(signal, aborted);
    pending.then(value => {
      removeManagedAbortWaiter(signal, aborted);
      resolve(value);
    }, error => {
      removeManagedAbortWaiter(signal, aborted);
      reject(error);
    });
  });
  context.registerCleanup?.(close);
  if (context.signal.aborted) callerAbort();
  else if (consumerClosed?.aborted) outputAbort();
  else {
    if (callerManaged) {
      addManagedAbortWaiter(context.signal, callerAbort);
    } else {
      context.signal.addEventListener("abort", callerAbort, { once: true });
    }
    if (consumerClosed) {
      if (outputManaged) {
        addManagedAbortWaiter(consumerClosed, outputAbort);
      } else {
        consumerClosed.addEventListener("abort", outputAbort, { once: true });
      }
    }
  }
  return {
    signal,
    output: {
      ...(destination[outputFailure] ? { [outputFailure]: destination[outputFailure].bind(destination) } : {}),
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
