export interface TransferLimits {maxChunkBytes:number;maxBytes:number;maxWallClockMs:number}

/** One downstream pull grants one chunk. Never collect or split media bodies.
 * SDK/backend buffering is outside this queue and needs separate qualification. */
export function boundedTransfer(body: ReadableStream<Uint8Array>, limits: TransferLimits | undefined, signal: AbortSignal, abort: AbortController, retireOnEnd = false, abortOnError = true): ReadableStream<Uint8Array> {
 const reader = body.getReader();
 let total = 0;
 let finished = false;
 let stop: () => void;
 function finish(reason?: unknown, cancel = false) {
  if (finished) return Promise.resolve();
  finished = true;
  signal.removeEventListener('abort', stop);
  if (cancel) return reader.cancel(reason).catch(() => {}).finally(() => reader.releaseLock());
  reader.releaseLock();
  return Promise.resolve();
 }
 return new ReadableStream<Uint8Array>({
  start(controller) {
   stop = () => { if (!finished) { controller.error(signal.reason); void finish(signal.reason, true); } };
   signal.addEventListener('abort', stop, { once: true });
   if (signal.aborted) stop();
  },
  async pull(controller) {
   try {
    signal.throwIfAborted();
    const part = await reader.read();
    if (finished) return;
    if (part.done) { await finish(); controller.close(); if (retireOnEnd) abort.abort(new Error('Transfer complete')); return; }
    if (!(part.value instanceof Uint8Array)) throw new TypeError('Transfer bytes required');
    if (limits) {
     const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(part.value) as number;
     if (length > limits.maxChunkBytes || length > limits.maxBytes - total) throw new RangeError('Transfer byte limit');
     total += length;
    }
    controller.enqueue(part.value);
   } catch (error) {
    if (!finished) { controller.error(error); const cleanup = finish(error, true); if (abortOnError) abort.abort(error); await cleanup; }
   }
  },
  async cancel(reason) { const cleanup = finish(reason, true); if (abortOnError) abort.abort(reason); await cleanup; },
 }, { highWaterMark: 0 });
}
