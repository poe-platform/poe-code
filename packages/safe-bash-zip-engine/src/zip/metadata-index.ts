import type { ZipReadSource } from "./ranges.js";
import type { ZipMetadataFactory, ZipMetadataSpool } from "./metadata-types.js";
import { fail } from "safe-bash-io-engine/commands/archive/internal";
import { yieldTurn } from "safe-bash-contracts/yield";

export interface ZipSpanRecord { central: number; start: number; end: number }
const recordBytes = 24;
export function encodeZipSpan(record: ZipSpanRecord, bytes: Uint8Array = new Uint8Array(recordBytes), offset = 0): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, recordBytes);
  for (const [index, value] of [record.central, record.start, record.end].entries()) view.setBigUint64(index * 8, BigInt(value), true);
  return bytes;
}
function decode(bytes: Uint8Array, offset: number): ZipSpanRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, recordBytes);
  const fields = [0, 8, 16].map(offset => {
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("ZIP unsafe metadata index");
    return Number(value);
  });
  return { central: fields[0]!, start: fields[1]!, end: fields[2]! };
}
async function exact(source: ZipReadSource, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    signal.throwIfAborted();
    const bytes = await source.read(offset + read, length - read);
    if (!bytes.length || bytes.length > length - read) fail("ZIP truncated metadata index");
    result.set(bytes, read); read += bytes.length;
  }
  return result;
}
export async function readZipSpan(source: ZipReadSource, index: number, signal: AbortSignal): Promise<ZipSpanRecord> {
  return decode(await exact(source, index * recordBytes, recordBytes, signal), 0);
}

/** External merge sort keeps two input windows and one output window regardless of member count. */
export async function validateZipSpans(index: ZipReadSource, count: number, factory: ZipMetadataFactory, signal: AbortSignal, chunkSize: number, initial: number | undefined, centralStart: number): Promise<number> {
  if (!count) {
    const start = initial ?? centralStart;
    if (start !== centralStart) fail("ZIP unreferenced local data is unsupported");
    return start;
  }
  const windowRecords = Math.max(1, Math.floor(Math.min(chunkSize, 65536) / recordBytes));
  let current: ZipMetadataSpool | undefined, pending: ZipMetadataSpool | undefined;
  try {
    pending = await factory();
    for (let start = 0; start < count; start += windowRecords) {
      await yieldTurn(signal);
      const size = Math.min(windowRecords, count - start);
      const bytes = await exact(index, start * recordBytes, size * recordBytes, signal);
      const records = Array.from({ length: size }, (_, offset) => decode(bytes, offset * recordBytes));
      records.sort((a, b) => a.start - b.start);
      records.forEach((record, offset) => encodeZipSpan(record, bytes, offset * recordBytes));
      await pending.append(bytes);
    }
    let source = await pending.finish();
    current = pending; pending = undefined;
    const cursor = (source: ZipReadSource, start: number, end: number) => {
      let position = start, offset = 0, bytes: Uint8Array = new Uint8Array();
      return { async next(): Promise<ZipSpanRecord | undefined> {
        if (position >= end) return undefined;
        if (offset === bytes.length) {
          bytes = await exact(source, position * recordBytes, Math.min(windowRecords, end - position) * recordBytes, signal);
          offset = 0;
        }
        const record = decode(bytes, offset); offset += recordBytes; position++;
        return record;
      } };
    };
    for (let width = windowRecords; width < count; width *= 2) {
      pending = await factory();
      const output = new Uint8Array(windowRecords * recordBytes);
      let used = 0;
      for (let start = 0; start < count; start += width * 2) {
        await yieldTurn(signal);
        const first = cursor(source, start, Math.min(start + width, count));
        const second = cursor(source, Math.min(start + width, count), Math.min(start + width * 2, count));
        let a = await first.next(), b = await second.next();
        while (a || b) {
          signal.throwIfAborted();
          const takeFirst = a !== undefined && (b === undefined || a.start <= b.start);
          encodeZipSpan((takeFirst ? a : b)!, output, used); used += recordBytes;
          if (used === output.length) { await pending.append(output); used = 0; }
          if (takeFirst) a = await first.next(); else b = await second.next();
        }
      }
      if (used) await pending.append(output.subarray(0, used));
      source = await pending.finish();
      await current.close(); current = pending; pending = undefined;
    }
    const sorted = cursor(source, 0, count);
    let record = await sorted.next();
    const prefix = initial ?? record!.start;
    let covered = prefix;
    while (record) {
      signal.throwIfAborted();
      if (record.start !== covered) fail("ZIP overlapping spans, gaps or self-extracting prefix are unsupported");
      covered = record.end; record = await sorted.next();
    }
    if (covered !== centralStart) fail("ZIP unreferenced local data is unsupported");
    return prefix;
  } finally {
    try { await pending?.close(); } finally { await current?.close(); }
  }
}
