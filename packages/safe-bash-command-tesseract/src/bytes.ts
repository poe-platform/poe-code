import { TesseractError } from './contracts.js';
/** Reserves maxBytes once. Source must honor signal while awaiting I/O; iterator ownership transfers to this invocation. */
export async function readTesseractBytes(input: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal, maxChunks = 4096): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 0x7fffffff || !Number.isSafeInteger(maxChunks) || maxChunks < 1) throw new TesseractError('limit', 'invalid input limits');
  const check = () => { if (signal.aborted) throw new TesseractError('cancelled', 'input admission cancelled'); };
  check();
  const iterator = input[Symbol.asyncIterator]();
  let failed = false, failure: unknown, result: Uint8Array | undefined;
  try {
    const output = new Uint8Array(maxBytes);
    let length = 0, chunks = 0;
    for (;;) {
      check();
      const step = await iterator.next();
      check();
      if (step.done) break;
      const chunk = step.value;
      if (++chunks > maxChunks) throw new TesseractError('limit', 'exhausted inputChunks', 'inputChunks');
      if (!(chunk instanceof Uint8Array)) throw new TesseractError('invalid-argument', 'input requires byte chunks');
      if (chunk.byteLength > maxBytes - length) throw new TesseractError('limit', 'exhausted inputBytes', 'inputBytes');
      for (let offset = 0; offset < chunk.byteLength; offset += 65536) {
        check();
        const end = Math.min(offset + 65536, chunk.byteLength);
        output.set(chunk.subarray(offset, end), length);
        length += end - offset;
      }
    }
    result = output.subarray(0, length);
  } catch (error) {
    failed = true; failure = error;
  }
  try { await iterator.return?.(); }
  catch (cleanup) {
    if (failed) throw new AggregateError([failure, cleanup], 'input and cleanup failed');
    throw cleanup;
  }
  if (failed) throw failure;
  check();
  return result!;
}
