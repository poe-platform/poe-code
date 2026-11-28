import type { CommandContext } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { escapeText } from "safe-bash-contracts/escaping";
import { yieldTurn } from "safe-bash-contracts/yield";
import { CodecReader } from "safe-bash-compression-engine/codec";
import { sourceBytes, type Operand } from "safe-bash-compression-engine/files";

export interface ZstdListing {
  frames: number;
  skips: number;
  compressed: number;
  uncompressed: bigint;
  knownSize: boolean;
  checksummed: boolean;
}

/** Read frame/block headers without decoding or retaining compressed payloads. */
export async function inspectZstd(context: CommandContext, plan: Operand): Promise<ZstdListing> {
  if (plan.source === "-") throw new PublicDiagnostic("--list does not support reading from standard input");
  const reader = new CodecReader(sourceBytes(context, plan, context.signal), context.signal);
  const listing: ZstdListing = { frames: 0, skips: 0, compressed: 0, uncompressed: 0n, knownSize: true, checksummed: false };
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  const consume = async (length: number, target?: Uint8Array): Promise<void> => {
    let offset = 0;
    while (offset < length) {
      const bytes = await reader.chunk();
      if (!bytes) throw new PublicDiagnostic("reached end of file with incomplete frame");
      const count = Math.min(bytes.length, length - offset);
      target?.set(bytes.subarray(0, count), offset);
      offset += count;
      listing.compressed += count;
      reader.restore(bytes.subarray(count));
    }
  };
  try {
    for (;;) {
      const next = await reader.chunk();
      if (!next) break;
      reader.restore(next);
      await yieldTurn(context.signal);
      await consume(4, header);
      const magic = view.getUint32(0, true);
      listing.frames++;
      if ((magic & 0xfffffff0) === 0x184d2a50) {
        await consume(4, header);
        await consume(view.getUint32(0, true));
        listing.skips++;
        continue;
      }
      if (magic !== 0xfd2fb528) throw new PublicDiagnostic("not compressed by zstd");
      await consume(1, header);
      const descriptor = header[0]!;
      if (descriptor & 8) throw new PublicDiagnostic("invalid Zstandard frame header");
      const singleSegment = (descriptor & 32) !== 0;
      const checksum = (descriptor & 4) !== 0;
      listing.checksummed ||= checksum;
      if (!singleSegment) await consume(1);
      await consume([0, 1, 2, 4][descriptor & 3]!);
      const sizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >>> 6]!;
      if (!sizeBytes) listing.knownSize = false;
      else {
        await consume(sizeBytes, header);
        let size = 0n;
        for (let index = sizeBytes - 1; index >= 0; index--) size = (size << 8n) | BigInt(header[index]!);
        listing.uncompressed += size + (sizeBytes === 2 ? 256n : 0n);
      }
      let blocks = 0;
      for (;;) {
        if (++blocks % 64 === 0) await yieldTurn(context.signal);
        await consume(3, header);
        const block = header[0]! | (header[1]! << 8) | (header[2]! << 16);
        const type = (block >>> 1) & 3;
        const size = block >>> 3;
        if (type === 3 || size > 128 * 1024) throw new PublicDiagnostic("invalid Zstandard block header");
        await consume(type === 1 ? 1 : size);
        if (block & 1) break;
      }
      if (checksum) await consume(4);
    }
    if (!listing.frames) throw new PublicDiagnostic("not compressed by zstd");
    return listing;
  } finally { await reader.close(); }
}

function sizeText(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
  return `${(unit ? bytes.toFixed(bytes < 10 ? 3 : bytes < 100 ? 1 : 0) : String(bytes)).padStart(7)} ${units[unit]!.padStart(3)}`;
}

export function formatZstdListing(listing: ZstdListing, name: string, showCheck = true): string {
  const size = listing.knownSize ? sizeText(Number(listing.uncompressed)).padStart(13) : " ".repeat(13);
  const ratio = listing.knownSize ? (Number(listing.uncompressed) / listing.compressed).toFixed(3).padStart(5) : " ".repeat(5);
  const check = showCheck ? listing.checksummed && listing.frames > listing.skips ? "XXH64" : " None" : "     ";
  return `${String(listing.frames).padStart(6)} ${String(listing.skips).padStart(6)} ${sizeText(listing.compressed)} ${size}  ${ratio}  ${check}  ${escapeText(name, "display")}\n`;
}
