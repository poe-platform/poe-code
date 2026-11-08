import { SsconvertError } from "@poe-code/spreadsheet-engine/contracts";
import { Binary, isCfb, readCfb, readBiffRecords, invalidBiff, type BiffReadContext } from "./biff-binary.js";
import { BiffStrings } from "./biff-strings.js";

export interface CachedBiffCell {
  readonly row: number;
  readonly column: number;
  readonly type: "n" | "s" | "b" | "e";
  readonly value: string | number | boolean;
  readonly format: string | number;
}
export interface CachedBiffSheet { readonly name: string; readonly cells: readonly CachedBiffCell[]; }
export interface CachedBiffWorkbook { readonly sheets: readonly CachedBiffSheet[]; readonly date1904: boolean; }
export interface CachedBiffOptions extends BiffReadContext {
  readonly limits: BiffReadContext["limits"] & { readonly cells: number; readonly sheets: number };
  readonly work: () => void;
  readonly retain: (bytes: number) => void;
  /** Legacy codepage override; BIFF8 Unicode is independent of this option. */
  readonly encoding?: number | (() => number);
  readonly namesOnly?: boolean;
}

/** xlrd's value-only profile: ignore formula/name translation and formatting-only blanks. */
export function readCachedBiff(bytes: Uint8Array, options: CachedBiffOptions): CachedBiffWorkbook {
  options.signal.throwIfAborted(); options.work();
  const streams = isCfb(bytes) ? readCfb(bytes, options) : undefined;
  const stream = streams ? streams.get("Workbook") ?? streams.get("Book") : bytes;
  if (!stream) invalidBiff("No Workbook or Book streams found");
  const records = readBiffRecords(stream, options);
  const first = records[0];
  if (!first || ![9, 0x209, 0x409, 0x809].includes(first.opcode)) invalidBiff("missing BOF");
  let revision = 8, codepage = 28591, date1904 = false, cells = 0, legacyFormats = 0, ixfe: number | undefined;
  const formats = new Map<number, string>(), xfs: number[] = [], strings: string[] = [];
  const bounds = new Map<number, { name: string; type: number }>();
  const legacyNames: string[] = [];
  const sheets: { name: string; cells: CachedBiffCell[] }[] = [];
  const sheetOffsets = new Map<number, typeof sheets[number]>();
  const scopes: { sheet?: typeof sheets[number]; revision: number; type: number }[] = [];
  let pending: { sheet: typeof sheets[number]; index: number } | undefined;
  const checkPending = () => { if (pending) invalidBiff("Expected STRING record after FORMULA"); };
  const parts = (index: number, offset: number) => {
    const data = records[index]!.data;
    options.retain(64);
    const chunks = [new Binary(data.slice(offset, data.bytes.length - offset))];
    while (records[index + 1]?.opcode === 0x3c) {
      options.work(); options.retain(64); chunks.push(records[++index]!.data);
    }
    return { chunks, next: index };
  };
  let override: number | undefined;
  const cursor = (chunks: Binary[]) => {
    if (revision < 8 && override === undefined && options.encoding !== undefined)
      override = typeof options.encoding === "number" ? options.encoding : options.encoding();
    return new BiffStrings(chunks, options, revision < 8 ? override ?? codepage : codepage);
  };
  const add = (sheet: typeof sheets[number], row: number, column: number, xf: number,
    type: CachedBiffCell["type"], value: CachedBiffCell["value"], directFormat?: number) => {
    options.work();
    if (row >= (revision >= 8 ? 65536 : 16384) || column >= 256) invalidBiff("cell outside worksheet");
    if (++cells > options.limits.cells) throw new SsconvertError("resource-limit", "BIFF cells limit exceeded");
    options.retain(128);
    const format = directFormat ?? xfs[xf] ?? 0;
    sheet.cells.push({ row, column, type, value, format: formats.get(format) ?? format });
  };
  for (let index = 0; index < records.length; index++) {
    options.signal.throwIfAborted(); options.work();
    const { opcode, data, offset } = records[index]!;
    if ([9, 0x209, 0x409, 0x809].includes(opcode)) {
      checkPending();
      revision = opcode === 9 ? 2 : opcode === 0x209 ? 3 : opcode === 0x409 ? 4 :
        data.u16(0) === 0x600 ? 8 : data.u16(0) === 0x500 ? 5 : 0;
      if (!revision) invalidBiff("unsupported cached BIFF revision");
      const type = data.u16(2), bound = bounds.get(offset);
      let sheet: typeof sheets[number] | undefined;
      if (type === 0x10 && (!scopes.length || scopes[scopes.length - 1]!.type === 0x100) && (bound === undefined || bound.type === 0)) {
        if (sheets.length >= options.limits.sheets) throw new SsconvertError("resource-limit", "BIFF sheets limit exceeded");
        const name = bound?.name ?? `Sheet${sheets.length + 1}`;
        options.retain(192 + name.length * 2); sheet = { name, cells: [] }; sheets.push(sheet); sheetOffsets.set(offset, sheet);
      }
      options.retain(64); scopes.push({ ...(sheet ? { sheet } : {}), revision, type }); continue;
    }
    if (opcode === 10) {
      checkPending();
      if (!scopes.length) invalidBiff("EOF without BOF");
      scopes.pop(); revision = scopes[scopes.length - 1]?.revision ?? revision; continue;
    }
    const scope = scopes[scopes.length - 1];
    if (!scope) invalidBiff("record outside BOF/EOF");
    if (!scope.sheet && scope.type !== 5 && scope.type !== 0x100) continue;
    if (opcode === 0x2f) throw new SsconvertError("unsupported-feature", "Workbook is encrypted");
    if (opcode === 0x42) { codepage = data.u16(0); continue; }
    if (opcode === 0x22) { date1904 = data.u16(0) !== 0; continue; }
    if (opcode === 0x85) {
      if (revision === 4 && scope.type === 0x100) {
        const text = cursor([new Binary(data.slice(1, data.bytes.length - 1))]);
        options.retain(16); legacyNames.push(text.legacy(data.u8(0))); continue;
      }
      const target = data.u32(0), length = data.u8(6), type = data.u8(5);
      if (target >= stream.length || bounds.has(target)) invalidBiff("invalid BOUNDSHEET offset");
      const text = cursor([new Binary(data.slice(7, data.bytes.length - 7))]);
      const name = revision >= 8 ? text.unicode(length).text : text.legacy(length);
      options.retain(96); bounds.set(target, { name, type }); continue;
    }
    if (opcode === 0x8f && revision === 4 && scope.type === 0x100) {
      const target = offset + 4 + data.bytes.length, length = data.u32(0);
      if (target + length > stream.length || !length) invalidBiff("invalid SHEETHDR length");
      const name = cursor([new Binary(data.slice(5, data.bytes.length - 5))]).legacy(data.u8(4));
      if (name !== legacyNames[bounds.size]) invalidBiff("SHEETHDR name differs from BOUNDSHEET");
      options.retain(96); bounds.set(target, { name, type: 0 });
      formats.clear(); xfs.length = 0; legacyFormats = 0; ixfe = undefined; continue;
    }
    if (opcode === 0xfc) {
      const count = data.u32(4);
      if (count > data.u32(0)) invalidBiff("invalid SST count");
      if (options.namesOnly) continue;
      const joined = parts(index, 8); index = joined.next;
      const text = cursor(joined.chunks);
      for (let entry = 0; entry < count; entry++) {
        options.work(); options.retain(16); strings.push(text.unicode(text.word()).text);
      }
      continue;
    }
    if (options.namesOnly) continue;
    if (opcode === 0x1e || opcode === 0x41e) {
      const id = revision >= 5 ? data.u16(0) : legacyFormats++;
      const at = revision >= 4 ? 2 : 0, length = revision >= 8 ? data.u16(at) : data.u8(at);
      const joined = parts(index, at + (revision >= 8 ? 2 : 1)); index = joined.next;
      const text = cursor(joined.chunks);
      options.retain(64); formats.set(id, revision >= 8 ? text.unicode(length).text : text.legacy(length)); continue;
    }
    if ([0xe0, 0x43, 0x243, 0x443].includes(opcode)) {
      options.retain(8); xfs.push(revision >= 5 ? data.u16(2) : revision >= 3 ? data.u8(1) : data.u8(2) & 63); continue;
    }
    if (opcode === 0x44) { ixfe = data.u16(0); continue; }
    const sheet = scope.sheet;
    if (!sheet) continue;
    if (opcode === 7 || opcode === 0x207) {
      if (!pending || pending.sheet !== sheet) invalidBiff("STRING without FORMULA");
      const length = revision === 2 ? data.u8(0) : data.u16(0);
      const joined = parts(index, revision === 2 ? 1 : 2); index = joined.next;
      const text = cursor(joined.chunks);
      const value = length === 0 ? "" : revision >= 8 ? text.unicode(length).text : text.legacy(length);
      sheet.cells[pending.index] = { ...sheet.cells[pending.index]!, value }; pending = undefined; continue;
    }
    if (opcode === 0xbd) {
      checkPending();
      const row = data.u16(0), start = data.u16(2), end = data.u16(data.bytes.length - 2);
      if (end < start || end >= 256 || data.bytes.length !== 6 + (end - start + 1) * 6) invalidBiff("invalid MULRK");
      for (let column = start; column <= end; column++) {
        const at = 4 + (column - start) * 6;
        add(sheet, row, column, data.u16(at), "n", rk(data.u32(at + 2)));
      }
      continue;
    }
    if (![2, 3, 4, 5, 6, 0x203, 0x204, 0x205, 0x206, 0x406, 0x27e, 0xfd, 0xd6].includes(opcode)) continue;
    checkPending();
    const row = data.u16(0), column = data.u16(2), start = revision === 2 ? 7 : 6;
    let xf = revision === 2 ? data.u8(4) & 63 : data.u16(4);
    if (revision === 2 && xfs.length && xf === 63) {
      if (ixfe === undefined) invalidBiff("BIFF2 XF index 63 without IXFE"); xf = ixfe;
    }
    const directFormat = revision === 2 && !xfs.length ? data.u8(5) & 63 : undefined;
    let type: CachedBiffCell["type"] = "n", value: CachedBiffCell["value"];
    if (opcode === 2) value = data.u16(7);
    else if (opcode === 3 || opcode === 0x203) value = data.f64(start);
    else if (opcode === 0x27e) value = rk(data.u32(6));
    else if (opcode === 5 || opcode === 0x205) {
      type = data.u8(start + 1) ? "e" : "b"; value = type === "e" ? data.u8(start) : !!data.u8(start);
    } else if (opcode === 0xfd) {
      const entry = strings[data.u32(6)]; if (entry === undefined) invalidBiff("invalid shared string index");
      type = "s"; value = entry;
    } else if (opcode === 6 || opcode === 0x206 || opcode === 0x406) {
      if (data.u16(start + 6) !== 0xffff) value = data.f64(start);
      else {
        const tag = data.u8(start);
        if (tag > 3) invalidBiff("invalid formula cache tag");
        type = tag === 1 ? "b" : tag === 2 ? "e" : "s";
        value = tag === 1 ? !!data.u8(start + 2) : tag === 2 ? data.u8(start + 2) : "";
        if (tag === 0) pending = { sheet, index: sheet.cells.length };
      }
    } else {
      const length = revision === 2 ? data.u8(7) : data.u16(6);
      const joined = parts(index, 8); index = joined.next;
      const text = cursor(joined.chunks); type = "s";
      value = revision >= 8 ? text.unicode(length).text : text.legacy(length);
    }
    add(sheet, row, column, xf, type, value, directFormat);
  }
  checkPending();
  if (scopes.length) invalidBiff("missing EOF");
  if (!bounds.size) return { sheets, date1904 };
  const ordered: CachedBiffSheet[] = [];
  for (const [offset, bound] of bounds) {
    options.work();
    if (bound.type !== 0) continue;
    const sheet = sheetOffsets.get(offset);
    if (!sheet) invalidBiff("missing bound worksheet");
    options.retain(8); ordered.push(sheet);
  }
  return { sheets: ordered, date1904 };
}

function rk(bits: number): number {
  let value: number;
  if (bits & 2) value = bits >> 2;
  else {
    const data = new DataView(new ArrayBuffer(8)); data.setUint32(4, bits & 0xfffffffc, true); value = data.getFloat64(0, true);
  }
  return bits & 1 ? value / 100 : value;
}
