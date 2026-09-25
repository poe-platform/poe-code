import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { ByteSource } from "safe-bash-contracts";
import type { CodecInput } from "./codec.js";
import { boundedCodec, type BoundedCodecOptions } from "./bounded-codec.js";
import { gunzipMember } from "./gunzip.js";

/** Zstd CLI decoding selects a codec anew at each compressed member boundary. */
export async function* zstdDecode(input: CodecInput, options: BoundedCodecOptions, signal: AbortSignal): ByteSource {
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
}
