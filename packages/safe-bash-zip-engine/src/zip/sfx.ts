import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import type { ZipMetadataFactory } from "./metadata-types.js";
import { ZipRanges, type ZipReadSource } from "./ranges.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { fail,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";
import { decodeZipEntry,readZipArchive,readZipIndexedArchive,type ZipArchive,type ZipIndexedArchive } from "../zip-format.js";

/** Accept only a complete validated archive following a prefix. Never execute it. */
export function readZipSfx(input: Uint8Array | ZipReadSource, limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array): Promise<ZipArchive>;
export function readZipSfx(input: Uint8Array | ZipReadSource, limits: ArchiveLimits, signal: AbortSignal, password: Uint8Array | undefined, factory: ZipMetadataFactory): Promise<ZipIndexedArchive>;
export function readZipSfx(input: Uint8Array | ZipReadSource, limits: ArchiveLimits, signal: AbortSignal, password: Uint8Array | undefined, factory: ZipMetadataFactory | undefined): Promise<ZipArchive | ZipIndexedArchive>;
export async function readZipSfx(input: Uint8Array | ZipReadSource, limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array, factory?: ZipMetadataFactory): Promise<ZipArchive | ZipIndexedArchive> {
  signal.throwIfAborted();
  const source: ZipReadSource = input instanceof Uint8Array ? { size: input.length, read: async (offset, length) => input.slice(offset, offset + length) } : input;
  const bytes = new ZipRanges(source, signal, Math.min(limits.chunkSize, 65536));
  if (bytes.length > limits.maxArchiveBytes) fail("ZIP archive byte limit exceeded");
  const read = (source: ZipReadSource, prefix = false) => factory ? readZipIndexedArchive(source, limits, signal, factory, { prefix }) : readZipArchive(source, limits, signal, { prefix });
  let archive: ZipArchive | ZipIndexedArchive | undefined;
  try { archive = await read(source, true); }
  catch (error) { signal.throwIfAborted(); if (factory && !(error instanceof PublicDiagnostic)) throw error; }
  if (!archive) {
    const view = bytes;
    // Unadjusted SFX offsets are relative to the embedded ZIP. Signature
    // recognition only nominates a candidate; the strict reader proves all spans.
    for (let offset = 1; offset + 22 <= bytes.length; offset++) {
      if (offset > limits.maxPatternSteps) fail("ZIP SFX scan work limit exceeded");
      if (offset % 4096 === 0) await yieldTurn(signal);
      const signature = await view.getUint32(offset, true);
      if (signature !== 0x04034b50 && signature !== 0x06054b50) continue;
      let candidate: ZipArchive | ZipIndexedArchive;
      try { candidate = await read(bytes.slice(offset)); }
      catch (error) { signal.throwIfAborted(); if (factory && !(error instanceof PublicDiagnostic)) throw error; continue; }
      if ("get" in candidate.entries) {
        const entries = candidate.entries;
        archive = { ...candidate, entries: {
          length: entries.length,
          async get(index) {
            const entry = await entries.get(index);
            if (entry.compressedOffset !== undefined) entry.compressedOffset += offset;
            return entry;
          },
          async *[Symbol.asyncIterator]() { for (let index = 0; index < this.length; index++) yield await this.get(index); },
        } } as ZipIndexedArchive;
      } else {
        for (const entry of candidate.entries) if (entry.compressedOffset !== undefined) entry.compressedOffset += offset;
        archive = candidate;
      }
      break;
    }
  }
  if (!archive) fail("ZIP SFX prefix does not contain a validated archive");
  // CRC/expanded-size validation is required before prefix removal publication.
  let decoded = 0;
  try {
  for await (const entry of archive.entries) {
    for await (const chunk of decodeZipEntry(entry, limits, signal, password, source => source)) {
      if (chunk.length > limits.maxTotalBytes - decoded) fail("ZIP SFX decoded byte limit exceeded");
      decoded += chunk.length;
    }
  }
  return archive;
  } catch (error) { if ("close" in archive) await archive.close(); throw error; }
}
