import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { ByteSource } from "safe-bash-contracts";
import { CodecReader, type CodecInput } from "./codec.js";
import { boundedCodec, type BoundedCodecOptions } from "./bounded-codec.js";
import { gunzipMember } from "./gunzip.js";

// fread fills ZSTD_DStreamInSize even when a pipe supplies tiny chunks. Keep
// these boundaries across members so a failed codec read is never published.
async function* zstdReads(source: CodecInput, signal: AbortSignal): ByteSource {
  let remainder: Uint8Array = new Uint8Array();
  let pulls = 0;
  for (;;) {
    const read = new Uint8Array(128 * 1024 + 3);
    let length = 0;
    while (length < read.length) {
      const part = remainder.length ? remainder : await source.chunk();
      signal.throwIfAborted();
      if (!part) break;
      const count = Math.min(part.length, read.length - length);
      read.set(part.subarray(0, count), length);
      length += count;
      remainder = part.subarray(count);
      if (++pulls >= 64) { await yieldTurn(signal); pulls = 0; }
    }
    if (!length) return;
    yield read.subarray(0, length);
    if (length < read.length) return;
  }
}

/** Zstd CLI decoding selects a codec anew at each compressed member boundary. */
export async function* zstdDecode(source: CodecInput, options: BoundedCodecOptions, signal: AbortSignal, passthrough = false): ByteSource {
  const input = new CodecReader(zstdReads(source, signal), signal);
  try {
    let members = 0;
    let xzPadding = false;
    for (;;) {
      signal.throwIfAborted();
      const header = new Uint8Array(13);
      let length = 0;
      let padding = 0;
      let work = 0;
      while (length < header.length) {
        const bytes = await input.chunk();
        if (!bytes) break;
        let offset = 0;
        if (xzPadding && !length) {
          while (offset < bytes.length && bytes[offset] === 0) {
            offset++;
            padding = (padding + 1) % 4;
            if (++work >= 65536) { await yieldTurn(signal); work = 0; }
          }
        }
        const count = Math.min(bytes.length - offset, header.length - length);
        header.set(bytes.subarray(offset, offset + count), length);
        length += count;
        input.restore(bytes.subarray(offset + count));
      }
      if (padding) throw new PublicDiagnostic("invalid XZ stream padding");
      if (!length && members) return;
      // Only unknown headers pass through; recognized but damaged members must fail.
      const magic = new DataView(header.buffer).getUint32(0, true);
      const recognized = length >= 4 && (
        (magic >= 0xfd2fb525 && magic <= 0xfd2fb528) || (magic & 0xfffffff0) === 0x184d2a50 ||
        (magic & 0xffff) === 0x8b1f || (magic & 0xffff) === 0x005d || magic === 0x587a37fd || magic === 0x184d2204
      );
      if (passthrough && length && !recognized) {
        yield header.subarray(0, length);
        for (;;) {
          const bytes = await input.chunk();
          if (!bytes) return;
          yield bytes;
        }
      }
      const remainder = await input.chunk();
      const restored = new Uint8Array(length + (remainder?.length ?? 0));
      restored.set(header.subarray(0, length));
      if (remainder) restored.set(remainder, length);
      input.restore(restored);
      xzPadding = false;
      if (length >= 2 && header[0] === 31 && header[1] === 139) {
        yield* gunzipMember(input, signal);
      } else {
        let selected: BoundedCodecOptions = { ...options, singleMember: true };
        if (length >= 6 && [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0].every((value, index) => header[index] === value)) {
          selected = { format: "xz", decompress: true, level: 1, singleMember: true };
          xzPadding = true;
        } else if (length === 13 && header[0]! < 225 && header[0]! % 9 + Math.floor(header[0]! / 9) % 5 <= 4) {
          const view = new DataView(header.buffer);
          const size = view.getBigUint64(5, true);
          const eos = size === 0xffffffffffffffffn;
          if (!eos && size > BigInt(Number.MAX_SAFE_INTEGER)) throw new PublicDiagnostic("invalid LZMA size");
          selected = { format: "xz", decompress: true, level: 1, singleMember: true,
            lzma: { dictionary: view.getUint32(1, true), properties: header[0]!, eos, size: eos ? 0 : Number(size) } };
          input.restore(restored.subarray(13));
        }
        yield* boundedCodec(input, selected, signal);
      }
      members++;
      await yieldTurn(signal);
    }
  } finally {
    await input.close();
  }
}
