import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook, Range, AxisMetadata, NamedExpression, ImportedValue, UnsupportedRecord, RichTextRun, FormulaGroup } from "../workbook.js";
import { Binary, isCfb, readCfb, readBiffRecords, invalidBiff, type BiffRecord } from "./biff-binary.js";
import { decryptBiffRecords } from "./biff-encryption.js";
import { encryptBiffStream, createBiffEncryptionHeader, biffEncryptionProfiles, type BiffEncryptionProfile } from "./biff-encrypted-write.js";
import { encryptBiffXorStreams } from "./biff-xor-write.js";
import { exportOptionPairs } from "../cli/export-options.js";
import { BiffStrings, biffDecode, biffOverrideCodepage } from "./biff-strings.js";
import { translateBiffFormula, biffErrors, type BiffFormulaContext } from "./biff-formulas.js";
import { BiffNameBindings } from "./biff-name-bindings.js";
import { biffOpcodes } from "./biff-source.js";
import { biffNode as node, biffMetadataOpcodes, readBiffMetadata } from "./biff-metadata.js";
import { writeCfb } from "./biff-write-binary.js";
import { writeBiffStream } from "./biff-write.js";
import type { Codec } from "./types.js";

export function createBiffWriter(profile: 7 | 8 | "dsf"): NonNullable<Codec["write"]> {
  return async (book, options, context) => {
    context.signal.throwIfAborted();
    let encrypted: BiffEncryptionProfile | undefined;
    for (const text of options) for (const [key, value] of exportOptionPairs(text)) if (key === "encryption") {
      encrypted = biffEncryptionProfiles.get(value);
      if (!encrypted || profile !== 8 && encrypted.algorithm !== "xor") throw new SsconvertError("invalid-request", "Invalid Excel BIFF encryption profile");
    }
    const streams = new Map<string, Uint8Array>();
    try {
      if (profile === 7 || profile === "dsf") streams.set("Book", await writeBiffStream(book, 7, profile === "dsf", context,
        encrypted ? createBiffEncryptionHeader(encrypted, 7) : undefined));
      if (profile === 8 || profile === "dsf") {
        const stream = await writeBiffStream(book, 8, profile === "dsf", context, encrypted ? createBiffEncryptionHeader(encrypted) : undefined);
        streams.set("Workbook", stream);
        if (encrypted && encrypted.algorithm !== "xor") await encryptBiffStream(stream, context, encrypted);
      }
      if (encrypted?.algorithm === "xor") await encryptBiffXorStreams([...streams.values()], profile === 7 ? 7 : 8, context);
      return writeCfb(streams, context);
    } finally { if (encrypted) for (const stream of streams.values()) stream.fill(0); }
  };
}

const workbookStreams = ["Workbook", "WORKBOOK", "workbook", "Book", "BOOK", "book"];
const bofOpcodes = new Set([9, 0x209, 0x409, 0x809]);
const formats: Readonly<Record<number, string>> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: "$#,##0_);($#,##0)",
  6: "$#,##0_);[Red]($#,##0)", 7: "$#,##0.00_);($#,##0.00)", 8: "$#,##0.00_);[Red]($#,##0.00)",
  9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "m/d/yy",
  15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM",
  20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)",
  39: "#,##0.00_);(#,##0.00)", 40: "#,##0.00_);[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@"
};
const defaultPalette = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF",
  "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00",
  "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333"];
const ignoredOpcodes = new Set([0xb, 0x20b, 0xd7, 0xff, 0x16, 0x1f, 0x5b, 0x5c, 0xc0, 0xc1, 0xe1, 0xe2,
  0x40, 0x8c, 0x9c, 0xbf, 0xda, 0x160, 0x161, 0x13d, 0x1c0, 0x1c1, 0x1c2, 0x86, 0x87, 0x9b,
  0x80, 0x82, 0x8d, 0x5f, 0x8b, 0x8e, 0x42e, 0x1af, 0xe, 0x293, 0x1b7, 0x1bc]);
interface PendingCell { cell: Cell; xf: number; tokens?: Uint8Array; revision: number; codepage: number; }
interface PendingExternalName { name: string; tokens: Uint8Array; revision: number; codepage: number; supported: boolean; record: BiffRecord; }
interface PendingSheet {
  id: string; name: string; offset: number; visibility: "visible" | "hidden" | "very-hidden";
  cells: PendingCell[]; merges: Range[]; rows: AxisMetadata[]; columns: AxisMetadata[];
  unsupportedRecords: UnsupportedRecord[]; view: Record<string, ImportedValue>;
  records: BiffRecord[]; revision: number; codepage: number;
  legacyExternalSheets: (string | null | undefined)[];
  legacyExternalNames: PendingExternalName[]; legacyAddinSheets: Set<number>;
  groups: { id: string; kind: "shared" | "array"; range: Range; tokens: Uint8Array; keyRow: number; keyColumn: number }[];
}
interface BoundSheet { offset: number; name: string; visibility: PendingSheet["visibility"]; type: number; }
interface Font { name: string; attributes: Record<string, number>; color: number; codepage: number; }

function revision(record: BiffRecord): number {
  record.data.check(0, 4);
  if (record.opcode !== 0x809) return record.opcode === 9 ? 2 : record.opcode === 0x209 ? 3 : 4;
  const value = record.data.u16(0);
  const versions: Readonly<Record<number, number>> = { 0x600: 8, 0x500: 7, 0x400: 4, 0x300: 3, 0x200: 2, 7: 2, 0: 2 };
  const result = versions[value]; if (!result) invalidBiff("unknown BIFF revision"); return result;
}
function workbookBytes(bytes: Uint8Array, context: CapabilityContext): Uint8Array | undefined {
  if (!isCfb(bytes)) return bytes;
  const streams = readCfb(bytes, context);
  for (const name of workbookStreams) { const stream = streams.get(name); if (stream) return stream; }
  return undefined;
}
export async function probeBiff(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  context.signal.throwIfAborted();
  if (!isCfb(bytes)) return bytes[0] === 9 && (bytes[1]! & 0xf1) === 0;
  try { return workbookBytes(bytes, context) !== undefined; }
  catch (error) { context.signal.throwIfAborted(); if (error instanceof SsconvertError && error.code === "io") return false; throw error; }
}
export async function readBiff(borrowed: Uint8Array, context: CapabilityContext, encoding?: string): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (borrowed.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const bytes = new Uint8Array(borrowed), stream = workbookBytes(bytes, context);
  if (!stream) throw new SsconvertError("io", "E No Workbook or Book streams found.");
  const records = readBiffRecords(stream, context);
  if (!records[0] || !bofOpcodes.has(records[0].opcode)) invalidBiff("missing BOF");
  const override = biffOverrideCodepage(encoding);
  let codepage = override ?? 1252, ver = revision(records[0]), dateSystem: "1900" | "1904" = "1900";
  await decryptBiffRecords(records, ver, context);
  let calculationMode: "automatic" | "manual" = "automatic", maximum = 100, tolerance = 0.001, iterationEnabled = false;
  let cellCount = 0, textBytes = 0, metadataBytes = 0;
  const boundSheets: BoundSheet[] = [], sheets: PendingSheet[] = [], unsupported: UnsupportedRecord[] = [];
  const names: { name: string; flags: number; tokens: Uint8Array; sheetIndex: number; revision: number; codepage: number; record: BiffRecord; owner?: PendingSheet }[] = [];
  const legacyExternalSheets: (string | null | undefined)[] = [];
  const legacyExternalNames: PendingExternalName[] = [], legacyAddinSheets = new Set<number>();
  const supbooks: { kind: "local" | "addin" | "external"; names: PendingExternalName[] }[] = [], externalReferences: { book: number; first: number; last: number }[] = [];
  const fontTable: Font[] = [], xfTable: { data: Binary; revision: number }[] = [], palette = [...defaultPalette];
  const formatTable = new Map<number, string>(Object.entries(formats).map(([id, code]) => [Number(id), code]));
  const sharedStrings: { text: string; richText?: readonly RichTextRun[] }[] = [];
  const scopes: { type: number; sheet?: PendingSheet; revision: number }[] = [];
  let lastFormula: PendingCell | undefined;
  let groupCount = 0;
  let legacyFormatCount = 0;
  const accountText = (text: string) => {
    textBytes += new TextEncoder().encode(text).length;
    if (textBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF text limit exceeded");
    return text;
  };
  const retain = async (record: BiffRecord, target: UnsupportedRecord[], warn = true) => {
    metadataBytes += record.data.bytes.length * 2;
    if (metadataBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes * 2))
      throw new SsconvertError("resource-limit", "ssconvert BIFF metadata limit exceeded");
    const kind = biffOpcodes[record.opcode]?.join("/") ?? `opcode-0x${record.opcode.toString(16)}`;
    target.push({ source: "biff", kind, disposition: "retained", data: { opcode: record.opcode, offset: record.offset,
      bytes: Array.from(record.data.bytes, byte => byte.toString(16).padStart(2, "0")).join("") } });
    if (warn) await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning",
      message: `BIFF ${kind} retained without semantic interpretation` });
  };
  const addCell = (sheet: PendingSheet, data: Binary, value: CellValue, extra: Partial<Cell> = {}): PendingCell => {
    const row = data.u16(0), column = data.u16(2);
    if (column > 255 || row >= (ver >= 8 ? 65536 : 16384)) invalidBiff("cell outside worksheet");
    if (++cellCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert cells limit exceeded");
    const xf = ver === 2 ? data.u8(4) & 63 : data.u16(4);
    const cell: PendingCell = { cell: { row, column, value, ...extra }, xf, revision: ver, codepage };
    sheet.cells.push(cell); return cell;
  };
  const stringParts = (index: number, offset: number): { parts: Binary[]; next: number } => {
    const first = records[index]!.data, parts = [new Binary(first.slice(offset, first.bytes.length - offset))];
    while (records[index + 1]?.opcode === 0x3c) parts.push(records[++index]!.data);
    return { parts, next: index };
  };
  for (let index = 0; index < records.length; index++) {
    context.signal.throwIfAborted();
    const record = records[index]!, data = record.data, opcode = record.opcode;
    if (bofOpcodes.has(opcode)) {
      ver = revision(record); const type = data.u16(2);
      const bound = boundSheets.find(sheet => sheet.offset === record.offset);
      let sheet: PendingSheet | undefined;
      if (type === 0x10 || type === 0x40 || type === 0x20 && !scopes.length) {
        if (sheets.length >= context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert sheets limit exceeded");
        const name = accountText(bound?.name ?? (sheets.length ? `Worksheet${sheets.length + 1}` : "Worksheet"));
        if (sheets.some(sheet => sheet.name === name)) invalidBiff("duplicate worksheet name");
        sheet = { id: name, name, offset: record.offset, visibility: bound?.visibility ?? "visible", cells: [],
          merges: [], rows: [], columns: [], unsupportedRecords: [], view: {}, records: [], revision: ver, codepage, groups: [], legacyExternalSheets: [], legacyExternalNames: [], legacyAddinSheets: new Set() }; sheets.push(sheet);
      }
      scopes.push({ type, ...(sheet ? { sheet } : {}), revision: ver }); lastFormula = undefined;
      if (![5, 0x10, 0x40, 0x100].includes(type)) await retain(record, sheet?.unsupportedRecords ?? unsupported);
      continue;
    }
    if (opcode === 10) {
      if (!scopes.length) invalidBiff("EOF without BOF"); scopes.pop();
      ver = scopes[scopes.length - 1]?.revision ?? ver; lastFormula = undefined; continue;
    }
    const scope = scopes[scopes.length - 1]; if (!scope) invalidBiff("record outside BOF/EOF");
    const sheet = scope.sheet;
    if (sheet) sheet.records.push(record);
    if (![5, 0x10, 0x40, 0x100].includes(scope.type)) { await retain(record, unsupported, false); continue; }
    if (opcode === 0x2f) continue;
    if (opcode === 0x42 && scope.type === 5) { codepage = data.u16(0); continue; }
    if (opcode === 0x22) { dateSystem = data.u16(0) ? "1904" : "1900"; continue; }
    if (opcode === 0xd) { calculationMode = data.u16(0) === 0 ? "manual" : "automatic"; continue; }
    if (opcode === 0xc) { maximum = data.u16(0); continue; }
    if (opcode === 0x10) { tolerance = data.f64(0); if (!Number.isFinite(tolerance)) invalidBiff("invalid iteration tolerance"); continue; }
    if (opcode === 0x11) { iterationEnabled = !!data.u16(0); continue; }
    if (opcode === 0x85) {
      const start = data.u32(0), visibility = data.u8(4), type = data.u8(5), length = data.u8(6);
      if (visibility > 2 || start >= stream.length) invalidBiff("invalid BOUNDSHEET");
      const cursor = new BiffStrings([new Binary(data.slice(7, data.bytes.length - 7))], context, codepage);
      const name = accountText(ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length));
      boundSheets.push({ offset: start, name, type, visibility: visibility === 0 ? "visible" : visibility === 1 ? "hidden" : "very-hidden" });
      continue;
    }
    if (opcode === 0xfc) {
      const total = data.u32(0), count = data.u32(4); if (count > total || count > context.limits.cells) invalidBiff("invalid SST count");
      const parts = stringParts(index, 8); index = parts.next;
      const cursor = new BiffStrings(parts.parts, context, codepage);
      for (let i = 0; i < count; i++) { const value = cursor.unicode(cursor.word()); accountText(value.text); sharedStrings.push(value); }
      continue;
    }
    if ([0x1e, 0x41e].includes(opcode)) {
      const id = ver >= 7 ? data.u16(0) : legacyFormatCount++;
      const offset = ver >= 4 ? 2 : 0, length = ver >= 8 ? data.u16(offset) : data.u8(offset);
      const start = offset + (ver >= 8 ? 2 : 1), parts = stringParts(index, start); index = parts.next;
      const cursor = new BiffStrings(parts.parts, context, codepage);
      formatTable.set(id, accountText(ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length))); continue;
    }
    if ([0xe0, 0x43, 0x243, 0x443].includes(opcode)) { xfTable.push({ data, revision: ver }); continue; }
    if ([0x31, 0x231].includes(opcode)) {
      const flags = data.u16(2), modern = ver >= 5, start = modern ? 15 : ver >= 3 ? 7 : 5;
      const length = data.u8(start - 1), cursor = new BiffStrings([new Binary(data.slice(start, data.bytes.length - start))], context, codepage);
      if (fontTable.length === 4) fontTable.push(fontTable[0]!);
      const charset = modern ? data.u8(12) : 1;
      const fontCodepages: Readonly<Record<number, number>> = { 0: override ?? 1252, 1: 1252, 255: 1252, 77: 10000,
        128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255,
        178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };
      fontTable.push({ name: accountText(ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length)),
        color: ver >= 3 ? data.u16(4) : 0x7fff,
        codepage: fontCodepages[charset] ?? 1252,
        attributes: { Unit: data.u16(0) / 20, Bold: modern ? data.u16(6) >= 700 ? 1 : 0 : flags & 1 ? 1 : 0,
          Italic: flags & 2 ? 1 : 0, StrikeThrough: flags & 8 ? 1 : 0,
          Underline: modern ? ({ 1: 1, 2: 2, 33: 3, 34: 4 } as Readonly<Record<number, number>>)[data.u8(10)] ?? 0 : flags & 4 ? 1 : 0,
          Script: modern ? data.u16(8) === 1 ? 1 : data.u16(8) === 2 ? -1 : 0 : 0 } }); continue;
    }
    if (opcode === 0x92) {
      const count = data.u16(0); data.check(2, count * 4); if (count > 56) invalidBiff("invalid palette count");
      for (let i = 0; i < count; i++) palette[i] = Array.from(data.slice(2 + i * 4, 3), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
      continue;
    }
    if (opcode === 0x1ae) {
      data.check(0, 4);
      const kind = data.bytes.length === 4 && data.u16(2) === 0x401 ? "local" : data.bytes.length === 4 && data.u16(2) === 0x3a01 ? "addin" : "external";
      supbooks.push({ kind, names: [] });
      if (kind !== "addin") await retain(record, unsupported, kind === "external");
      continue;
    }
    if (ver >= 7 && (opcode === 0x23 || opcode === 0x223)) {
      data.check(0, 7);
      const flags = data.u16(0), length = data.u8(6);
      const cursor = new BiffStrings([new Binary(data.slice(7, data.bytes.length - 7))], context, codepage);
      const name = accountText(ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length));
      const end = 7 + cursor.consumedBytes;
      const tokenLength = end + 2 <= data.bytes.length ? data.u16(end) : 0;
      const tokens = tokenLength ? data.slice(end + 2, tokenLength) : new Uint8Array();
      const table = ver >= 8 ? supbooks.at(-1)?.names : sheet?.legacyExternalNames ?? legacyExternalNames;
      if (!table) invalidBiff("EXTERNNAME without SUPBOOK");
      table.push({ name, tokens, revision: ver, codepage, supported: flags === 0, record });
      const addin = ver >= 8 ? supbooks.at(-1)?.kind === "addin" : (sheet?.legacyAddinSheets ?? legacyAddinSheets).size > 0;
      if (!addin || flags !== 0) await retain(record, sheet?.unsupportedRecords ?? unsupported);
      continue;
    }
    if (opcode === 0x17 && ver >= 8) {
      const count = data.u16(0); data.check(2, count * 6);
      for (let i = 0; i < count; i++) externalReferences.push({ book: data.u16(2 + i * 6), first: data.u16(4 + i * 6), last: data.u16(6 + i * 6) });
      continue;
    }
    if (opcode === 0x17 && ver < 8) {
      const length = data.u8(0), kind = data.u8(1);
      const links = sheet?.legacyExternalSheets ?? legacyExternalSheets;
      if (kind === 3) links.push(accountText(biffDecode(data.slice(2, Math.min(length, data.bytes.length - 2)), codepage)));
      else if (kind === 2) links.push(sheet?.name);
      else if (kind === 4) links.push(null);
      else if (kind === 0x3a && length === 1 && data.bytes.length === 2) {
        (sheet?.legacyAddinSheets ?? legacyAddinSheets).add(links.length); links.push(undefined);
      }
      else {
        links.push(undefined);
        await retain(record, sheet?.unsupportedRecords ?? unsupported);
      }
      continue;
    }
    if (opcode === 0x18 || opcode === 0x218) {
      const flags = data.u16(0), length = data.u8(3), tokenLength = ver === 2 ? data.u8(4) : data.u16(4);
      const start = ver >= 7 ? 14 : ver >= 3 ? 6 : 5, sheetIndex = ver >= 8 ? data.u16(8) : ver >= 7 ? data.u16(6) : 0;
      const cursor = new BiffStrings([new Binary(data.slice(start, data.bytes.length - start))], context, codepage);
      let name: string;
      if (flags & 0x20 && length) {
        // Built-in ids are characters, including the full Unicode header and suffix.
        const text = ver >= 8 ? cursor.unicode(length).text : String.fromCharCode(cursor.byte()) + cursor.legacy(length - 1);
        const builtin = text.charCodeAt(0) & 255;
        const base = ["Consolidate_Area", "Auto_Open", "Auto_Close", "Extract", "Database", "Criteria",
          "Print_Area", "Print_Titles", "Recorder", "Data_Form", "Auto_Activate", "Auto_Deactivate", "Sheet_Title", "_FilterDatabase"][builtin];
        name = (base ?? `_BIFF_BUILTIN_${builtin}`) + text.slice(1);
      } else name = ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length);
      names.push({ name: accountText(name), flags, tokens: data.slice(start + cursor.consumedBytes, tokenLength), sheetIndex, revision: ver, codepage, record, ...(sheet ? { owner: sheet } : {}) }); continue;
    }
    if (ignoredOpcodes.has(opcode)) continue;
    if (opcode === 0xf) { if (sheet) sheet.view.referenceMode = data.u16(0) ? "A1" : "R1C1"; continue; }
    if (opcode === 0x3d) { data.check(0, 18); continue; }
    if (!sheet && [0x12, 0x13, 0x19].includes(opcode)) { data.check(0, 2); await retain(record, unsupported, false); continue; }
    if (!sheet) { await retain(record, unsupported); continue; }
    if ([1, 0x201, 2, 3, 0x203, 4, 0x204, 5, 0x205, 0x27e, 0xfd, 0xd6].includes(opcode)) {
      const start = ver === 2 ? 7 : 6;
      if (opcode === 1 || opcode === 0x201) addCell(sheet, data, { kind: "blank" });
      else if (opcode === 2) addCell(sheet, data, { kind: "number", value: data.u16(7) });
      else if (opcode === 3 || opcode === 0x203) {
        const value = data.f64(start); if (!Number.isFinite(value)) invalidBiff("nonfinite cell number"); addCell(sheet, data, { kind: "number", value });
      } else if (opcode === 5 || opcode === 0x205) addCell(sheet, data, data.u8(start + 1) ?
        { kind: "error", value: biffErrors[data.u8(start)] ?? "#UNKNOWN!" } : { kind: "boolean", value: !!data.u8(start) });
      else if (opcode === 0x27e) addCell(sheet, data, { kind: "number", value: rk(data.u32(6)) });
      else if (opcode === 0xfd) {
        const string = sharedStrings[data.u32(6)]; if (!string) invalidBiff("invalid shared string index");
        addCell(sheet, data, { kind: "string", value: string.text }, string.richText ? { richText: string.richText } : {});
      } else {
        const length = opcode === 4 ? data.u8(7) : data.u16(6), parts = stringParts(index, 8); index = parts.next;
        const xf = xfTable[ver === 2 ? data.u8(4) & 63 : data.u16(4)];
        const font = xf ? fontTable[xf.revision >= 5 ? xf.data.u16(0) : xf.data.u8(0)] : undefined;
        const cursor = new BiffStrings(parts.parts, context, font?.codepage ?? codepage), string = ver >= 8 ? cursor.unicode(length) : { text: cursor.legacy(length) };
        addCell(sheet, data, { kind: "string", value: accountText(string.text) }, string.richText ? { richText: string.richText } : {});
        if (opcode === 0xd6) await retain(record, sheet.unsupportedRecords);
      }
      lastFormula = undefined; continue;
    }
    if (opcode === 0xbd || opcode === 0xbe) {
      const first = data.u16(2), last = data.u16(data.bytes.length - 2), width = opcode === 0xbd ? 6 : 2;
      if (last < first || last > 255 || data.bytes.length !== 6 + (last - first + 1) * width) invalidBiff("invalid multiple-cell record");
      for (let column = first; column <= last; column++) {
        const fake = new Uint8Array(6), view = new DataView(fake.buffer); view.setUint16(0, data.u16(0), true); view.setUint16(2, column, true);
        view.setUint16(4, data.u16(4 + (column - first) * width), true);
        addCell(sheet, new Binary(fake), opcode === 0xbd ? { kind: "number", value: rk(data.u32(6 + (column - first) * width)) } : { kind: "blank" });
      } continue;
    }
    if ([6, 0x206, 0x406].includes(opcode)) {
      const start = ver === 2 ? 7 : 6, tokenStart = ver >= 5 ? 22 : ver >= 3 ? 18 : 17;
      const tokenLength = ver === 2 ? data.u8(16) : data.u16(tokenStart - 2);
      let value: CellValue, stringCache = false;
      if (data.u16(start + 6) !== 0xffff) { const number = data.f64(start); if (!Number.isFinite(number)) invalidBiff("nonfinite formula cache"); value = { kind: "number", value: number }; }
      else { const kind = data.u8(start); stringCache = kind === 0; value = kind === 1 ? { kind: "boolean", value: !!data.u8(start + 2) } :
        kind === 2 ? { kind: "error", value: biffErrors[data.u8(start + 2)] ?? "#UNKNOWN!" } : { kind: "blank" }; if (kind > 3) invalidBiff("invalid formula cache tag"); }
      lastFormula = addCell(sheet, data, value, { cachedResult: value, formulaDirty: !!(data.u16(14) & 3) });
      lastFormula.tokens = data.slice(tokenStart, tokenLength);
      const nextOpcode = records[index + 1]?.opcode;
      const groupFollows = nextOpcode === 0x4bc || nextOpcode === 0x21 || nextOpcode === 0x221;
      const stringOpcode = records[index + (groupFollows ? 2 : 1)]?.opcode;
      if (stringCache && stringOpcode !== 7 && stringOpcode !== 0x207) {
        const error: CellValue = { kind: "error", value: "MISSING STRING" };
        lastFormula.cell = { ...lastFormula.cell, value: error, cachedResult: error };
        let column = "";
        for (let n = lastFormula.cell.column + 1; n; n = Math.floor((n - 1) / 26))
          column = String.fromCharCode(65 + (n - 1) % 26) + column;
        await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning",
          message: `EXCEL: missing STRING record for ${column}${lastFormula.cell.row + 1}` });
        if (!groupFollows) lastFormula = undefined;
      }
      continue;
    }
    if (opcode === 0x4bc || opcode === 0x21 || opcode === 0x221) {
      const range = { startRow: data.u16(0), endRow: data.u16(2), startColumn: data.u8(4), endColumn: data.u8(5) };
      if (range.endRow < range.startRow || range.endColumn < range.startColumn || !lastFormula) invalidBiff("invalid shared/array formula group");
      if (lastFormula.cell.row < range.startRow || lastFormula.cell.row > range.endRow ||
        lastFormula.cell.column < range.startColumn || lastFormula.cell.column > range.endColumn ||
        range.endRow >= (ver >= 8 ? 65536 : 16384)) invalidBiff("invalid shared/array formula group");
      if (++groupCount > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert BIFF formula group limit exceeded");
      const kind = opcode === 0x4bc ? "shared" : "array", start = ver > 4 && kind === "array" ? 14 : 10;
      const tokens = data.slice(start, data.u16(start - 2));
      sheet.groups.push({ id: `biff-${sheet.offset}-${record.offset}`, kind, range, tokens, keyRow: lastFormula.cell.row, keyColumn: lastFormula.cell.column }); continue;
    }
    if (opcode === 7 || opcode === 0x207) {
      if (!lastFormula) invalidBiff("STRING without FORMULA");
      // Gnumeric accepts historical empty STRING records without a Unicode flag,
      // including records with no length field at all (ms-excel-read.c).
      const length = data.bytes.length === 0 ? 0 : ver === 2 ? data.u8(0) : data.u16(0);
      if (length === 0) {
        const value: CellValue = { kind: "string", value: "" };
        lastFormula.cell = { ...lastFormula.cell, value, cachedResult: value }; lastFormula = undefined; continue;
      }
      const parts = stringParts(index, ver === 2 ? 1 : 2); index = parts.next;
      const cursor = new BiffStrings(parts.parts, context, codepage);
      const value: CellValue = { kind: "string", value: accountText(ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length)) };
      lastFormula.cell = { ...lastFormula.cell, value, cachedResult: value }; lastFormula = undefined; continue;
    }
    if (opcode === 0xe5) {
      const count = data.u16(0); data.check(2, count * 8);
      if (count > context.limits.operations - sheet.merges.length) throw new SsconvertError("resource-limit", "ssconvert BIFF merges limit exceeded");
      for (let i = 0; i < count; i++) {
        const at = 2 + i * 8, range = { startRow: data.u16(at), endRow: data.u16(at + 2), startColumn: data.u16(at + 4), endColumn: data.u16(at + 6) };
        if (range.endRow < range.startRow || range.endColumn < range.startColumn || range.endColumn > 255) invalidBiff("invalid merged range");
        sheet.merges.push(range);
      } continue;
    }
    if (opcode === 0x200 || opcode === 0) { data.check(0, opcode === 0 ? 8 : ver >= 8 ? 14 : 10); continue; }
    if (opcode === 0x208 || opcode === 8) {
      const flags = data.bytes.length >= 16 ? data.u32(12) : 0;
      sheet.rows.push({ index: data.u16(0), sizePoints: (data.u16(6) & 0x7fff) / 20, hidden: !!(flags & 0x20), outlineLevel: flags & 7, collapsed: !!(flags & 0x10) }); continue;
    }
    if (opcode === 0x7d) {
      const first = data.u16(0), last = data.u16(2), flags = data.u16(8);
      if (last < first || last > 256) invalidBiff("invalid column range");
      for (let column = first; column <= Math.min(last, 255); column++) sheet.columns.push({ index: column,
        sizePoints: data.u16(4) / 256 * 5.25, hidden: !!(flags & 1), outlineLevel: flags >> 8 & 7, collapsed: !!(flags & 0x1000) }); continue;
    }
    if (opcode === 0x12 || opcode === 0x63 || opcode === 0xdd) { sheet.view.protected = !!data.u16(0); await retain(record, sheet.unsupportedRecords, false); continue; }
    if (opcode === 0x13) { data.check(0, 2); await retain(record, sheet.unsupportedRecords, false); continue; }
    if (opcode === 0x14 || opcode === 0x15) {
      if (!data.bytes.length) continue;
      const length = ver >= 8 ? data.u16(0) : data.u8(0), cursor = new BiffStrings([new Binary(data.slice(ver >= 8 ? 2 : 1, data.bytes.length - (ver >= 8 ? 2 : 1)))], context, codepage);
      const text = accountText(length ? ver >= 8 ? cursor.unicode(length).text : cursor.legacy(length) : "");
      sheet.view[opcode === 0x14 ? "printHeader" : "printFooter"] = text; await retain(record, sheet.unsupportedRecords, false); continue;
    }
    if (opcode >= 0x26 && opcode <= 0x29) {
      const value = data.f64(0); if (!Number.isFinite(value)) invalidBiff("invalid print margin");
      sheet.view[["marginLeft", "marginRight", "marginTop", "marginBottom"][opcode - 0x26]!] = value; await retain(record, sheet.unsupportedRecords, false); continue;
    }
    if (biffMetadataOpcodes.has(opcode)) { await retain(record, sheet.unsupportedRecords, false); continue; }
    await retain(record, sheet.unsupportedRecords);
  }
  if (scopes.length) invalidBiff("missing EOF");
  for (const bound of boundSheets) {
    if (!records.some(record => record.offset === bound.offset && bofOpcodes.has(record.opcode))) invalidBiff("BOUNDSHEET offset is not a BOF");
    if (bound.type === 0 && !sheets.some(sheet => sheet.offset === bound.offset)) invalidBiff("missing declared worksheet");
  }
  sheets.sort((a, b) => {
    const ai = boundSheets.findIndex(sheet => sheet.offset === a.offset), bi = boundSheets.findIndex(sheet => sheet.offset === b.offset);
    return ai < 0 || bi < 0 ? a.offset - b.offset : ai - bi;
  });
  const externalSheets = externalReferences.map(ref => {
    if (supbooks[ref.book]?.kind !== "local") return undefined;
    const first = sheets[ref.first]?.name, last = sheets[ref.last]?.name;
    if (first === undefined || last === undefined) return undefined;
    return ref.first === ref.last ? first : [first, last] as const;
  });
  const externalNameSheets = externalReferences.map(ref => supbooks[ref.book]?.kind !== "local" ? undefined : ref.first >= 0xfffe ? null : sheets[ref.first]?.name);
  const deletedExternalSheets = externalReferences.map(ref => supbooks[ref.book]?.kind === "local" && (ref.first === 0xffff || ref.last === 0xffff));
  const unavailableExternalSheets = externalReferences.map(ref => supbooks[ref.book]?.kind === "external");
  const localSheets = sheets.map(sheet => sheet.name);
  const nameSheets = names.map(name => {
    if (!name.sheetIndex) return undefined;
    return (name.revision >= 8 ? sheets[name.sheetIndex - 1]?.name : (name.owner?.legacyExternalSheets ?? legacyExternalSheets)[name.sheetIndex - 1]) ?? undefined;
  });
  const externalNameTables = new Map<PendingExternalName[], readonly ({ name: string; expression?: string } | undefined)[]>();
  const formulaNames = names.map(name => name.name);
  const nameBindings = new BiffNameBindings(context, sheets);
  const formula = (tokens: Uint8Array, revision: number, cp: number, row = 0, column = 0, owner?: PendingSheet, shared = false,
    resolveName = nameBindings.resolve, globalNameDefinition = false) => translateBiffFormula(tokens, {
    revision, codepage: cp, row, column, names: formulaNames, resolveName, externalSheets: revision >= 8 ? externalSheets : owner?.legacyExternalSheets ?? legacyExternalSheets,
    ...(owner ? { currentSheet: owner.name } : {}), shared, globalNameDefinition, localSheets, nameSheets, deletedExternalSheets, unavailableExternalSheets, externalNameSheets,
    externalNames: revision >= 8 ? modernExternalNames : legacyNameBindings.get(owner)!,
    limit: context.limits.workbookWork ?? context.limits.inputBytes * 8 });
  const externalTables = [
    ...supbooks.filter(book => book.kind !== "local").map(book => book.names),
    ...(legacyAddinSheets.size ? [legacyExternalNames] : []),
    ...sheets.filter(sheet => sheet.legacyAddinSheets.size > 0).map(sheet => sheet.legacyExternalNames)
  ];
  const globals = new Map(names.filter(name => name.sheetIndex === 0).map(name => [name.name, name]));
  for (const table of externalTables) {
    const entries: ({ name: string; expression?: string } | undefined)[] = [];
    for (const name of table) {
      if (!name.supported) { entries.push({ name: name.name }); continue; }
      const global = globals.get(name.name);
      if (global && global.record.offset < name.record.offset) {
        const placeholder = global.tokens.length === 0 || global.tokens.length === 2 && global.tokens[0] === 0x1c && global.tokens[1] === 29;
        if (!placeholder) { entries.push(undefined); continue; }
        // Native EXTERNNAME reuses an existing linked #NAME placeholder. Its
        // expression changes, while all indexed references keep the same object.
        global.tokens = name.tokens; global.revision = name.revision; global.codepage = name.codepage;
        entries.push({ name: name.name, expression: "=[]" + name.name });
      } else {
        // An unlinked expression is inactive (expr_name_is_active). The symbol
        // is still valid for custom-function255, but value lookup yields #REF!.
        entries.push({ name: name.name, expression: "=#REF!" });
      }
    }
    externalNameTables.set(table, entries);
  }
  const modernExternalNames = externalReferences.map(ref => {
    const book = supbooks[ref.book];
    return book ? externalNameTables.get(book.names) : undefined;
  });
  const legacyNameBindings = new Map<PendingSheet | undefined, NonNullable<BiffFormulaContext["externalNames"]>>();
  for (const owner of [undefined, ...sheets]) {
    const namespaces = owner?.legacyAddinSheets ?? legacyAddinSheets;
    const table = externalNameTables.get(owner?.legacyExternalNames ?? legacyExternalNames);
    legacyNameBindings.set(owner, (owner?.legacyExternalSheets ?? legacyExternalSheets).map((_, at) => namespaces.has(at) ? table : undefined));
  }
  const materializedNames: NamedExpression[] = [];
  for (const [at, name] of names.entries()) {
    if (name.sheetIndex && nameSheets[at] === undefined) invalidBiff("invalid name sheet scope");
    try {
      nameBindings.define(at + 1, name.name, nameSheets[at], resolve => name.tokens.length ?
        formula(name.tokens, name.revision, name.codepage, 0, 0, name.owner, false, resolve, !name.sheetIndex) : "=#NAME?");
    }
    catch (error) {
      if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
      await retain(name.record, unsupported, false);
      unsupported.push({ source: "biff", kind: "untranslated-name", disposition: "retained", data: { name: name.name } });
      await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: error.message });
    }
  }
  const finalizedNames = nameBindings.finish();
  // Implicit sheet names also shadow global names when rendering indexed references.
  for (const name of finalizedNames.defaults) {
    formulaNames.push(name.name);
    nameSheets.push(name.sheet);
  }
  for (const index of finalizedNames.indices) {
    const at = index - 1;
    const name = names[at]!;
    materializedNames.push({ name: name.name, expression: nameBindings.expression(at + 1),
      ...(name.sheetIndex ? { sheet: nameSheets[at] ?? invalidBiff("invalid name sheet scope") } : {}) });
  }
  materializedNames.push(...finalizedNames.defaults);
  const color = (index: number): string => {
    const rgb = index === 0x7fff || index === 64 ? "000000" : index === 65 ? "FFFFFF" :
      index < 8 ? defaultPalette[index] ?? "000000" : palette[index - 8] ?? "000000";
    return [0, 2, 4].map(at => { const byte = rgb.slice(at, at + 2); return byte === "00" ? "0" : (byte + byte).toUpperCase(); }).join(":");
  };
  const style = (index: number): { format?: string; style?: Readonly<Record<string, ImportedValue>> } => {
    const xf = xfTable[index]; if (!xf) return {};
    const data = xf.data;
    const legacy = xf.revision < 5;
    data.check(0, legacy ? xf.revision >= 3 ? 12 : 4 : xf.revision >= 8 ? 20 : 16);
    const font = fontTable[legacy ? data.u8(0) : data.u16(0)], format = formatTable.get(legacy ? xf.revision >= 3 ? data.u8(1) : data.u8(2) & 63 : data.u16(2)) ?? "General";
    const flags = legacy ? xf.revision >= 3 ? data.u8(2) : data.u8(1) >> 6 : data.u16(4), alignment = data.u8(legacy ? xf.revision >= 3 ? 4 : 3 : 6);
    const attrs: Record<string, ImportedValue> = { Locked: flags & 1 ? 1 : 0, Hidden: flags & 2 ? 1 : 0, WrapText: alignment & 8 ? 1 : 0,
      HAlign: ["GNM_HALIGN_GENERAL", "GNM_HALIGN_LEFT", "GNM_HALIGN_CENTER", "GNM_HALIGN_RIGHT", "GNM_HALIGN_FILL", "GNM_HALIGN_JUSTIFY", "GNM_HALIGN_CENTER_ACROSS_SELECTION", "GNM_HALIGN_DISTRIBUTED"][alignment & 7]!,
      VAlign: ["GNM_VALIGN_TOP", "GNM_VALIGN_CENTER", "GNM_VALIGN_BOTTOM", "GNM_VALIGN_JUSTIFY", "GNM_VALIGN_DISTRIBUTED"][alignment >> 4 & 7] ?? "GNM_VALIGN_BOTTOM",
      Fore: color(font?.color ?? 0x7fff) };
    if (xf.revision >= 8) {
      const rotation = data.u8(7), text = data.u8(8), fill = data.u16(18);
      attrs.Rotation = rotation === 255 ? -1 : rotation > 90 ? 450 - rotation : rotation;
      attrs.Indent = text & 15; attrs.ShrinkToFit = text & 16 ? 1 : 0;
      attrs.PatternColor = color(fill & 127); attrs.Back = color(fill >> 7 & 127); attrs.Shade = data.u32(14) >>> 26;
    } else if (xf.revision >= 5) {
      const fill = data.u16(8), packed = data.u16(10);
      attrs.PatternColor = color(fill & 127); attrs.Back = color(fill >> 7 & 127); attrs.Shade = packed & 63;
      attrs.Rotation = [0, -1, 90, 270][data.u8(7) & 3]!;
    } else if (xf.revision >= 3) {
      const fill = data.u16(6);
      const remap = (id: number) => id >= 24 ? id + 40 : id;
      attrs.PatternColor = color(remap(fill >> 6 & 31)); attrs.Back = color(remap(fill >> 11 & 31)); attrs.Shade = fill & 63;
      attrs.VAlign = xf.revision >= 4 ? ["GNM_VALIGN_TOP", "GNM_VALIGN_CENTER", "GNM_VALIGN_BOTTOM"][alignment >> 4 & 3] ?? "GNM_VALIGN_BOTTOM" : "GNM_VALIGN_BOTTOM";
    }
    const borders: ImportedValue[] = [];
    if (xf.revision >= 8) {
      const edges = data.u16(10), sideColors = data.u16(12), rest = data.u32(14);
      for (const [name, shift, index] of [["Left", 0, sideColors & 127], ["Right", 4, sideColors >> 7 & 127],
        ["Top", 8, rest & 127], ["Bottom", 12, rest >>> 7 & 127]] as const) {
        const Style = edges >> shift & 15; if (Style) borders.push(node(name, { Style, Color: color(index) }));
      }
      const diagonal = rest >>> 21 & 15;
      if (diagonal && sideColors & 0x4000) borders.push(node("Diagonal", { Style: diagonal, Color: color(rest >>> 14 & 127) }));
      if (diagonal && sideColors & 0x8000) borders.push(node("RevDiagonal", { Style: diagonal, Color: color(rest >>> 14 & 127) }));
    } else if (xf.revision >= 5) {
      const bottom = data.u16(10), edges = data.u16(12), sideColors = data.u16(14);
      for (const [name, Style, index] of [["Bottom", bottom >> 6 & 7, bottom >> 9 & 127], ["Top", edges & 7, edges >> 9 & 127],
        ["Left", edges >> 3 & 7, sideColors & 127], ["Right", edges >> 6 & 7, sideColors >> 7 & 127]] as const)
        if (Style) borders.push(node(name, { Style, Color: color(index) }));
    }
    return { format, style: { biff: { xf: index, revision: xf.revision }, gnumeric: node("Style", attrs, "",
      [...(font ? [node("Font", font.attributes, font.name)] : []), ...(borders.length ? [node("StyleBorder", {}, "", borders)] : [])]) } };
  };
  const resultSheets = [];
  let activeSheet: string | undefined;
  for (const sheet of sheets) {
    const metadata = readBiffMetadata(sheet.records, sheet.revision, sheet.codepage, context);
    sheet.unsupportedRecords.push(...metadata.records); Object.assign(sheet.view, metadata.view);
    if (metadata.active) activeSheet = sheet.id;
    const cells: Cell[] = [];
    const formulaGroups: FormulaGroup[] = [];
    for (const group of sheet.groups) {
      try { formulaGroups.push({ id: group.id, kind: group.kind, range: group.range,
        expression: formula(group.tokens, sheet.revision, sheet.codepage, group.range.startRow, group.range.startColumn, sheet, group.kind === "shared") }); }
      catch (error) { if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: error.message }); }
    }
    for (const pending of sheet.cells) {
      context.signal.throwIfAborted(); let cell = pending.cell;
      if (pending.tokens) {
        try {
          let tokens = pending.tokens;
          let formulaRow = cell.row, formulaColumn = cell.column, shared = false;
          if (tokens[0] === 1) {
            if (tokens.length !== (pending.revision >= 3 ? 5 : 4)) invalidBiff("invalid ptgExp length");
            const exp = new Binary(tokens), row = exp.u16(1), column = pending.revision >= 3 ? exp.u16(3) : exp.u8(3);
            const group = sheet.groups.find(group => group.keyRow === row && group.keyColumn === column);
            if (!group) invalidBiff("unresolved shared/array formula");
            if (cell.row < group.range.startRow || cell.row > group.range.endRow || cell.column < group.range.startColumn || cell.column > group.range.endColumn)
              invalidBiff("formula outside group range");
            tokens = group.tokens;
            shared = group.kind === "shared";
            if (formulaGroups.some(materialized => materialized.id === group.id)) cell = { ...cell, formulaGroup: group.id };
            if (group.kind === "array") { formulaRow = group.range.startRow; formulaColumn = group.range.startColumn; }
          }
          cell = { ...cell, formula: formula(tokens, pending.revision, pending.codepage, formulaRow, formulaColumn, sheet, shared) };
        }
        catch (error) {
          if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
          sheet.unsupportedRecords.push({ source: "biff", kind: "untranslated-formula", disposition: "retained", data: {
            row: cell.row, column: cell.column, tokens: Array.from(pending.tokens, byte => byte.toString(16).padStart(2, "0")).join("") } });
          await context.diagnostic?.({ code: "biff-loss-warning", severity: "warning", message: error.message });
        }
      }
      cells.push({ ...cell, ...style(pending.xf) });
    }
    resultSheets.push({ id: sheet.id, name: sheet.name, cells, visibility: sheet.visibility,
      size: { rows: sheet.cells.some(cell => cell.revision >= 8) || ver >= 8 ? 65536 : 16384, columns: 256 },
      ...(sheet.merges.length ? { merges: sheet.merges } : {}), ...(sheet.rows.length ? { rows: sheet.rows } : {}),
      ...(sheet.columns.length ? { columns: sheet.columns } : {}), ...(Object.keys(sheet.view).length ? { view: sheet.view } : {}),
      ...(formulaGroups.length ? { formulaGroups } : {}),
      ...(sheet.unsupportedRecords.length ? { unsupportedRecords: sheet.unsupportedRecords } : {}) });
  }
  return { sheets: resultSheets, dateSystem, calculationMode, iteration: { enabled: iterationEnabled, maximum, tolerance },
    ...(activeSheet === undefined ? {} : { activeSheet }),
    ...(materializedNames.length ? { names: materializedNames } : {}), ...(unsupported.length ? { unsupportedRecords: unsupported } : {}) };
}

function rk(bits: number): number {
  let value: number;
  if (bits & 2) value = bits >> 2;
  else { const bytes = new Uint8Array(8), view = new DataView(bytes.buffer); view.setUint32(4, bits & 0xfffffffc, true); value = view.getFloat64(0, true); }
  if (!Number.isFinite(value)) invalidBiff("nonfinite RK number"); return bits & 1 ? value / 100 : value;
}
