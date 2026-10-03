import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { ownedRangeSource } from "@poe-code/spreadsheet-engine/range-input";
import { Binary, invalidBiff, isCfb, type BiffRecord } from "./biff-binary.js";
import { CfbBackendFailure, readCfbRanges } from "./cfb-range.js";

const workbookStreams = ["Workbook", "WORKBOOK", "workbook", "Book", "BOOK", "book"];

/** Keep the explicit buffered BIFF API separate from retained file ingestion. */
export async function readBiffRange(input: RangeSource, context: CapabilityContext, probe = false): Promise<{
  found: boolean; streamSize: number; records: BiffRecord[]; streams?: ReadonlyMap<string, Uint8Array>;
}> {
  let closed = false, container: Awaited<ReturnType<typeof readCfbRanges>> | undefined;
  const cleanup = async () => {
    closed = true;
    try { await container?.close(); } catch (error) { if (error instanceof CfbBackendFailure) throw error.cause; throw error; }
  };
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "BIFF reader is closed"); };
  context.own(cleanup); check();
  const size = input.size, read = input.read.bind(input);
  if (!Number.isSafeInteger(size) || size < 0) invalidBiff("invalid source size");
  if (size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const source = ownedRangeSource({ size, async read(position, count, options) {
    try { return await read(position, count, options); } catch (error) { throw new CfbBackendFailure(error); }
  } }, context.signal, check, context.own);
  async function exact(source: RangeSource, position: number, count: number): Promise<Uint8Array> {
    check();
    if (position > source.size - count) invalidBiff("truncated binary data");
    const bytes = new Uint8Array(count);
    for (let offset = 0; offset < count;) {
      const chunk = await source.read(position + offset, Math.min(16384, count - offset)); check();
      if (!chunk.length || chunk.length > count - offset) invalidBiff("truncated binary data");
      bytes.set(chunk, offset); offset += chunk.length;
    }
    return bytes;
  }
  try {
    const head = await exact(source, 0, Math.min(8, size));
    let workbook: RangeSource | undefined = source, streams: Map<string, Uint8Array> | undefined;
    if (isCfb(head)) {
      container = await readCfbRanges(source, context); check();
      workbook = workbookStreams.map(name => container!.streams.get(name)).find(value => value !== undefined);
    }
    if (probe) return { found: container ? workbook !== undefined : head[0] === 9 && (head[1]! & 0xf1) === 0, streamSize: 0, records: [] };
    if (!workbook) throw new SsconvertError("io", "E No Workbook or Book streams found.");
    const records: BiffRecord[] = [];
    for (let offset = 0; offset < workbook.size;) {
      const header = new Binary(await exact(workbook, offset, 4)), opcode = header.u16(0), length = header.u16(2);
      if (!opcode && !length) {
        let zero = true;
        for (let at = offset; at < workbook.size;) {
          const bytes = await exact(workbook, at, Math.min(16384, workbook.size - at));
          if (bytes.some(byte => byte !== 0)) { zero = false; break; }
          at += bytes.length;
        }
        if (zero) break;
      }
      if (records.length >= (context.limits.workbookNodes ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert BIFF record limit exceeded");
      records.push({ opcode, offset, data: new Binary(await exact(workbook, offset + 4, length)) });
      offset += length + 4;
    }
    if (container) {
      streams = new Map();
      for (const [name, stream] of container.streams) {
        // Only these ancillary payloads are interpreted by the existing reader.
        // Keep other names for its name/work admission, without copying ignored streams.
        const needed = ["ENCRYPTION", "\u0005SUMMARYINFORMATION", "\u0005DOCUMENTSUMMARYINFORMATION"].includes(name.toUpperCase());
        streams.set(name, needed ? await exact(stream, 0, stream.size) : new Uint8Array());
      }
    }
    return { found: true, streamSize: workbook.size, records, ...(streams ? { streams } : {}) };
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof CfbBackendFailure) throw error.cause;
    if (probe && error instanceof SsconvertError && error.code === "io") return { found: false, streamSize: 0, records: [] };
    throw error;
  } finally { await cleanup(); }
}
