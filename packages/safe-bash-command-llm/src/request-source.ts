export function waitForSource<Value>(start: () => PromiseLike<Value>|Value, signal: AbortSignal, late?: (value:Value)=>Promise<void>): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener("abort", abort); if (signal.aborted) {if(late)void Promise.resolve().then(()=>late(value)).catch(()=>undefined);reject(signal.reason);} else resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(signal.aborted ? signal.reason : error); },
    );
    if (signal.aborted) abort();
  });
}

/** Pull borrowed input chunks, preserving backpressure and cancellation/retirement. */
export async function* sourceBytes(source: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  signal.throwIfAborted();
  const iterator = source[Symbol.asyncIterator]();
  let ended = false, failed = false;
  try {
    while (true) {
      const next = await waitForSource(() => iterator.next(), signal);
      if (next.done) { ended = true; return; }
      if (!(next.value instanceof Uint8Array)) throw new TypeError("LLM input must yield byte chunks");
      yield next.value;
    }
  } catch (error) {
    failed = true;
    throw signal.aborted ? signal.reason : error;
  } finally {
    if (!ended) {
      const returned = Promise.resolve().then(() => iterator.return?.());
      if (signal.aborted) void returned.catch(() => undefined);
      else await waitForSource(() => returned, signal).catch(error => { if (!failed) throw error; });
    }
  }
}
