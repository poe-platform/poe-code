import { createBiffRecordStore, type BiffRecords, type BiffRecordStore } from "./biff-record-storage.js";
import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { ownedRangeSource } from "@poe-code/spreadsheet-engine/range-input";
import { Binary, invalidBiff, isCfb } from "./biff-binary.js";
import { CfbBackendFailure, readCfbRanges } from "./cfb-range.js";

const workbookStreams = ["Workbook", "WORKBOOK", "workbook", "Book", "BOOK", "book"];

/** Keep the explicit buffered BIFF API separate from retained file ingestion. */
interface BiffRangeInput {
  found: boolean; streamSize: number; records: BiffRecords; close(): Promise<void>; streams?: ReadonlyMap<string, Uint8Array>;
}
export async function readBiffRange(input: RangeSource, context: CapabilityContext, probe = false): Promise<BiffRangeInput> {
  let recordStore: BiffRecordStore | undefined, keepOpen = false, failed = false, failure: unknown;
  let closed = false, container: Awaited<ReturnType<typeof readCfbRanges>> | undefined;
  const cleanup = async () => {
    closed = true;
    const errors: unknown[] = [];
    for (const resource of [recordStore, container]) {
      try { await resource?.close(); } catch (error) { errors.push(error instanceof CfbBackendFailure ? error.cause : error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "BIFF reader cleanup failed");
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
  const load = async (): Promise<BiffRangeInput> => {
    const head = await exact(source, 0, Math.min(8, size));
    let workbook: RangeSource | undefined = source, streams: Map<string, Uint8Array> | undefined;
    if (isCfb(head)) {
      container = await readCfbRanges(source, context); check();
      workbook = workbookStreams.map(name => container!.streams.get(name)).find(value => value !== undefined);
    }
    if (probe) return { found: container ? workbook !== undefined : head[0] === 9 && (head[1]! & 0xf1) === 0, streamSize: 0, records: [], close: cleanup };
    if (!workbook) throw new SsconvertError("io", "E No Workbook or Book streams found.");
    let records: BiffRecords;
    if (context.createWorkingStorage) records = recordStore = await createBiffRecordStore(workbook, context);
    else {
      records = [];
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
    keepOpen = recordStore !== undefined;
    return { found: true, streamSize: workbook.size, records, close: cleanup, ...(streams ? { streams } : {}) };
  };
  let result: BiffRangeInput | undefined;
  try { result = await load(); }
  catch (caught) {
    const error = context.signal.aborted ? context.signal.reason : caught;
    const backend = error instanceof CfbBackendFailure;
    if (!context.signal.aborted && !backend && probe && error instanceof SsconvertError && error.code === "io")
      result = { found: false, streamSize: 0, records: [], close: cleanup };
    else { failed = true; failure = error instanceof CfbBackendFailure ? error.cause : error; }
  }
  if (!keepOpen) {
    try { await cleanup(); }
    catch (error) { if (failed) throw new AggregateError([failure, error], "BIFF input and cleanup failed"); throw error; }
  }
  if (failed) throw failure;
  return result!;
}
