import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { createZipPatchWriter, type ZipPatchedSource } from "./metadata-patches.js";
import { ZipBackedEntries } from "./metadata-entries.js";
import { ZipMetadataMap } from "./metadata.js";
import type { ZipMetadataFactory } from "./metadata-types.js";
import { ZipRanges, joinZipSources, patchZipSource, type ZipReadSource } from "./ranges.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { concatBytes } from "safe-bash-io-engine/byte-encoding";
import { fail,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";
import { decodeZipEntry,readZipArchive,readZipIndexedArchive,type ZipIndexedArchive,type ZipArchive,type ZipEntry } from "../zip-format.js";
import { ZipFailure } from "./options.js";
import { stripZip64,zip64Fields,zipEnd } from "./zip64.js";

function zip64Payload(bytes: Uint8Array): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result: Uint8Array | undefined;
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail("ZIP truncated extra field");
    const next = offset + 4 + view.getUint16(offset + 2, true);
    if (next > bytes.length) fail("ZIP truncated extra field");
    if (view.getUint16(offset, true) === 1) {
      if (result) fail("ZIP duplicate ZIP64 extra field");
      result = bytes.subarray(offset + 4, next);
    }
    offset = next;
  }
  return result;
}

/** Recovery is opt-in. Signatures nominate records; the normal reader and
 * codecs validate metadata, descriptors, names, sizes and CRC before retention. */
export function repairZip(input: Uint8Array | ZipReadSource, mode: "F" | "FF", limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array): Promise<{ archive: ZipArchive; partial: boolean }>;
export function repairZip(input: Uint8Array | ZipReadSource, mode: "F" | "FF", limits: ArchiveLimits, signal: AbortSignal, password: Uint8Array | undefined, factory: ZipMetadataFactory): Promise<{ archive: ZipIndexedArchive; partial: boolean }>;
export function repairZip(input: Uint8Array | ZipReadSource, mode: "F" | "FF", limits: ArchiveLimits, signal: AbortSignal, password: Uint8Array | undefined, factory: ZipMetadataFactory | undefined): Promise<{ archive: ZipArchive | ZipIndexedArchive; partial: boolean }>;
export async function repairZip(input: Uint8Array | ZipReadSource, mode: "F" | "FF", limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array, factory?: ZipMetadataFactory): Promise<{ archive: ZipArchive | ZipIndexedArchive; partial: boolean }> {
  signal.throwIfAborted();
  const source: ZipReadSource = input instanceof Uint8Array ? { size: input.length, read: async (offset, length) => input.slice(offset, offset + length) } : input;
  const bytes = new ZipRanges(source, signal, Math.min(limits.chunkSize, 65536));
  if (bytes.length > limits.maxArchiveBytes) fail("ZIP archive byte limit exceeded");
  const view = bytes;
  const read = (source: ZipReadSource, prefix = false) => factory ? readZipIndexedArchive(source, limits, signal, factory, { prefix }) : readZipArchive(source, limits, signal, { prefix });
  let work = 0, candidates = 0, decoded = 0;
  const charge = (amount: number) => {
    signal.throwIfAborted();
    if (amount > limits.maxPatternSteps - work) throw new ZipFailure(4, "Out of memory", "ZIP recovery work limit exceeded");
    work += amount;
  };
  const verify = async (archive: Pick<ZipArchive | ZipIndexedArchive, "entries" | "comment">) => {
    for await (const entry of archive.entries) {
      for await (const chunk of decodeZipEntry(entry, limits, signal, password, source => source)) {
        charge(chunk.length);
        if (chunk.length > limits.maxTotalBytes - decoded) throw new ZipFailure(4, "Out of memory", "ZIP recovery total byte limit exceeded");
        decoded += chunk.length;
      }
    }
  };
  const recoverCentral = async (archive: ZipArchive | ZipIndexedArchive): Promise<{ archive: ZipArchive | ZipIndexedArchive; partial: boolean }> => {
    const entries: ZipEntry[] = [];
    const retained = factory ? new ZipBackedEntries(source, factory, signal, bytes.chunkSize) : undefined;
    let partial = false, count = 0;
    try {
      for await (const entry of archive.entries) {
        try {
          await verify({ entries: [entry], comment: new Uint8Array() });
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof ZipFailure) throw error;
          if (mode === "F") throw new ZipFailure(3, "Zip file structure invalid", "entry payload could not be verified; try -FF with a separate --out file");
          partial = true;
          continue;
        }
        if (retained) await retained.append(entry); else entries.push(entry);
        count++;
      }
      if (partial && !count) throw new ZipFailure(3, "Zip file structure invalid", "no verified members recovered");
      const prefix = {
        ...(archive.prefixSize === undefined ? {} : { prefixSize: archive.prefixSize }),
        ...(archive.prefixSource ? { prefixSource: archive.prefixSource } : {}),
        ...("prefix" in archive && archive.prefix ? { prefix: archive.prefix } : {}),
      };
      return { archive: retained ? { ...prefix, ...retained.archive(archive.comment) } : { ...prefix, entries, comment: archive.comment }, partial };
    } catch (error) { await retained?.close(); throw error; }
    finally { if ("close" in archive) await archive.close(); }
  };
  const admitCandidate = (length: number) => {
    if (++candidates > limits.maxMembers) fail("ZIP recovery candidate limit exceeded");
    charge(length);
    if (length > limits.maxArchiveBytes) fail("ZIP recovery archive byte limit exceeded");
  };
  charge(bytes.length);
  let complete: ZipArchive | ZipIndexedArchive | undefined;
  try { complete = await read(source, true); }
  catch (error) { signal.throwIfAborted(); if (factory && !(error instanceof PublicDiagnostic)) throw error; }
  try {
  if (complete && (complete.prefixSize ?? ("prefix" in complete ? complete.prefix?.length : undefined))) {
    // A complete ZIP at EOF can itself be a bounded outer member's payload.
    // Recovery must not reinterpret that preceding local record as an SFX stub.
    const prefixLength = complete.prefixSize ?? ("prefix" in complete ? complete.prefix!.length : 0);
    for (let offset = 0; offset + 30 <= prefixLength; offset++) {
      charge(1);
      if (offset % 4096 === 0) await yieldTurn(signal);
      if ((await view.getUint32(offset, true)) !== 0x04034b50) continue;
      const payload = offset + 30 + (await view.getUint16(offset + 26, true)) + (await view.getUint16(offset + 28, true));
      if ((await view.getUint16(offset + 26, true)) && payload <= prefixLength) { if ("close" in complete) await complete.close(); complete = undefined; break; }
    }
  }
  if (complete) return await recoverCentral(complete);
  } catch (error) { if (complete && "close" in complete) await complete.close(); throw error; }
  // -F uses existing central metadata. It never invents attributes or guesses
  // missing members. A synthetic EOCD must pass the complete strict reader.
  {
    let firstLocal = -1;
    for (let start = 0; start + 46 <= bytes.length; start++) {
      charge(1);
      if (start % 4096 === 0) await yieldTurn(signal);
      if (start + 30 <= bytes.length && (await view.getUint32(start, true)) === 0x04034b50) {
        if (firstLocal < 0) firstLocal = start;
        const payload = start + 30 + (await view.getUint16(start + 26, true)) + (await view.getUint16(start + 28, true));
        let compressed = (await view.getUint32(start + 18, true));
        if (compressed === 0xffffffff && payload <= bytes.length) {
          try {
            const extra = (await bytes.subarray(start + 30 + (await view.getUint16(start + 26, true)), payload));
            compressed = zip64Fields(zip64Payload(extra), [(await view.getUint32(start + 22, true)), compressed])[1]!;
          } catch { signal.throwIfAborted(); }
        }
        const end = payload + compressed;
        if (compressed !== 0xffffffff && compressed && end <= bytes.length) { start = end - 1; continue; }
      }
      if ((await view.getUint32(start, true)) !== 0x02014b50) continue;
      let end = start, members = 0, minimumLocal = Infinity;
      while (end + 46 <= bytes.length && (await view.getUint32(end, true)) === 0x02014b50) {
        charge(46);
        if (++members > limits.maxMembers) fail("ZIP recovery member limit exceeded");
        const next = end + 46 + (await view.getUint16(end + 28, true)) + (await view.getUint16(end + 30, true)) + (await view.getUint16(end + 32, true));
        if (next > bytes.length) break;
        try {
          const extra = end + 46 + (await view.getUint16(end + 28, true));
          const values = zip64Fields(zip64Payload((await bytes.subarray(extra, extra + (await view.getUint16(end + 30, true))))), [(await view.getUint32(end + 24, true)), (await view.getUint32(end + 20, true)), (await view.getUint32(end + 42, true))]);
          minimumLocal = Math.min(minimumLocal, values[2]!);
        } catch { signal.throwIfAborted(); }
        end = next;
      }
      const displacement = firstLocal >= 0 && minimumLocal !== Infinity ? Math.max(0, firstLocal - minimumLocal) : 0;
      const tail = zipEnd(members, end - start, start - displacement, new Uint8Array());
      admitCandidate(end + tail.length);
      const candidate = joinZipSources([bytes.slice(0, end), tail]);
      let archive: ZipArchive | ZipIndexedArchive;
      try { archive = await read(candidate, true); }
      catch (error) { signal.throwIfAborted(); if (factory && !(error instanceof PublicDiagnostic)) throw error; continue; }
      if (firstLocal >= 0 && (archive.prefixSize ?? ("prefix" in archive ? archive.prefix?.length : 0) ?? 0) !== firstLocal) { if ("close" in archive) await archive.close(); continue; }
      return recoverCentral(archive);
    }
    if (mode === "F") throw new ZipFailure(3, "Zip file structure invalid", "central directory could not be verified; try -FF with a separate --out file");
  }
  const entries: ZipEntry[] = [];
  const names = factory ? new ZipMetadataMap<boolean>(factory, signal) : new Set<string>();
  const retained = factory ? new ZipBackedEntries(source, factory, signal, bytes.chunkSize) : undefined;
  let count = 0;
  let partial = false, total = 0;
  try {
  for (let start = 0; start + 4 <= bytes.length; start++) {
    charge(1);
    if (start % 4096 === 0) await yieldTurn(signal);
    if ((await view.getUint32(start, true)) !== 0x04034b50) continue;
    if (start + 30 > bytes.length) { partial = true; break; }
    const flags = (await view.getUint16(start + 6, true));
    const nameLength = (await view.getUint16(start + 26, true)), extraLength = (await view.getUint16(start + 28, true));
    const payload = start + 30 + nameLength + extraLength;
    if (payload > bytes.length || nameLength > limits.maxPathBytes || extraLength > limits.maxPaxBytes) { partial = true; break; }
    const rawCompressed = (await view.getUint32(start + 18, true)), rawSize = (await view.getUint32(start + 22, true));
    const checksum = (await view.getUint32(start + 14, true));
    const wide = rawCompressed === 0xffffffff || rawSize === 0xffffffff;
    const localExtra = (await bytes.subarray(start + 30 + nameLength, payload));
    let compressed = rawCompressed, size = rawSize;
    let centralExtra: Uint8Array;
    try {
      [size, compressed] = zip64Fields(zip64Payload(localExtra), [rawSize, rawCompressed]) as [number, number];
      centralExtra = stripZip64(localExtra);
      // Local UT fields may contain access/creation times; central UT contains
      // only mtime. Retain opaque fields and the existing name codecs.
      const fields: Uint8Array[] = [];
      const centralView = new DataView(centralExtra.buffer);
      for (let offset = 0; offset < centralExtra.length;) {
        const next = offset + 4 + centralView.getUint16(offset + 2, true);
        if (centralView.getUint16(offset, true) === 0x5455 && next - offset >= 5) {
          const mtime = centralExtra[offset + 4]! & 1;
          const stamp = new Uint8Array(centralExtra.subarray(offset, offset + (mtime ? 9 : 5)));
          new DataView(stamp.buffer).setUint16(2, mtime ? 5 : 1, true); stamp[4] = mtime;
          fields.push(stamp);
        } else fields.push(centralExtra.subarray(offset, next));
        offset = next;
      }
      centralExtra = new Uint8Array(concatBytes(fields));
    } catch {
      signal.throwIfAborted();
      partial = true;
      // A non-descriptor classic header still bounds the rejected record.
      // Skip its entire payload, including apparent embedded members. ZIP64
      // and descriptor records need verified metadata to establish that end.
      if (!(flags & 8) && !wide && payload + rawCompressed <= bytes.length) {
        start = payload + rawCompressed - 1;
        continue;
      }
      break;
    }
    const attempt = async (end: number, compressedSize: number, expanded: number, crc: number): Promise<ZipEntry | undefined> => {
      if (expanded > limits.maxTotalBytes - total) throw new ZipFailure(4, "Out of memory", "ZIP recovery total byte limit exceeded");
      if (expanded > limits.maxEntryBytes || compressedSize > limits.maxArchiveBytes || expanded >= 0xffffffff) return undefined;
      const localLength = end - start, centralLength = 46 + nameLength + centralExtra.length;
      const tail = zipEnd(1, centralLength, localLength, new Uint8Array());
      admitCandidate(localLength + centralLength + tail.length);
      const metadata = new Uint8Array(centralLength + tail.length);
      const central = new DataView(metadata.buffer, 0, centralLength);
      central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true);
      metadata.set((await bytes.subarray(start + 4, start + 14)), 6);
      central.setUint32(16, crc, true); central.setUint32(20, compressedSize, true); central.setUint32(24, expanded, true);
      central.setUint16(28, nameLength, true); central.setUint16(30, centralExtra.length, true);
      metadata.set((await bytes.subarray(start + 30, start + 30 + nameLength)), 46);
      metadata.set(centralExtra, 46 + nameLength); metadata.set(tail, centralLength);
      const candidate = joinZipSources([bytes.slice(start, end), metadata]);
      try {
        const archive = await read(candidate);
        try {
          await verify(archive);
          const entry = "get" in archive.entries ? await archive.entries.get(0) : archive.entries[0]!;
          if (entry.compressedOffset !== undefined) entry.compressedOffset += start;
          return entry;
        } finally { if ("close" in archive) await archive.close(); }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ZipFailure || factory && !(error instanceof PublicDiagnostic)) throw error;
        return undefined;
      }
    };
    let end = payload + compressed, entry: ZipEntry | undefined;
    if (flags & 8) {
      const length = wide ? 20 : 12;
      let matches = 0;
      for (let offset = payload; offset + length <= bytes.length; offset++) {
        charge(1);
        if ((offset - payload) % 4096 === 0) await yieldTurn(signal);
        const signed = (await view.getUint32(offset, true)) === 0x08074b50;
        const base = offset + (signed ? 4 : 0), next = base + length;
        if (next > bytes.length) continue;
        const packed = wide ? (await view.getBigUint64(base + 4, true)) : BigInt((await view.getUint32(base + 4, true)));
        const expanded = wide ? (await view.getBigUint64(base + 12, true)) : BigInt((await view.getUint32(base + 8, true)));
        if (packed !== BigInt(offset - payload) || Number.isFinite(limits.maxEntryBytes) && expanded > BigInt(limits.maxEntryBytes)) continue;
        if (compressed && packed !== BigInt(compressed) || size && expanded !== BigInt(size) || checksum && checksum !== (await view.getUint32(base, true))) continue;
        // An unknown-size descriptor needs a record boundary, not arbitrary
        // matching integers embedded in a payload.
        if (next !== bytes.length && (next + 4 > bytes.length || ![0x04034b50, 0x02014b50, 0x06054b50, 0x06064b50].includes((await view.getUint32(next, true))))) continue;
        const candidateEntry = await attempt(next, Number(packed), Number(expanded), (await view.getUint32(base, true)));
        if (!candidateEntry) continue;
        entry = candidateEntry; end = next;
        if (++matches > 1) { partial = true; entry = undefined; break; }
        if (compressed) break;
      }
      // No safe end is known: do not scan that payload for apparent members.
      if (!entry) { partial = true; if (matches > 1) { start = end - 1; continue; } break; }
    } else {
      if (end > bytes.length) { partial = true; break; }
      entry = await attempt(end, compressed, size, checksum);
    }
    start = end - 1;
    if (!entry || await names.has(entry.name)) { partial = true; continue; }
    if (entry.size > limits.maxTotalBytes - total) fail("ZIP recovery total byte limit exceeded");
    if (names instanceof Set) names.add(entry.name); else await names.set(entry.name, true);
    total += entry.size; count++;
    if (retained) await retained.append(entry); else entries.push(entry);
  }
  if (!count) throw new ZipFailure(3, "Zip file structure invalid", "no verified members recovered");
  return { archive: retained ? retained.archive() : { entries, comment: new Uint8Array() }, partial };
  } catch (error) { await retained?.close(); throw error; }
  finally { if (!(names instanceof Set)) await names.close(); }
}

/** Adjust a validated SFX using owned bytes; prefix bytes are inert. */
export async function adjustZipSfx(bytes: Uint8Array, archive: ZipArchive, limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array): Promise<Uint8Array> {
  const adjusted = await adjustZipRanges({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, archive, limits, signal, password);
  return new ZipRanges(adjusted, signal, Math.min(limits.chunkSize, 65536)).subarray(0);
}

export async function adjustZipRanges(source: ZipReadSource, archive: ZipArchive | ZipIndexedArchive, limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array, factory?: ZipMetadataFactory): Promise<ZipPatchedSource> {
  const bytes = new ZipRanges(source, signal, Math.min(limits.chunkSize, 65536));
  const prefix = archive.prefixSize ?? ("prefix" in archive ? archive.prefix?.length : 0) ?? 0;
  const view = bytes;
  const end = bytes.length - 22 - archive.comment.length;
  let centralEnd = end, central = end - (await view.getUint32(end + 12, true));
  let displacement = central - (await view.getUint32(end + 16, true));
  const wide = end >= 20 && (await view.getUint32(end - 20, true)) === 0x07064b50;
  if (wide) {
    const declared = Number((await view.getBigUint64(end - 12, true)));
    centralEnd = declared;
    if (declared + 12 > end - 20 || (await view.getUint32(declared, true)) !== 0x06064b50) centralEnd += prefix;
    displacement = centralEnd - declared;
    central = Number((await view.getBigUint64(centralEnd + 48, true))) + displacement;
  }
  if (displacement !== 0 && displacement !== prefix) fail("ZIP inconsistent SFX offsets");
  for await (const entry of archive.entries) for await (const chunk of decodeZipEntry(entry, limits, signal, password, source => source)) { void chunk; }
  const patches: { offset: number; bytes: Uint8Array }[] = [];
  const retained = factory ? await createZipPatchWriter(factory, signal) : undefined;
  const output = retained ?? {
    setUint32(offset: number, value: number, little: boolean) {
      const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, little); patches.push({ offset, bytes });
    },
    setBigUint64(offset: number, value: bigint, little: boolean) {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, value, little); patches.push({ offset, bytes });
    },
  };
  try {
  for (let offset = central; offset < centralEnd;) {
    await yieldTurn(signal);
    const local = (await view.getUint32(offset + 42, true));
    if (local === 0xffffffff) {
      const extraStart = offset + 46 + (await view.getUint16(offset + 28, true));
      const extraEnd = extraStart + (await view.getUint16(offset + 30, true));
      for (let extra = extraStart; extra < extraEnd; extra += 4 + (await view.getUint16(extra + 2, true))) {
        if ((await view.getUint16(extra, true)) !== 1) continue;
        const position = extra + 4 + ((await view.getUint32(offset + 24, true)) === 0xffffffff ? 8 : 0) + ((await view.getUint32(offset + 20, true)) === 0xffffffff ? 8 : 0);
        const adjusted = (await view.getBigUint64(position, true)) + BigInt(displacement);
        if (adjusted > BigInt(Number.MAX_SAFE_INTEGER)) fail("ZIP64 unsafe adjusted offset");
        await output.setBigUint64(position, adjusted, true);
      }
    } else {
      if (local + displacement >= 0xffffffff) fail("ZIP SFX adjusted offset requires ZIP64 promotion");
      await output.setUint32(offset + 42, local + displacement, true);
    }
    offset += 46 + (await view.getUint16(offset + 28, true)) + (await view.getUint16(offset + 30, true)) + (await view.getUint16(offset + 32, true));
  }
  if (wide) {
    await output.setBigUint64(centralEnd + 48, BigInt(central), true);
    await output.setBigUint64(end - 12, BigInt(centralEnd), true);
  }
  if ((await view.getUint32(end + 16, true)) !== 0xffffffff) {
    if (central >= 0xffffffff) fail("ZIP SFX adjusted directory requires ZIP64 promotion");
    await output.setUint32(end + 16, central, true);
  }
  const result = retained ? await retained.finish(source) : { ...patchZipSource(source, patches), async close() {} };
  if (factory) {
    const checked = await readZipIndexedArchive(result, limits, signal, factory, { prefix: true });
    await checked.close();
  } else await readZipArchive(result, limits, signal, { prefix: true });
  return result;
  } catch (error) { await retained?.close(); throw error; }
}
