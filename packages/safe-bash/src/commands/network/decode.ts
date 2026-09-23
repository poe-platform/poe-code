import { readBytes, type ByteSource } from "../../contracts/index.js";
import { withSignal } from "./shared.js";
import { CurlError } from "./types.js";

const maxEncodingLayers = 4;

export async function* decodeContent(source: ByteSource, encoding: string, signal: AbortSignal, maxBytes: number): ByteSource {
  // Admit the whole chain before creating native decoders, including identity tokens.
  let layers = 1;
  for (const character of encoding) {
    if (character === "," && ++layers > maxEncodingLayers) throw new CurlError(61, "Too many content encoding layers");
  }
  const formats = encoding.split(",").map(value => value.trim().toLowerCase()).filter(value => value !== "identity");
  if (formats.some(value => value !== "gzip" && value !== "deflate")) throw new CurlError(61, "Unsupported content encoding");
  if (!formats.length) { yield* source; return; }
  const iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  let inputError: unknown;
  let inputFailed = false;
  let stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(new Uint8Array(next.value));
      } catch (error) { inputFailed = true; inputError = error; controller.error(error); }
    },
    async cancel() { await iterator.return?.(undefined); },
  });
  let budgetError: CurlError | undefined;
  for (const format of formats.reverse()) {
    let decodedBytes = 0;
    stream = stream.pipeThrough(new DecompressionStream(format as "gzip" | "deflate"))
      .pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform(chunk, controller) {
          signal.throwIfAborted();
          decodedBytes += chunk.byteLength;
          if (decodedBytes > maxBytes) {
            budgetError = new CurlError(63, "Decoded response exceeds download byte limit");
            throw budgetError;
          }
          controller.enqueue(chunk);
        },
      }));
  }
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await withSignal(() => reader.read(), signal);
      if (next.done) return;
      yield next.value;
    }
  } catch {
    signal.throwIfAborted();
    if (inputFailed) throw inputError;
    if (budgetError) throw budgetError;
    throw new CurlError(61, "Invalid compressed response body");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
