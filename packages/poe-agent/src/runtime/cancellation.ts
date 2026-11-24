import { AbortError } from "./hooks.js";

export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new AbortError("Run aborted.", signal.reason));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function* abortableEvents<T>(
  events: AsyncIterable<T>,
  signal: AbortSignal
): AsyncIterable<T> {
  const iterator = events[Symbol.asyncIterator]();
  try {
    while (!signal.aborted) {
      const next = await abortable(iterator.next(), signal);
      if (signal.aborted) break;
      if (next.done) return;
      yield next.value;
    }
    throw new AbortError("Run aborted.", signal.reason);
  } finally {
    // A generator may itself be waiting on a provider that ignores cancellation.
    // Request closure without waiting for that outstanding next() to settle.
    void Promise.resolve()
      .then(() => iterator.return?.())
      .catch(() => {});
  }
}
