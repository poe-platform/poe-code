/** Observe host completion even when cancellation settles the caller first. */
export async function waitForOAuthOperation(operation, signal) {
  if (signal === undefined) return operation;
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      operation.then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
