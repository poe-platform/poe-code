import type { ByteSource } from "../contracts.js";

/** CPython TextIO's decode window, independent of transport fragmentation.
 * Copy each borrowed fragment before advancing its producer. Storage is bounded
 * by one decode window; runtime admission owns the source byte budget.
 */
export async function* decodeFrames(source: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let frame = new Uint8Array(8192);
  let used = 0;
  try { for await (const chunk of source) {
    signal.throwIfAborted();
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(frame.length - used, chunk.length - offset);
      frame.set(chunk.subarray(offset, offset + count), used);
      used += count;
      offset += count;
      if (used === frame.length) {
        const complete = frame;
        frame = new Uint8Array(8192);
        used = 0;
        yield complete;
        signal.throwIfAborted();
      }
    }
  } } catch (failure) {
    signal.throwIfAborted();
    if (used) yield frame.subarray(0, used);
    throw failure;
  }
  signal.throwIfAborted();
  if (used) yield frame.subarray(0, used);
}
