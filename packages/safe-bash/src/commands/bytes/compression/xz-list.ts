import { PublicDiagnostic } from "../../../diagnostics.js";
import type { CommandContext, FileReadHandle, FileStat } from "../../../contracts/index.js";
import { crcTable } from "../../archive/zip/crc.js";
import { compareCopyIdentity } from "../../copy-identity.js";
import { FileOperation } from "./file-operation.js";
import type { Operand } from "./files.js";
import { yieldTurn } from "../../../contracts/yield.js";
import type { CompressionOptions } from "./options.js";

export interface XzListing {
  streams: number;
  blocks: number;
  compressed: number;
  uncompressed: number;
  padding: number;
  checks: Set<number>;
}

function corrupt(): never { throw new PublicDiagnostic("Compressed data is corrupt"); }
function sameObservation(first: FileStat, second: FileStat): boolean {
  return compareCopyIdentity(first, second) === "same"
    && first.type === second.type && first.size === second.size && first.mode === second.mode
    && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs && first.nlink === second.nlink
    && first.birthtimeMs === second.birthtimeMs && first.uid === second.uid && first.gid === second.gid;
}
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Inspect only stream headers, footers and indices through a retained VFS handle. */
export async function inspectXz(context: CommandContext, plan: Operand, options: Readonly<Pick<CompressionOptions, "xzDecompressMemory" | "xzFilters">> = {}): Promise<XzListing> {
  if (plan.source === "-") throw new PublicDiagnostic("--list does not support reading from standard input");
  let handle: FileReadHandle | undefined;
  const operation = new FileOperation(context, async () => { await handle?.close(); });
  try {
    handle = await operation.run(() => operation.fs.openReadFile!(plan.source, { signal: operation.signal, ...(plan.sourceStat ? { expected: plan.sourceStat } : {}) }));
    const stat = await operation.run(() => handle!.stat({ signal: operation.signal }));
    if (!plan.sourceStat || !sameObservation(plan.sourceStat, stat)) throw new PublicDiagnostic("input identity or metadata changed");
    if (stat.size % 4) corrupt();
    const read = async (offset: number, length: number): Promise<Uint8Array> => {
      if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || length > 65536 || length > stat.size - offset) corrupt();
      const result = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const bytes = await operation.run(() => handle!.read(offset + done, length - done, { signal: operation.signal }));
        if (!bytes.length || bytes.length > length - done) corrupt();
        result.set(bytes, done);
        done += bytes.length;
      }
      return result;
    };
    const listing: XzListing = { streams: 0, blocks: 0, compressed: stat.size, uncompressed: 0, padding: 0, checks: new Set() };
    const memoryLimit = options.xzDecompressMemory ?? 0;
    const module = memoryLimit || options.xzFilters ? (await import("./native/generated/xz.mjs")).default(Object.freeze({})) : undefined;
    module?._initialize?.();
    operation.check();
    if (options.xzFilters) {
      const spec = new TextEncoder().encode(options.xzFilters.join(" ") + "\0");
      if (spec.length > 65536) throw new PublicDiagnostic("filter options exceed codec buffer");
      new Uint8Array(module!.memory.buffer, module!.bridge_input(), spec.length).set(spec);
      if (module!.bridge_validate_filters?.(module!.bridge_input()) !== 0) throw new PublicDiagnostic("invalid filter options");
      operation.check();
    }
    const indexMemory = module?.bridge_index_memusage;
    if (memoryLimit && !indexMemory) throw new Error("XZ index memory estimator is unavailable");
    let end = stat.size;
    while (end > 0) {
      let padding = 0;
      for (;;) {
        if (end < 4) corrupt();
        const length = Math.min(end, 65536);
        const tail = await read(end - length, length);
        let zeros = 0;
        while (zeros < length && tail[length - zeros - 1] === 0) zeros++;
        if (zeros % 4) corrupt();
        padding += zeros;
        end -= zeros;
        if (zeros < length) break;
        await yieldTurn(operation.signal);
      }
      listing.padding += padding;
      if (end < 24) corrupt();
      const footer = await read(end - 12, 12);
      const view = new DataView(footer.buffer);
      if (footer[10] !== 0x59 || footer[11] !== 0x5a || view.getUint32(0, true) !== crc(footer.subarray(4, 10)) || footer[8] !== 0 || footer[9]! > 15) corrupt();
      const indexSize = (view.getUint32(4, true) + 1) * 4;
      const indexStart = end - 12 - indexSize;
      if (indexStart < 12) corrupt();
      let position = indexStart;
      let window: Uint8Array = new Uint8Array();
      let windowOffset = 0;
      let checksum = 0xffffffff;
      const byte = async (): Promise<number> => {
        if (position >= end - 16) corrupt();
        if (windowOffset === window.length) {
          await yieldTurn(operation.signal);
          window = await read(position, Math.min(65536, end - 16 - position));
          windowOffset = 0;
        }
        const value = window[windowOffset++]!;
        position++;
        checksum = crcTable[(checksum ^ value) & 255]! ^ (checksum >>> 8);
        return value;
      };
      const vli = async (): Promise<number> => {
        let value = 0n;
        for (let shift = 0; shift < 63; shift += 7) {
          const part = await byte();
          value |= BigInt(part & 127) << BigInt(shift);
          if (!(part & 128)) {
            if (shift && part === 0 || value > BigInt(Number.MAX_SAFE_INTEGER)) corrupt();
            return Number(value);
          }
        }
        return corrupt();
      };
      if (await byte() !== 0) corrupt();
      const count = await vli();
      if (count > Math.floor((indexSize - 6) / 2)) corrupt();
      if (memoryLimit && indexMemory) {
        const streams = listing.streams + 1;
        const blocks = listing.blocks + count;
        const required = indexMemory(streams >>> 0, Math.floor(streams / 0x100000000), blocks >>> 0, Math.floor(blocks / 0x100000000));
        if (!Number.isFinite(required) || required > memoryLimit) throw new PublicDiagnostic("Memory usage limit reached");
      }
      let blockBytes = 0;
      let uncompressed = 0;
      for (let index = 0; index < count; index++) {
        const unpadded = await vli();
        const decoded = await vli();
        if (unpadded < 5) corrupt();
        blockBytes += Math.ceil(unpadded / 4) * 4;
        uncompressed += decoded;
        if (!Number.isSafeInteger(uncompressed) || blockBytes > indexStart - 12) corrupt();
      }
      const indexPadding = end - 16 - position;
      if (indexPadding > 3) corrupt();
      while (position < end - 16) if (await byte() !== 0) corrupt();
      const stored = await read(end - 16, 4);
      if (new DataView(stored.buffer).getUint32(0, true) !== ((checksum ^ 0xffffffff) >>> 0)) corrupt();
      const start = indexStart - blockBytes - 12;
      const header = await read(start, 12);
      if (![0xfd, 0x37, 0x7a, 0x58, 0x5a, 0].every((value, index) => header[index] === value)
        || header[6] !== footer[8] || header[7] !== footer[9]
        || new DataView(header.buffer).getUint32(8, true) !== crc(header.subarray(6, 8))) corrupt();
      listing.streams++;
      listing.blocks += count;
      listing.uncompressed += uncompressed;
      if (!Number.isSafeInteger(listing.uncompressed)) corrupt();
      listing.checks.add(footer[9]!);
      end = start;
    }
    if (!listing.streams) throw new PublicDiagnostic("File format not recognized");
    const current = await operation.run(() => handle!.stat({ signal: operation.signal }));
    if (!sameObservation(stat, current)) throw new PublicDiagnostic("input identity or metadata changed");
    return listing;
  } finally { await operation.close(); context.signal.throwIfAborted(); }
}

export function listingRatio(value: XzListing): string {
  const ratio = value.compressed / value.uncompressed;
  return !Number.isFinite(ratio) || ratio > 9.999 ? "---" : ratio.toFixed(3);
}
export function listingChecks(value: XzListing): string {
  const names: Readonly<Record<number, string>> = { 0: "None", 1: "CRC32", 4: "CRC64", 10: "SHA-256" };
  return [...value.checks].sort((a, b) => a - b).map(check => names[check] ?? `Unknown-${check}`).join(",") || "None";
}
export function humanListing(value: XzListing, name: string): string {
  const size = (bytes: number): string => {
    if (bytes < 10000) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let unit = 0;
    let amount = bytes / 1024;
    while (amount >= 10000 && unit < units.length - 1) { amount /= 1024; unit++; }
    return `${amount.toFixed(1)} ${units[unit]}`;
  };
  return `${String(value.streams).padStart(5)} ${String(value.blocks).padStart(7)} ${size(value.compressed).padStart(12)} ${size(value.uncompressed).padStart(12)} ${listingRatio(value).padStart(6)}  ${listingChecks(value).padEnd(7)} ${name}\n`;
}
