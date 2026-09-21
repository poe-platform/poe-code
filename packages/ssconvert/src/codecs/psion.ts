// Psiconv 0.9.9 parse_sheet.c/parse_simple.c and Gnumeric 1.12.61
// plugins/psiconv/psiconv-read.c; GPL-2.0-or-later. JavaScript byte parser.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AxisMetadata, CellValue, Sheet, Workbook } from "../workbook.js";
import { Binary } from "./biff-binary.js";
import { legacyCells } from "./legacy-records.js";
import { parsePsionFormula, renderPsionFormula } from "./psion-formula.js";
import { parsePsionSketchFile } from "./psion-sketch.js";
import { parsePsionPage, type PsionParseJob } from "./psion-page.js";
import { parsePsionCharacterLayout, parsePsionParagraphLayout, psionDefaultCharacter, type PsionCellLayout } from "./psion-layout.js";
import { parsePsionVariables, parsePsionLineLayouts } from "./psion-structures.js";

export function probePsion(bytes: Uint8Array, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  if (bytes.length < 16) return false;
  const b = new Binary(bytes);
  // UID4 is the two interleaved CRC16 checksums of these three exact Sheet UIDs.
  return b.u32(0) === 0x10000037 && b.u32(4) === 0x1000006d && b.u32(8) === 0x10000088 && b.u32(12) === 0x550815a8;
}

export async function readPsion(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  if (!probePsion(bytes, context)) throw new SsconvertError("io", "Error while parsing Psion file.");
  const b = new Binary(new Uint8Array(bytes));
  let work = 0;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert Psion operations limit exceeded");
  };
  function byteCursor(start: number, base = 0) {
    let at = start + base;
    const readText = (length: number): string => {
      const data = b.slice(at, length), characters = new TextDecoder("windows-1252").decode(data).split("");
      for (let i = 0; i < data.length; i++) {
        tick(); const byte = data[i]!;
        // psiconv's default table includes Sheet control substitutions and
        // replaces table entries equal to zero with unknown_unicode_char '?'.
        if (byte === 16) characters[i] = "\u00a0";
        else if (byte <= 5 || byte >= 17 && byte <= 31 ||
          byte === 127 || byte === 129 || byte === 141 || byte === 143 ||
          byte === 144 || byte === 157 || byte === 160) characters[i] = "?";
      }
      at += length;
      return characters.join("");
    };
    return {
      get at() { return at - base; },
      peek() { tick(); return b.u8(at); },
      u8() { tick(); const n = b.u8(at); at++; return n; },
      u16() { tick(); const n = b.u16(at); at += 2; return n; },
      u32(stride = 4) { tick(); const n = b.u32(at); at += stride; return n; },
      s() {
        tick(); const n = b.u8(at);
        if ((n & 3) === 2) { at++; return n >> 2; }
        if ((n & 7) === 5) { const length = b.u16(at) >> 3; at += 2; return length; }
        throw new SsconvertError("io", "Error while parsing Psion file.");
      },
      characters(length: number) { return readText(length); },
      shortText() {
        tick(); const length = b.u8(at++);
        return readText(length);
      },
      x() {
        tick(); const n = b.u8(at);
        if (!(n & 1)) { at++; return n >> 1; }
        if ((n & 3) === 1) { const v = b.u16(at); at += 2; return v >>> 2; }
        if ((n & 7) === 3) { const v = b.u32(at); at += 4; return v >>> 3; }
        throw new SsconvertError("io", "Error while parsing Psion file.");
      },
      text() {
        tick(); const n = b.u8(at); let length: number;
        if ((n & 3) === 2) { length = n >> 2; at++; }
        else if ((n & 7) === 5) { length = b.u16(at) >> 3; at += 2; }
        else throw new SsconvertError("io", "Error while parsing Psion file.");
        return readText(length);
      },
      float() {
        tick(); b.check(at, 8);
        // Preserve psiconv_read_float's implicit leading 1 even for exponent zero.
        // Released parser loops over mantissa bits 51..1, discarding bit 0.
        const exponent = b.u16(at + 6), mantissa = (b.u32(at) & 0xfffffffe) >>> 0;
        const fraction = mantissa + (b.u32(at + 4) & 0xfffff) * 2 ** 32;
        const value = (1 + fraction / 2 ** 52) * (exponent & 32768 ? -1 : 1) * 2 ** (((exponent & 0x7ff0) >> 4) - 1023);
        at += 8; return value;
      }
    };
  }
  type Cursor = ReturnType<typeof byteCursor>;
  function layout(c: Cursor, inherited: PsionCellLayout = { format: "General", style: psionDefaultCharacter }): PsionCellLayout {
    c.u8(); const flags = c.u8();
    if (flags & 1) parsePsionParagraphLayout(c);
    const style = flags & 2 ? parsePsionCharacterLayout(c, inherited.style) : inherited.style;
    if (!(flags & 4)) return { format: inherited.format, ...(style ? { style } : {}) };
    c.u8(); const code = c.u8(), decimals = Math.min(c.u8() >> 1, 30), zeros = decimals ? "." + "0".repeat(decimals) : "";
    if (code === 2 || code === 4 || code === 6 || code === 8 || code === 10)
      return { format: (code === 6 ? "$0" : code === 10 ? "#,##0" : "0") + zeros + (code === 4 ? "E+00" : code === 8 ? "%" : ""), ...(style ? { style } : {}) };
    return { format: ({ 14: "@", 16: "d-mm", 18: "mm-d", 20: "dd-mm-yy", 22: "mm-dd-yy", 24: "yy-mm-dd",
      26: "d mmm", 28: "d mmm yy", 30: "dd mmm yy", 32: "mmm", 34: "mmmm", 36: "mmm yy", 38: "mmmm yy",
      40: "mmmm d, yyyy", 42: "dd-mm-yyyy h:mm AM/PM", 44: "dd-mm-yyyy h:mm", 46: "mm-dd-yyyy h:mm AM/PM",
      48: "mm-dd-yyyy h:mm", 50: "yyyy-mm-dd h:mm AM/PM", 52: "yyyy-mm-dd h:mm",
      54: "h:mm AM/PM", 56: "h:mm:ss AM/PM", 58: "h:mm", 60: "h:mm:ss" } as Record<number, string>)[code] ?? inherited.format, ...(style ? { style } : {}) };
  }
  function grid(offset: number, cursor: (offset: number) => Cursor) {
    const c = cursor(offset);
    const f1 = c.u8(), f2 = c.u8(); c.u8(); c.u8();
    for (let i = 0; i < 4; i++) c.u32();
    const points = () => { const n = c.u32(); return (n >= 2 ** 31 ? n - 2 ** 32 : n) / 20; };
    const sizes = (): AxisMetadata[] => {
      const result: AxisMetadata[] = [], n = c.x();
      if (n > context.limits.operations - work) throw new SsconvertError("resource-limit", "ssconvert Psion grid limit exceeded");
      for (let i = 0; i < n; i++) { const index = c.u32(); result.push({ index, sizePoints: points() }); }
      return result;
    };
    const defaultRowHeight = points(), rows = sizes(), defaultColumnWidth = points(), columns = sizes();
    let breakListLength = 0;
    for (let i = 0; i < 2; i++) {
      const start = c.at, n = c.x(); for (let j = 0; j < n; j++) c.u32();
      breakListLength = c.at - start;
    }
    for (let i = 0; i < 22; i++) c.u8();
    // Released psiconv advances by the previous column break-list length,
    // rather than four, after each frozen-grid u32 read.
    if (f1 & 128 || f2 & 1) for (let i = 0; i < 4; i++) c.u32(breakListLength);
    for (let i = 0; i < 3; i++) c.u8();
    return { rows, columns, defaultRowHeight, defaultColumnWidth };
  }
  let cellsUsed = 0, sheetsUsed = 0;
  function* parseSheet(base: number, tableOffset: number): PsionParseJob {
    const cursor = (offset: number) => byteCursor(offset, base);
    const table = cursor(tableOffset), count = table.u8() >> 1, sections = new Map<number, number>();
    for (let i = 0; i < count; i++) { const id = table.u32(), offset = table.u32(); sections.set(id, offset); }
    if (sections.has(0x100000cd)) throw new SsconvertError("io", "Error while parsing Psion file.");
    for (const id of [0x1000011d, 0x1000011f, 0x10000089, 0x10000105])
      if (!sections.get(id)) throw new SsconvertError("io", "Error while parsing Psion file.");
    const status = cursor(sections.get(0x1000011f)!); status.u8(); status.u32(); status.u32();
    for (let i = 0; i < 4; i++) status.u8(); status.u32(); status.u32();
    const app = cursor(sections.get(0x10000089)!);
    if (app.u32() !== 0x10000088 || app.text().toLowerCase() !== "sheet.app") throw new SsconvertError("io", "Error while parsing Psion file.");
    yield parsePsionPage(sections.get(0x10000105)!, cursor, nestedBase => parseSheet(base + nestedBase, byteCursor(0, base + nestedBase).u32()), nested => parsePsionSketchFile(nested, tick));
    const wb = cursor(sections.get(0x1000011d)!), marker = wb.u8();
    const infoOffset = wb.u32(), formulaOffset = wb.u32(), worksheetsOffset = wb.u32(), variableOffset = wb.u32();
    if (marker === 4) { const name = cursor(wb.u32()); name.u8(); name.text(); }
    const info = cursor(infoOffset); info.u8(); info.x(); info.u8();
    parsePsionVariables(cursor(variableOffset));
    const formulaList = cursor(formulaOffset); formulaList.u8(); const formulaCount = formulaList.x();
    if (formulaCount > context.limits.operations - work) throw new SsconvertError("resource-limit", "ssconvert Psion formulas limit exceeded");
    const formulas = [];
    for (let i = 0; i < formulaCount; i++) formulas.push(parsePsionFormula(formulaList));
    const worksheets = cursor(worksheetsOffset); worksheets.u8(); const number = worksheets.x(), sheets: Sheet[] = [];
    if (number > context.limits.sheets - sheetsUsed) throw new SsconvertError("resource-limit", "ssconvert Psion sheets limit exceeded");
    sheetsUsed += number;
    for (let index = 0; index < number; index++) {
      worksheets.u8(); const worksheet = cursor(worksheets.u32()); worksheet.u8(); worksheet.u8();
      const format = layout(worksheet), rowOffset = worksheet.u32(), colOffset = worksheet.u32(), cellOffset = worksheet.u32(), gridOffset = worksheet.u32(), unknown = worksheet.u32();
      b.check(base + unknown, 4);
      const rowFormats = parsePsionLineLayouts(cursor(rowOffset), format, layout);
      const columnFormats = parsePsionLineLayouts(cursor(colOffset), format, layout);
      const out = legacyCells({ ...context, limits: { ...context.limits, cells: context.limits.cells - cellsUsed } }, "Psion");
      const cells = cursor(cellOffset); cells.u8(); cells.u8(); const n = cells.x();
      if (n > context.limits.operations - work) throw new SsconvertError("resource-limit", "ssconvert Psion cell records limit exceeded");
      for (let i = 0; i < n; i++) {
        const position = cells.u8() | cells.u8() << 8 | cells.u8() << 16, row = position >> 10 & 0x3fff, column = position >> 2 & 255;
        const flags = cells.u8(), type = flags >> 5 & 7;
        let value: CellValue = { kind: "blank" };
        if (type === 1) { const n = cells.u32(); value = { kind: "number", value: n >= 2 ** 31 ? n - 2 ** 32 : n }; }
        else if (type === 2) { cells.u8(); value = { kind: "boolean", value: true }; } // psiconv 0.9.9 uses the nonzero type byte.
        else if (type === 3) cells.u16(); // Gnumeric maps all Psion error values to blank.
        else if (type === 4) value = { kind: "number", value: cells.float() };
        else if (type === 5) value = { kind: "string", value: cells.text() };
        else if (type !== 0) throw new SsconvertError("io", "Error while parsing Psion file.");
        const inheritedFormat = rowFormats.get(row) ?? columnFormats.get(column) ?? format;
        const cellFormat = flags & 16 ? layout(cells, inheritedFormat) : inheritedFormat;
        let formula: string | undefined;
        if (flags & 8) {
          const reference = cells.x(), expression = formulas[formulas.length - reference - 1];
          if (expression !== undefined) formula = renderPsionFormula(expression, row, column, context, tick);
        }
        out.put({ row, column, value, format: cellFormat.format, ...(cellFormat.style ? { style: cellFormat.style } : {}),
          ...(formula === undefined ? {} : { formula, cachedResult: value, formulaDirty: false }) });
      }
      cellsUsed += out.cells.size;
      const dimensions = grid(gridOffset, cursor), name = `Sheet${index}`;
      sheets.push({ id: name, name, size: { rows: 65536, columns: 256 }, cells: out.finish(), rows: dimensions.rows,
        columns: dimensions.columns, view: { defaultRowHeight: dimensions.defaultRowHeight, defaultColumnWidth: dimensions.defaultColumnWidth } });
    }
    return { sheets, ...(sheets[0] ? { activeSheet: sheets[0].id } : {}) };
  }
  try {
    const jobs: PsionParseJob[] = [parseSheet(0, byteCursor(16).u32())];
    let workbook: Workbook | undefined;
    while (jobs.length) {
      const step = jobs.at(-1)!.next();
      if (step.done) { if (jobs.length === 1) workbook = step.value as Workbook; jobs.pop(); }
      else jobs.push(step.value);
    }
    context.signal.throwIfAborted();
    return workbook!;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof SsconvertError && error.code === "io") throw new SsconvertError("io", "Error while parsing Psion file.");
    throw error;
  }
}
