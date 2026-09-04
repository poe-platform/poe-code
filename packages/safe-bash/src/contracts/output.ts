import type { CommandContext, InvocationCleanup } from "./command.js";
import { outputFailure, writeBytes, type ByteSink } from "./io.js";

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
  const capability = destination.ownedOutput;
  const callbacks: InvocationCleanup[] = [];
  const children: OutputOperation[] = [];
  const closedReason = new Error("Output operation is closed");
  let accepting = true;
  let drain: Promise<void> | undefined;
  const assertOpen = (): void => {
    context.signal.throwIfAborted();
    signal.throwIfAborted();
    if (!accepting) throw closedReason;
  };
  const close = (): Promise<void> => {
    if (drain) return drain;
    accepting = false;
    drain = Promise.resolve().then(async () => {
      try {
        const results = await Promise.allSettled(callbacks.map(async cleanup => cleanup()));
        const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Output operation cleanup failed");
      } finally {
        context.signal.removeEventListener("abort", callerAbort);
        capability?.consumerClosed.removeEventListener("abort", outputAbort);
      }
    });
    void drain.catch(() => {});
    for (const child of children) void child.close().catch(() => {});
    return drain;
  };
  const abort = (reason: unknown): void => {
    controller.abort(reason);
    void close().catch(() => {});
  };
  const callerAbort = (): void => abort(context.signal.reason);
  const outputAbort = (): void => abort(capability?.consumerClosed.reason);
  const registerCleanup = (cleanup: InvocationCleanup): void => {
    assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    callbacks.push(cleanup);
  };
  const wait = <Value>(pending: Promise<Value>): Promise<Value> => new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
    pending.then(value => {
      signal.removeEventListener("abort", aborted);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", aborted);
      reject(error);
    });
  });
  context.registerCleanup?.(close);
  if (context.signal.aborted) callerAbort();
  else if (capability?.consumerClosed.aborted) outputAbort();
  else {
    context.signal.addEventListener("abort", callerAbort, { once: true });
    capability?.consumerClosed.addEventListener("abort", outputAbort, { once: true });
  }
  return {
    signal,
    output: {
      ...(destination[outputFailure] ? { [outputFailure]: destination[outputFailure] } : {}),
      async write(chunk) {
        assertOpen();
        await writeBytes(capability ?? destination, chunk, signal);
      },
    },
    registerCleanup,
    child(destination) {
      assertOpen();
      const child = createOutputOperation({ signal, registerCleanup }, destination);
      children.push(child);
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
