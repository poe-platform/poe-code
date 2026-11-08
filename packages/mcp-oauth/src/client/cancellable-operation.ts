/** Settle the caller on cancellation without abandoning observation of host completion. */
export async function waitForOAuthOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  let abort!: () => void;
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      operation.then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally { signal.removeEventListener("abort", abort); }
}
