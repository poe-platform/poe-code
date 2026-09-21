const queues = new WeakMap();
/** Serialize the complete read/redeem/write operation, with independent cancellation for waiters. */
export async function withOAuthSessionTransaction(store, resource, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error("sessionLockTimeoutMs must be an integer from 1 to 2147483647 milliseconds");
  options.signal?.throwIfAborted();
  const started = performance.now();
  const pending = queues.get(store) ?? new Map();
  queues.set(store, pending);
  const previous = pending.get(resource) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  pending.set(resource, tail);
  try {
    let timer;
    let rejectWait;
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
    return store.withLock === undefined
      ? await operation()
      : await store.withLock(resource, operation, {
          signal: options.signal,
          timeoutMs: Math.max(0, timeoutMs - (performance.now() - started))
        });
  } finally {
    release();
    void tail.then(() => {
      if (pending.get(resource) === tail) pending.delete(resource);
    });
  }
}
