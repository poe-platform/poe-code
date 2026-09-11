import { type ByteSource } from "../../contracts/index.js";
import { yieldTurn } from "../../contracts/yield.js";
import { codec, CodecReader } from "../bytes/compression/codec.js";
import { fail, text, type ArchiveLimits } from "./internal.js";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  size: number;
  method: number;
  crc32: number;
  modified: Date;
  mode: number;
  directory: boolean;
  symlink: boolean;
  rawName?: Uint8Array;
  localName?: Uint8Array;
  comment?: Uint8Array;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  flags?: number;
  versionMadeBy?: number;
  internalAttributes?: number;
  externalAttributes?: number;
  dosTime?: number;
  dosDate?: number;
}

export interface ZipArchive {
  entries: readonly ZipEntry[];
  comment: Uint8Array;
}

const encoder = new TextEncoder();
const cp437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function crc32(bytes: Uint8Array, previous = 0): number {
  let value = previous ^ 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return (value ^ 0xffffffff) >>> 0;
}

function number(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`ZIP ${label} limit exceeded or invalid value`);
}

function admit(limits: ArchiveLimits, signal: AbortSignal): number {
  signal.throwIfAborted();
  for (const key of ["maxArchiveBytes", "maxEntryBytes", "maxTotalBytes", "maxMembers", "maxPathBytes", "maxDepth", "maxPaxBytes", "maxTextBytes", "chunkSize"] as const) {
    number(limits[key], Number.MAX_SAFE_INTEGER, key);
  }
  if (limits.chunkSize < 512 || limits.chunkSize > 1024 * 1024) fail("ZIP chunk size must be between 512 and 1048576");
  return Math.min(limits.chunkSize, 64 * 1024);
}

function pathBytes(name: string, limits: ArchiveLimits): Uint8Array {
  if (name.length > Math.min(limits.maxPathBytes, 65535)) fail("ZIP path byte limit exceeded");
  const bytes = encoder.encode(name);
  if (!name || text(bytes) !== name || name.includes("\0")) fail("ZIP invalid or unsafe path");
  number(bytes.length, Math.min(limits.maxPathBytes, 65535), "path byte");
  const parts = name.split("/");
  if (parts.at(-1) === "") parts.pop();
  if (parts.some(part => !part || part === "." || part === "..")) fail("ZIP unsafe traversal or absolute path");
  number(parts.length, limits.maxDepth, "path depth");
  return bytes;
}

function equal(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

function legacyName(bytes: Uint8Array): string {
  let name = "";
  for (const byte of bytes) name += byte < 128 ? String.fromCharCode(byte) : cp437[byte - 128];
  return name;
}

interface ExtraMetadata { name?: string; modified?: number }

function extras(bytes: Uint8Array, rawName: Uint8Array, comment: Uint8Array, central: boolean, limits: ArchiveLimits): ExtraMetadata {
  number(bytes.length, Math.min(limits.maxPaxBytes, 65535), "extra field");
  const result: ExtraMetadata = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seen = new Set<number>();
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) fail("ZIP truncated extra field");
    const identifier = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + length > bytes.length) fail("ZIP truncated extra field payload");
    if (seen.has(identifier)) fail("ZIP duplicate extra field");
    seen.add(identifier);
    if (identifier === 1) fail("ZIP64 is unsupported");
    if (identifier === 0x9901 || identifier === 0x0017 || identifier === 0x0018 || identifier === 0x0019) fail("ZIP encryption is unsupported");
    if (identifier === 0x7075 || identifier === 0x6375) {
      if (length < 5 || bytes[offset] !== 1) fail("ZIP unsupported or truncated Unicode extra field");
      const original = identifier === 0x7075 ? rawName : comment;
      if (view.getUint32(offset + 1, true) !== crc32(original)) fail("ZIP Unicode extra field CRC mismatch");
      const decoded = text(bytes.subarray(offset + 5, offset + length));
      if (identifier === 0x7075) { pathBytes(decoded, limits); result.name = decoded; }
      else number(length - 5, limits.maxTextBytes, "Unicode comment");
    }
    if (identifier === 0x5455) {
      if (!length) fail("ZIP truncated timestamp extra field");
      const flags = bytes[offset]!;
      if (flags & ~7) fail("ZIP unsupported timestamp flags");
      const count = (flags & 1) + (central ? 0 : ((flags >>> 1) & 1) + ((flags >>> 2) & 1));
      if (length !== 1 + count * 4) fail("ZIP truncated or inconsistent timestamp extra field");
      if (flags & 1) result.modified = view.getInt32(offset + 1, true) * 1000;
    }
    offset += length;
  }
  return result;
}

function nameFrom(rawName: Uint8Array, flags: number, metadata: ExtraMetadata, limits: ArchiveLimits): string {
  number(rawName.length, Math.min(limits.maxPathBytes, 65535), "raw path byte");
  const raw = flags & 0x800 ? text(rawName) : legacyName(rawName);
  pathBytes(raw, limits);
  if (flags & 0x800 && metadata.name !== undefined && metadata.name !== raw) fail("ZIP conflicting UTF-8 and Unicode extra names");
  return metadata.name ?? raw;
}

function format(method: number, flags: number, version: number): void {
  number(flags, 65535, "general purpose flags");
  if (flags & (1 | 64 | 0x2000)) fail("ZIP encryption is unsupported");
  if (flags & ~0x80e || method === 0 && flags & 6) fail("ZIP unsupported general purpose flags");
  if (method !== 0 && method !== 8) fail("ZIP unsupported compression method");
  if (version < (method === 8 || flags & 8 ? 20 : 10) || version > 20) fail("ZIP unsupported extraction version (including ZIP64)");
}

function dosModified(date: number, time: number): Date {
  if (!date && !time) return new Date(1980, 0, 1);
  const year = 1980 + (date >>> 9);
  const month = ((date >>> 5) & 15) - 1;
  const day = date & 31;
  const hours = time >>> 11;
  const minutes = (time >>> 5) & 63;
  const seconds = (time & 31) * 2;
  const result = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month || result.getUTCDate() !== day || hours > 23 || minutes > 59 || seconds > 59) fail("ZIP invalid DOS timestamp");
  return new Date(year, month, day, hours, minutes, seconds);
}

function entryBounds(entry: ZipEntry, limits: ArchiveLimits): void {
  pathBytes(entry.name, limits);
  number(entry.size, Math.min(limits.maxEntryBytes, limits.maxTotalBytes, 0xfffffffe), "entry byte");
  number(entry.data.length, Math.min(limits.maxArchiveBytes, 0xfffffffe), "compressed byte");
  number(entry.crc32, 0xffffffff, "CRC32");
  number(entry.mode, 0xffff, "mode");
  format(entry.method, entry.flags ?? 0x800, entry.method === 8 || (entry.flags ?? 0) & 8 ? 20 : 10);
  if (entry.directory !== entry.name.endsWith("/") || entry.directory && (entry.symlink || entry.size !== 0)) fail("ZIP inconsistent directory metadata");
  const type = entry.mode & 0o170000;
  if (type !== 0 && type !== (entry.directory ? 0o040000 : entry.symlink ? 0o120000 : 0o100000)) fail("ZIP unsupported or conflicting file type");
  if (!Number.isFinite(entry.modified.getTime())) fail("ZIP invalid modification time");
}

async function copyBytes(source: Uint8Array, destination: Uint8Array, start: number, chunkSize: number, signal: AbortSignal): Promise<void> {
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    signal.throwIfAborted();
    destination.set(source.subarray(offset, offset + chunkSize), start + offset);
    if (offset + chunkSize < source.length) await yieldTurn(signal);
  }
}

export async function readZipArchive(bytes: Uint8Array, limits: ArchiveLimits, signal: AbortSignal): Promise<ZipArchive> {
  const chunkSize = admit(limits, signal);
  number(bytes.length, Math.min(limits.maxArchiveBytes, 0xfffffffe), "archive byte");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  const lower = Math.max(0, bytes.length - 22 - 65535);
  for (let offset = bytes.length - 22; offset >= lower; offset--) {
    if ((bytes.length - offset) % 4096 === 0) await yieldTurn(signal);
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      const size = view.getUint32(offset + 12, true);
      const start = view.getUint32(offset + 16, true);
      const zip64 = size === 0xffffffff || start === 0xffffffff || view.getUint16(offset + 10, true) === 65535 || offset >= 20 && view.getUint32(offset - 20, true) === 0x07064b50;
      if (!zip64 && start + size !== offset) continue;
      if (end !== -1) fail("ZIP ambiguous end records");
      end = offset;
    }
  }
  if (end === -1) fail("ZIP truncated or missing end of central directory");
  const members = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (members === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) fail("ZIP64 is unsupported");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== members) fail("ZIP multi-disk or inconsistent member count is unsupported");
  if (centralStart + centralSize !== end) fail("ZIP invalid central directory span or unsupported ZIP64/trailing records");
  number(members, limits.maxMembers, "member");
  number(bytes.length - end - 22, limits.maxTextBytes, "archive comment");
  const entries: ZipEntry[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  let offset = centralStart;
  let total = 0;
  for (let index = 0; index < members; index++) {
    await yieldTurn(signal);
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail("ZIP truncated or invalid central header");
    const versionMadeBy = view.getUint16(offset + 4, true);
    const version = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    format(method, flags, version);
    const dosTime = view.getUint16(offset + 12, true);
    const dosDate = view.getUint16(offset + 14, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const internalAttributes = view.getUint16(offset + 36, true);
    if (internalAttributes & ~1) fail("ZIP unsupported internal attributes");
    const externalAttributes = view.getUint32(offset + 38, true);
    const local = view.getUint32(offset + 42, true);
    if (view.getUint16(offset + 34, true)) fail("ZIP multi-disk member is unsupported");
    if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail("ZIP64 is unsupported");
    number(size, limits.maxEntryBytes, "entry byte");
    if (method === 0 && compressedSize !== size) fail("ZIP stored size mismatch");
    total += size;
    number(total, limits.maxTotalBytes, "total byte");
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) fail("ZIP truncated central metadata");
    number(commentLength, limits.maxTextBytes, "entry comment");
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const centralExtra = bytes.subarray(offset + 46 + nameLength, next - commentLength);
    const comment = bytes.subarray(next - commentLength, next);
    if (flags & 0x800) text(comment);
    const centralMetadata = extras(centralExtra, rawName, comment, true, limits);
    const name = nameFrom(rawName, flags, centralMetadata, limits);
    if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50) fail("ZIP invalid local header span");
    if (view.getUint16(local + 4, true) !== version || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || view.getUint16(local + 10, true) !== dosTime || view.getUint16(local + 12, true) !== dosDate) fail("ZIP central/local metadata mismatch");
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const payloadStart = local + 30 + localNameLength + localExtraLength;
    let payloadEnd = payloadStart + compressedSize;
    if (payloadEnd > centralStart) fail("ZIP truncated or overlapping local payload");
    const localName = bytes.subarray(local + 30, local + 30 + localNameLength);
    if (!equal(rawName, localName)) fail("ZIP central/local filename mismatch");
    const localExtra = bytes.subarray(local + 30 + localNameLength, payloadStart);
    const localMetadata = extras(localExtra, localName, comment, false, limits);
    const localEffective = nameFrom(localName, flags, localMetadata, limits);
    if (localMetadata.name !== undefined && localEffective !== name) fail("ZIP central/local Unicode name mismatch");
    if (centralMetadata.modified !== undefined && localMetadata.modified !== undefined && centralMetadata.modified !== localMetadata.modified) fail("ZIP central/local timestamp mismatch");
    for (const [position, expected] of [[14, checksum], [18, compressedSize], [22, size]] as const) {
      const actual = view.getUint32(local + position, true);
      if (actual !== expected && (!(flags & 8) || actual !== 0)) fail("ZIP central/local size or CRC mismatch");
    }
    if (flags & 8) {
      const matches: number[] = [];
      for (const signed of [false, true]) {
        const descriptor = payloadEnd + (signed ? 4 : 0);
        if (descriptor + 12 <= centralStart && (!signed || view.getUint32(payloadEnd, true) === 0x08074b50) && view.getUint32(descriptor, true) === checksum && view.getUint32(descriptor + 4, true) === compressedSize && view.getUint32(descriptor + 8, true) === size) matches.push(descriptor + 12);
      }
      if (matches.length !== 1) fail("ZIP truncated, ambiguous or mismatched data descriptor");
      payloadEnd = matches[0]!;
    }
    const host = versionMadeBy >>> 8;
    const unixMode = host === 3 || host === 19 ? externalAttributes >>> 16 : 0;
    const directory = name.endsWith("/");
    if (Boolean(externalAttributes & 16) && !directory) fail("ZIP conflicting directory attributes");
    const mode = unixMode || (directory ? 0o040755 : 0o100644);
    const symlink = (mode & 0o170000) === 0o120000;
    const modified = dosModified(dosDate, dosTime);
    const timestamp = centralMetadata.modified ?? localMetadata.modified;
    if (timestamp !== undefined) modified.setTime(timestamp);
    const entry: ZipEntry = { name, data: bytes.subarray(payloadStart, payloadStart + compressedSize), size, method, crc32: checksum, modified, mode, directory, symlink, rawName, localName, comment, localExtra, centralExtra, flags, versionMadeBy, internalAttributes, externalAttributes, dosTime, dosDate };
    entryBounds(entry, limits);
    entries.push(entry);
    spans.push({ start: local, end: payloadEnd });
    offset = next;
  }
  if (offset !== end) fail("ZIP central directory size or member count mismatch");
  spans.sort((first, second) => first.start - second.start);
  let covered = 0;
  for (const span of spans) {
    if (span.start !== covered) fail("ZIP overlapping spans, gaps or self-extracting prefix are unsupported");
    covered = span.end;
  }
  if (covered !== centralStart) fail("ZIP unreferenced local data is unsupported");
  for (const entry of entries) {
    const data = new Uint8Array(entry.data.length);
    await copyBytes(entry.data, data, 0, chunkSize, signal);
    entry.data = data;
    entry.rawName = new Uint8Array(entry.rawName!);
    entry.localName = new Uint8Array(entry.localName!);
    entry.comment = new Uint8Array(entry.comment!);
    entry.localExtra = new Uint8Array(entry.localExtra!);
    entry.centralExtra = new Uint8Array(entry.centralExtra!);
    await yieldTurn(signal);
  }
  return { entries, comment: new Uint8Array(bytes.subarray(end + 22)) };
}

export async function* decodeZipEntry(entry: ZipEntry, limits: ArchiveLimits, signal: AbortSignal): ByteSource {
  const chunkSize = admit(limits, signal);
  entryBounds(entry, limits);
  const reader = new CodecReader((async function* () { yield entry.data; })(), signal);
  let length = 0;
  let checksum = 0;
  const source = entry.method === 8 ? codec(reader, { mode: "inflate-raw", chunkSize }, signal) : (async function* () {
    for (let offset = 0; offset < entry.data.length; offset += chunkSize) {
      yield new Uint8Array(entry.data.subarray(offset, offset + chunkSize));
      await yieldTurn(signal);
    }
  })();
  try {
    for await (const chunk of source) {
      signal.throwIfAborted();
      length += chunk.length;
      number(length, Math.min(limits.maxEntryBytes, limits.maxTotalBytes), "decoded byte");
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    if (entry.method === 8 && await reader.chunk() !== undefined) fail("ZIP trailing compressed data");
    if (length !== entry.size) fail("ZIP uncompressed size mismatch");
    if (checksum !== entry.crc32) fail("ZIP CRC32 mismatch");
  } finally { await reader.close(); }
}

export async function makeZipEntry(name: string, bytes: Uint8Array, attributes: { modified: Date; mode: number; directory: boolean; symlink: boolean }, limits: ArchiveLimits, signal: AbortSignal): Promise<ZipEntry> {
  const chunkSize = admit(limits, signal);
  const entry: ZipEntry = { name, data: bytes, size: bytes.length, method: 0, crc32: 0, ...attributes, modified: new Date(attributes.modified.getTime()) };
  entryBounds(entry, limits);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    entry.crc32 = crc32(bytes.subarray(offset, offset + chunkSize), entry.crc32);
    await yieldTurn(signal);
  }
  const reader = new CodecReader((async function* () { yield bytes; })(), signal);
  try {
    if (bytes.length && !entry.directory && !entry.symlink) {
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of codec(reader, { mode: "deflate-raw", chunkSize }, signal)) {
        length += chunk.length;
        if (length >= bytes.length) break;
        chunks.push(new Uint8Array(chunk));
      }
      if (length < bytes.length) {
        entry.data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          entry.data.set(chunk, offset);
          offset += chunk.length;
          await yieldTurn(signal);
        }
        entry.method = 8;
        return entry;
      }
    }
    entry.data = new Uint8Array(bytes.length);
    await copyBytes(bytes, entry.data, 0, chunkSize, signal);
    return entry;
  } finally { await reader.close(); }
}

function timestampExtra(modified: Date): Uint8Array {
  const seconds = Math.floor(modified.getTime() / 1000);
  if (seconds < -0x80000000 || seconds > 0x7fffffff) return new Uint8Array();
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x5455, true);
  view.setUint16(2, 5, true);
  bytes[4] = 1;
  view.setInt32(5, seconds, true);
  return bytes;
}

interface EncodedEntry {
  entry: ZipEntry; rawName: Uint8Array; localExtra: Uint8Array; centralExtra: Uint8Array;
  comment: Uint8Array; flags: number; date: number; time: number; offset: number;
}

export async function writeZipArchive(archive: ZipArchive, limits: ArchiveLimits, signal: AbortSignal): Promise<Uint8Array> {
  const chunkSize = admit(limits, signal);
  number(archive.entries.length, Math.min(limits.maxMembers, 65534), "member");
  number(archive.comment.length, Math.min(limits.maxTextBytes, 65535), "archive comment");
  let length = 22 + archive.comment.length;
  let localLength = 0;
  let total = 0;
  const encoded: EncodedEntry[] = [];
  for (const entry of archive.entries) {
    await yieldTurn(signal);
    entryBounds(entry, limits);
    if (entry.method === 0 && entry.data.length !== entry.size) fail("ZIP stored size mismatch");
    total += entry.size;
    number(total, limits.maxTotalBytes, "total byte");
    const rawName = entry.rawName ?? pathBytes(entry.name, limits);
    const flags = (entry.flags ?? 0x800) & ~8;
    const comment = entry.comment ?? new Uint8Array();
    number(comment.length, Math.min(limits.maxTextBytes, 65535), "entry comment");
    if (flags & 0x800) text(comment);
    const localExtra = entry.localExtra ?? timestampExtra(entry.modified);
    const centralExtra = entry.centralExtra ?? timestampExtra(entry.modified);
    const localMetadata = extras(localExtra, rawName, comment, false, limits);
    const centralMetadata = extras(centralExtra, rawName, comment, true, limits);
    if (nameFrom(rawName, flags, centralMetadata, limits) !== entry.name || localMetadata.name !== undefined && nameFrom(rawName, flags, localMetadata, limits) !== entry.name || entry.localName && !equal(rawName, entry.localName)) fail("ZIP retained filename metadata mismatch");
    if (localMetadata.modified !== undefined && centralMetadata.modified !== undefined && localMetadata.modified !== centralMetadata.modified) fail("ZIP retained timestamp metadata mismatch");
    const rounded = new Date(Math.ceil(Math.floor(entry.modified.getTime() / 1000) / 2) * 2000);
    const year = Math.max(1980, Math.min(2107, rounded.getFullYear()));
    const date = entry.dosDate ?? (((year - 1980) << 9) | ((rounded.getMonth() + 1) << 5) | rounded.getDate());
    const time = entry.dosTime ?? ((rounded.getHours() << 11) | (rounded.getMinutes() << 5) | (rounded.getSeconds() >>> 1));
    number(date, 65535, "DOS date");
    number(time, 65535, "DOS time");
    const dosTimestamp = dosModified(date, time).getTime();
    const extendedTimestamp = centralMetadata.modified ?? localMetadata.modified;
    if (extendedTimestamp === undefined ? dosTimestamp !== rounded.getTime() : Math.floor(extendedTimestamp / 1000) !== Math.floor(entry.modified.getTime() / 1000)) fail("ZIP retained or unrepresentable timestamp metadata mismatch");
    for (const [value, maximum, label] of [[entry.versionMadeBy ?? 0x31e, 65535, "creator version"], [entry.internalAttributes ?? 0, 65535, "internal attributes"], [entry.externalAttributes ?? 0, 0xffffffff, "external attributes"]] as const) number(value, maximum, label);
    if ((entry.internalAttributes ?? 0) & ~1) fail("ZIP unsupported internal attributes");
    if (entry.externalAttributes !== undefined) {
      const host = (entry.versionMadeBy ?? 0x31e) >>> 8;
      const unixMode = host === 3 || host === 19 ? entry.externalAttributes >>> 16 : 0;
      const mode = unixMode || (entry.directory ? 0o040755 : 0o100644);
      if (mode !== entry.mode || Boolean(entry.externalAttributes & 16) && !entry.directory) fail("ZIP retained file attributes mismatch");
    }
    encoded.push({ entry, rawName, flags, localExtra, centralExtra, comment, date, time, offset: localLength });
    localLength += 30 + rawName.length + localExtra.length + entry.data.length;
    length += 76 + 2 * rawName.length + localExtra.length + centralExtra.length + comment.length + entry.data.length;
    number(length, Math.min(limits.maxArchiveBytes, 0xfffffffe), "archive byte");
  }
  number(length, Math.min(limits.maxArchiveBytes, 0xfffffffe), "archive byte");
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  let central = localLength;
  for (const item of encoded) {
    await yieldTurn(signal);
    const { entry, rawName, flags, localExtra, centralExtra, comment, date, time, offset } = item;
    const version = entry.method === 8 ? 20 : 10;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, version, true);
    view.setUint16(offset + 6, flags, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.size, true);
    view.setUint16(offset + 26, rawName.length, true);
    view.setUint16(offset + 28, localExtra.length, true);
    bytes.set(rawName, offset + 30);
    bytes.set(localExtra, offset + 30 + rawName.length);
    await copyBytes(entry.data, bytes, offset + 30 + rawName.length + localExtra.length, chunkSize, signal);
    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, entry.versionMadeBy ?? 0x31e, true);
    view.setUint16(central + 6, version, true);
    view.setUint16(central + 8, flags, true);
    view.setUint16(central + 10, entry.method, true);
    view.setUint16(central + 12, time, true);
    view.setUint16(central + 14, date, true);
    view.setUint32(central + 16, entry.crc32, true);
    view.setUint32(central + 20, entry.data.length, true);
    view.setUint32(central + 24, entry.size, true);
    view.setUint16(central + 28, rawName.length, true);
    view.setUint16(central + 30, centralExtra.length, true);
    view.setUint16(central + 32, comment.length, true);
    view.setUint16(central + 36, entry.internalAttributes ?? 0, true);
    view.setUint32(central + 38, entry.externalAttributes ?? ((entry.mode | (entry.directory ? 0o040000 : entry.symlink ? 0o120000 : 0o100000)) * 65536 + (entry.directory ? 16 : 0)), true);
    view.setUint32(central + 42, offset, true);
    bytes.set(rawName, central + 46);
    bytes.set(centralExtra, central + 46 + rawName.length);
    bytes.set(comment, central + 46 + rawName.length + centralExtra.length);
    central += 46 + rawName.length + centralExtra.length + comment.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, encoded.length, true);
  view.setUint16(central + 10, encoded.length, true);
  view.setUint32(central + 12, central - localLength, true);
  view.setUint32(central + 16, localLength, true);
  view.setUint16(central + 20, archive.comment.length, true);
  bytes.set(archive.comment, central + 22);
  signal.throwIfAborted();
  return bytes;
}
