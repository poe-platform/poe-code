import { sourceBytes } from "./request-source.js";
/** Base64 an injected byte source without retaining its complete contents. */
export async function* base64Stream(source: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  let remainder = new Uint8Array(0);
  for await (const input of sourceBytes(source, signal)) {
    signal.throwIfAborted();
    for (let position = 0; position < input.length; position += 8190) {
      signal.throwIfAborted();
      const next = input.subarray(position, position + 8190);
      const bytes = new Uint8Array(remainder.length + next.length);
      bytes.set(remainder); bytes.set(next, remainder.length);
      const length = bytes.length - bytes.length % 3;
      if (length) yield btoa(String.fromCharCode(...bytes.subarray(0, length)));
      remainder = bytes.slice(length);
    }
  }
  signal.throwIfAborted();
  if (remainder.length) yield btoa(String.fromCharCode(...remainder));
}
