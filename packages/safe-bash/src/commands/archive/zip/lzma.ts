import type { ByteSource } from "../../../contracts/index.js";
import { boundedCodec } from "../../bytes/compression/bounded-codec.js";
import type { CodecInput } from "../../bytes/compression/codec.js";
import { fail } from "../internal.js";

/** ZIP 6.3.4: version, property length, LZMA1 properties, then raw stream. */
export async function* zipLzma(input: CodecInput, signal: AbortSignal, options: Readonly<{ decode: boolean; level: number; eos: boolean; size: number }>): ByteSource {
  signal.throwIfAborted();
  let dictionary = 1024 * 1024;
  let properties = 93; // lc=3, lp=0, pb=2
  if (options.decode) {
    const header = new Uint8Array(9);
    let offset = 0;
    while (offset < header.length) {
      const chunk = await input.chunk();
      signal.throwIfAborted();
      if (!chunk) fail("ZIP truncated LZMA properties");
      const count = Math.min(chunk.length, header.length - offset);
      header.set(chunk.subarray(0, count), offset);
      offset += count;
      // The producer stays suspended until this remainder is consumed. Do not
      // duplicate its entire slab merely to read a nine-byte property header.
      if (count < chunk.length) input.restore(chunk.subarray(count));
    }
    // SDK LZMA1 version bytes describe the encoder, not a required decoder.
    // Qualify the published 9.4 framing only; other versions remain open.
    if (header[0] !== 9 || header[1] !== 4 || header[2] !== 5 || header[3] !== 0) fail("ZIP unsupported LZMA version or property length");
    properties = header[4]!;
    dictionary = new DataView(header.buffer).getUint32(5, true);
  } else {
    const header = Uint8Array.of(9, 4, 5, 0, properties, 0, 0, 16, 0);
    yield header;
    signal.throwIfAborted();
  }
  yield* boundedCodec(input, {
    format: "xz", decompress: options.decode, level: options.level, singleMember: true,
    lzma: { dictionary, properties, eos: options.eos, size: options.size },
  }, signal);
}
