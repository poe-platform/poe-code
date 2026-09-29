import { sourceBytes } from "./request-source.js";
/** Encode a UTF-8 byte source as one JSON string with bounded decoding state. */
export async function* jsonString(source: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  signal.throwIfAborted();
  yield encoder.encode('"');
  for await (const input of sourceBytes(source, signal)) {
    signal.throwIfAborted();
    for (let position = 0; position < input.byteLength; position += 2048) {
      signal.throwIfAborted();
      const text = decoder.decode(input.subarray(position, position + 2048), { stream: true });
      if (text) yield encoder.encode(JSON.stringify(text).slice(1, -1));
    }
  }
  signal.throwIfAborted();
  const final = decoder.decode();
  if (final) yield encoder.encode(JSON.stringify(final).slice(1, -1));
  yield encoder.encode('"');
}
