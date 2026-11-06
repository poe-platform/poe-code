import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import type { CommandContext, FileReadHandle, FileStat } from "safe-bash-contracts";
import { loadRawCodecFactory } from "safe-bash-compression-engine/codec-loader";
import { crcTable } from "safe-bash-compression-engine/crc";
import { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";
import { FileOperation } from "safe-bash-compression-engine/file-operation";
import type { Operand } from "safe-bash-compression-engine/files";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { CompressionOptions } from "safe-bash-compression-engine/options";

export interface XzListing {
  streams: number;
  blocks: number;
  compressed: number;
  uncompressed: number;
  padding: number;
  checks: Set<number>;
  details?: {
    streams: XzStream[];
    memory: number;
    allSizes: boolean;
    minVersion: number;
  };
}

interface XzStream {
  offset: number;
  compressed: number;
  uncompressed: number;
  padding: number;
  check: number;
  blocks: XzBlock[];
}
interface XzBlock {
  offset: number;
  decodedOffset: number;
  compressed: number;
  uncompressed: number;
  unpadded: number;
  header?: { size: number; flags: string; compressed: number; memory: number; filters: string; checkValue: string };
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

/** Inspect stream metadata, plus Block Headers and checks at -vv, through a retained VFS handle. */
export async function inspectXz(context: CommandContext, plan: Operand, options: Readonly<Pick<CompressionOptions, "xzDecompressMemory" | "xzFilters" | "xzVerbose">> = {}): Promise<XzListing> {
  if (plan.source === "-") throw new PublicDiagnostic("--list does not support reading from standard input");
  let handle: FileReadHandle | undefined;
  const operation = new FileOperation(context, async () => { await handle?.close(); });
  try {
    handle = await operation.run(() => operation.fs.openReadFile!(plan.source, { signal: operation.signal, ...(plan.sourceStat ? { expected: plan.sourceStat } : {}) }));
    const stat = await operation.run(() => handle!.stat({ signal: operation.signal }));
    if (!plan.sourceStat || !sameObservation(plan.sourceStat, stat)) throw new PublicDiagnostic("input identity or metadata changed");
    if (stat.size === 0) throw new PublicDiagnostic("File is empty");
    if (stat.size < 24) throw new PublicDiagnostic("Too small to be a valid .xz file");
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
    const magic = await read(0, 6);
    if (![0xfd, 0x37, 0x7a, 0x58, 0x5a, 0].every((value, index) => magic[index] === value)) {
      throw new PublicDiagnostic("File format not recognized");
    }
    if (stat.size % 4) corrupt();
    const listing: XzListing = { streams: 0, blocks: 0, compressed: stat.size, uncompressed: 0, padding: 0, checks: new Set() };
    if (options.xzVerbose) listing.details = { streams: [], memory: 0, allSizes: true, minVersion: 50000002 };
    const memoryLimit = options.xzDecompressMemory ?? 0;
    const module = memoryLimit || options.xzFilters || (options.xzVerbose ?? 0) > 1 ? (await loadRawCodecFactory("xz"))(Object.freeze({})) : undefined;
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
        if (!Number.isFinite(required)) throw new PublicDiagnostic("Memory usage limit reached");
        if (required > memoryLimit) {
          const limit = memoryLimit < 1048576 ? `${memoryLimit} B` : `${Math.ceil(memoryLimit / 1048576)} MiB`;
          throw new PublicDiagnostic(`Memory usage limit reached\n${context.command}: ${Math.ceil(required / 1048576)} MiB of memory is required. The limit is ${limit}.`);
        }
      }
      const blocks: XzBlock[] = [];
      let blockBytes = 0;
      let uncompressed = 0;
      for (let index = 0; index < count; index++) {
        const unpadded = await vli();
        const decoded = await vli();
        if (unpadded < 5) corrupt();
        if (listing.details) blocks.push({ offset: blockBytes + 12, decodedOffset: uncompressed, compressed: Math.ceil(unpadded / 4) * 4, uncompressed: decoded, unpadded });
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
      if (listing.details) {
        for (const block of blocks) {
          block.offset += start;
          if ((options.xzVerbose ?? 0) < 2) continue;
          await yieldTurn(operation.signal);
          const check = footer[9]!;
          const checkSize = check === 0 ? 0 : 4 * 2 ** Math.floor((check - 1) / 3);
          const first = await read(block.offset, 1);
          const headerSize = (first[0]! + 1) * 4;
          if (!first[0] || headerSize + checkSize >= block.unpadded) corrupt();
          const header = await read(block.offset, headerSize);
          if (!module?.bridge_xz_block) throw new Error("XZ block inspector is unavailable");
          new Uint8Array(module.memory.buffer, module.bridge_input(), headerSize).set(header);
          if (module.bridge_xz_block(module.bridge_input(), check, block.unpadded >>> 0, Math.floor(block.unpadded / 0x100000000), block.uncompressed >>> 0, Math.floor(block.uncompressed / 0x100000000)) !== 0) corrupt();
          const metadata = new DataView(module.memory.buffer, module.bridge_output(), 24);
          const memory = metadata.getFloat64(8, true);
          const flags = `${header[1]! & 64 ? "c" : "-"}${header[1]! & 128 ? "u" : "-"}`;
          const filters = new TextDecoder().decode(new Uint8Array(module.memory.buffer, module.bridge_output() + 24, module.bridge_produced() - 24));
          const checkBytes = await read(block.offset + block.compressed - checkSize, checkSize);
          if (check === 1 || check === 4) checkBytes.reverse();
          block.header = { size: headerSize, flags, compressed: metadata.getFloat64(0, true), memory, filters,
            checkValue: checkSize ? Array.from(checkBytes, byte => byte.toString(16).padStart(2, "0")).join("") : "---" };
          listing.details.memory = Math.max(listing.details.memory, memory);
          listing.details.allSizes &&= flags === "cu";
          listing.details.minVersion = Math.max(listing.details.minVersion, metadata.getFloat64(16, true));
        }
        listing.details.streams.push({ offset: start, compressed: end - start, uncompressed, padding, check: footer[9]!, blocks });
      }
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
    listing.details?.streams.reverse();
    return listing;
  } finally { await operation.close(); context.signal.throwIfAborted(); }
}

export function listingRatio(value: Pick<XzListing, "compressed" | "uncompressed">): string {
  const ratio = value.compressed / value.uncompressed;
  return !Number.isFinite(ratio) || ratio > 9.999 ? "---" : ratio.toFixed(3);
}
export function listingChecks(value: Pick<XzListing, "checks">): string {
  const names: Readonly<Record<number, string>> = { 0: "None", 1: "CRC32", 4: "CRC64", 10: "SHA-256" };
  return [...value.checks].sort((a, b) => a - b).map(check => names[check] ?? `Unknown-${check}`).join(",") || "None";
}
function listingSize(bytes: number): string {
  if (bytes < 10000) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let unit = 0;
  let amount = bytes / 1024;
  while (amount >= 10000 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${amount.toFixed(1)} ${units[unit]}`;
}

export function humanListing(value: XzListing, name: string): string {
  return `${String(value.streams).padStart(5)} ${String(value.blocks).padStart(7)} ${listingSize(value.compressed).padStart(12)} ${listingSize(value.uncompressed).padStart(12)} ${listingRatio(value).padStart(6)}  ${listingChecks(value).padEnd(7)} ${name}\n`;
}

export function listingSummary(value: XzListing, robot: boolean): string {
  const details = value.details!;
  if (robot) return `${details.memory}\t${details.allSizes ? "yes" : "no"}\t${details.minVersion}`;
  const version = details.minVersion;
  return `  Memory needed:     ${Math.ceil(details.memory / 1048576)} MiB\n  Sizes in headers:  ${details.allSizes ? "Yes" : "No"}\n  Minimum XZ Utils version: ${Math.floor(version / 10000000)}.${Math.floor(version / 10000) % 1000}.${Math.floor(version / 10) % 1000}\n`;
}

export function verboseListing(value: XzListing, robot: boolean, verbosity: number): string {
  const details = value.details!;
  const checkWidth = Math.max(8, ...[...value.checks].map(check => check === 0 ? 0 : 8 * 2 ** Math.floor((check - 1) / 3)));
  let result = robot ? "" : "  Streams:\n    Stream    Blocks      CompOffset    UncompOffset        CompSize      UncompSize  Ratio  Check      Padding\n";
  let decodedOffset = 0;
  const row = (stream: number, index: number, offset: number, decoded: number, size: number, uncompressed: number, check: string): string =>
    `  ${String(stream).padStart(8)}  ${String(index).padStart(8)}  ${String(offset).padStart(14)}  ${String(decoded).padStart(14)}  ${String(size).padStart(14)}  ${String(uncompressed).padStart(14)}  ${listingRatio({ compressed: size, uncompressed }).padStart(5)}  ${check}`;
  for (const [index, stream] of details.streams.entries()) {
    const check = listingChecks({ checks: new Set([stream.check]) });
    result += robot
      ? `stream\t${index + 1}\t${stream.blocks.length}\t${stream.offset}\t${decodedOffset}\t${stream.compressed}\t${stream.uncompressed}\t${listingRatio(stream)}\t${check}\t${stream.padding}\n`
      : row(index + 1, stream.blocks.length, stream.offset, decodedOffset, stream.compressed, stream.uncompressed, check.padEnd(10)) + `  ${String(stream.padding).padStart(6)}\n`;
    decodedOffset += stream.uncompressed;
  }
  if (!robot && value.blocks) result += "  Blocks:\n    Stream     Block      CompOffset    UncompOffset       TotalSize      UncompSize  Ratio  Check" + (verbosity > 1 ? `      ${"CheckVal".padEnd(checkWidth)}  Header  Flags        CompSize    MemUsage  Filters` : "") + "\n";
  decodedOffset = 0;
  let blockNumber = 0;
  for (const [index, stream] of details.streams.entries()) {
    const check = listingChecks({ checks: new Set([stream.check]) });
    for (const [blockIndex, block] of stream.blocks.entries()) {
      blockNumber++;
      result += robot
        ? `block\t${index + 1}\t${blockIndex + 1}\t${blockNumber}\t${block.offset}\t${decodedOffset + block.decodedOffset}\t${block.compressed}\t${block.uncompressed}\t${listingRatio(block)}\t${check}`
        : row(index + 1, blockIndex + 1, block.offset, decodedOffset + block.decodedOffset, block.compressed, block.uncompressed, verbosity > 1 ? check.padEnd(10) : check);
      if (verbosity > 1) {
        const header = block.header!;
        result += robot
          ? `\t${header.checkValue}\t${header.size}\t${header.flags}\t${header.compressed}\t${header.memory}\t${header.filters}`
          : ` ${header.checkValue.padEnd(checkWidth)}  ${String(header.size).padStart(6)}  ${header.flags}     ${String(header.compressed).padStart(14)}  ${String(Math.ceil(header.memory / 1048576)).padStart(6)} MiB  ${header.filters}`;
      }
      result += "\n";
    }
    decodedOffset += stream.uncompressed;
  }
  if (verbosity > 1) result += robot ? `summary\t${listingSummary(value, true)}\n` : listingSummary(value, false);
  return result;
}

export function humanListingSummary(value: XzListing, files?: number): string {
  const size = (bytes: number): string => bytes < 10000 ? listingSize(bytes) : `${listingSize(bytes)} (${bytes} B)`;
  return (files === undefined ? "" : `  Number of files:   ${files}\n`) +
    `  Streams:           ${value.streams}\n  Blocks:            ${value.blocks}\n  Compressed size:   ${size(value.compressed)}\n  Uncompressed size: ${size(value.uncompressed)}\n  Ratio:             ${listingRatio(value)}\n  Check:             ${listingChecks(value).split(",").join(", ")}\n  Stream Padding:    ${size(value.padding)}\n`;
}
