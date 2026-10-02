function interruptible<Value>(start: () => PromiseLike<Value> | Value, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(signal.aborted ? signal.reason : error); },
    );
  });
}

export async function* sqliteSourceChunks<Value>(source: AsyncIterable<Value>, signal: AbortSignal): AsyncGenerator<Value> {
  const iterator = source[Symbol.asyncIterator]();
  let done = false;
  try {
    while (true) {
      const result = await interruptible(() => iterator.next(), signal);
      if (result.done) { done = true; return; }
      yield result.value;
    }
  } finally {
    if (!done) {
      const closing = Promise.resolve().then(() => iterator.return?.());
      if (signal.aborted) void closing.catch(() => undefined);
      else await interruptible(() => closing, signal);
    }
  }
}
