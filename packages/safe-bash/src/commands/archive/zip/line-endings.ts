import { fail } from "../internal.js";
import { yieldTurn } from "../../../contracts/yield.js";

// Info-ZIP Unix STORE and DEFLATE first-read sizes after -l halves the buffer.
export async function zipToCrlf(bytes: Uint8Array, store: boolean, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  let text = false;
  for (let index = 0; index < Math.min(bytes.length, store ? 8192 : 32768); index++) {
    const byte = bytes[index]!;
    if (byte <= 6 || byte >= 14 && byte <= 25 || byte >= 28 && byte <= 31) return bytes;
    if (byte >= 32) text = true;
  }
  if (!text) return bytes;
  let size = bytes.length;
  for (let index = 0; index < bytes.length; index++) {
    if (index % 32768 === 0) await yieldTurn(signal);
    if (bytes[index] === 10 && ++size > maxBytes) fail("converted payload byte limit exceeded");
  }
  if (size === bytes.length) return bytes;
  const output = new Uint8Array(size);
  let offset = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (index % 32768 === 0) await yieldTurn(signal);
    const byte = bytes[index]!;
    if (byte === 10) output[offset++] = 13;
    output[offset++] = byte;
  }
  return output;
}
