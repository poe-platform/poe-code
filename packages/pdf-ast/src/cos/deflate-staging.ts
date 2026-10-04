import { createByteCodec } from "@poe-code/compression";
import { PdfFileSource } from "../source.js";
import type { PdfIndexStorage } from "./object-index.js";

/** Encode with the ordinary writer's codec while staging only on caller storage. */
export async function stageDeflatedPdf(input: AsyncIterable<Uint8Array>, storage: PdfIndexStorage, signal: AbortSignal, maxBytes = Infinity): Promise<PdfFileSource> {
  async function* compressed() {
    const codec = createByteCodec({ direction: "encode", format: "zlib", chunkSize: 16384 });
    let work = 0;
    try {
      for await (const bytes of input) for (let at = 0; at < bytes.length; at += 16384) {
        signal.throwIfAborted();
        yield* codec.push(bytes.subarray(at, at + 16384));
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      signal.throwIfAborted(); yield* codec.push(new Uint8Array(), true);
    } finally { codec.close(); }
  }
  return PdfFileSource.fromStream(storage.fs, storage.directory, compressed(), { signal, maxInputBytes: maxBytes });
}
