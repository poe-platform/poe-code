import { createRequire } from "node:module";
import { waitForOAuthOperation } from "./cancellable-operation.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const stores = new WeakMap();
export async function withOAuthSessionTransaction(store, resource, operation, options = {}) {
  const supplied = options.timeoutMs ?? 30000;
  const timeoutMs = native.transactionTimeout(typeof supplied === "number" ? supplied : NaN);
  options.signal?.throwIfAborted();
  const started = performance.now();
  let queue = stores.get(store);
  if (queue === undefined) {
    queue = { policy: new native.NativeTransactionQueue(), tails: new Map() };
    stores.set(store, queue);
  }
  const [ticket, predecessor] = queue.policy.enqueue(resource);
  const previous = predecessor === 0 ? Promise.resolve() : queue.tails.get(predecessor);
  let release;
  const current = new Promise((resolve) => (release = resolve)),
    tail = previous.then(() => current);
  queue.tails.set(ticket, tail);
  let running;
  try {
    let timer, rejectWait;
    const waiting = new Promise((resolve, reject) => {
      rejectWait = reject;
      previous.then(resolve, reject);
    });
    const abort = () => rejectWait(options.signal?.reason);
    try {
      timer = setTimeout(
        () => rejectWait(new Error("Timed out waiting for OAuth session transaction lock")),
        timeoutMs
      );
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      await waiting;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
    options.signal?.throwIfAborted();
    running = (async () =>
      store.withLock === undefined
        ? operation()
        : store.withLock(resource, operation, {
            signal: options.signal,
            timeoutMs: Math.max(0, timeoutMs - (performance.now() - started))
          }))();
    return await waitForOAuthOperation(running, options.signal);
  } finally {
    if (running === undefined) release();
    else void running.then(release, release);
    void tail.then(() => {
      queue.tails.delete(ticket);
      queue.policy.retire(resource, ticket);
    });
  }
}
