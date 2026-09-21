// Released Gnumeric 1.12.61 lotus.c lotus_read_works; GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1, type Cell, type CellValue, type ImportedValue, type Workbook } from "../workbook.js";
import { Binary } from "./biff-binary.js";
import { biffDecode } from "./biff-strings.js";
export type WorksFormulaReader = (tokens: Uint8Array, row: number, column: number, sheet: number, name: (index: number) => string, tick: () => void) => Promise<string>;
const colors = ["#000000", "#000000", "#0000FF", "#00FFFF", "#00FF00", "#FF00FF", "#FF0000", "#FFFF00", "#808080", "#FFFFFF", "#000080", "#008080", "#008000", "#800080", "#800000", "#C0C0C0"];
function format(code: number): string {
  const type = code & 15, precision = code >> 5 & 7, decimal = precision ? "." + "0".repeat(precision) : "";
  if ([0, 1, 2, 3].includes(type)) return "0" + decimal + (type === 1 ? "E+00" : type === 3 ? "%" : "");
  if (type === 4) return "# ##0" + decimal;
  if (type === 5) return ["", "", "h:mm AM/PM", "h:mm:ss AM/PM", "h:mm", "h:mm:ss"][precision] ?? "";
  if (type === 6) return ["dd.mm.yyyy", "d mmmm yyyy", "dd.yyyy", "mmmm yyyy", "dd.mm", "d mmmm", "dd-mm-yy", "mmmm"][precision]!;
  if (type === 10) return "0".repeat(precision + 1);
  if (type === 11 && precision < 2) return precision ? "# ?/3" : "# ?/2";
  if (type === 11 || type === 12) return ["# ??/??", "# ?/4", "#", "# ?/8", "# ?/10", "# ?/16", "# ?/32", "# ?/100"][precision]!;
  if (type === 13 || type === 14) return "# ##0" + decimal + ";[Red]-# ##0" + decimal;
  return "";
}
function fontCodepage(name: string): number {
  const families = ["times new roman", "arial", "courier new"], suffixes: Record<string, number> = { cyr: 1251, greek: 1253, tur: 1254, baltic: 1257 };
  const lower = name.toLowerCase();
  for (const family of families) for (const [suffix, codepage] of Object.entries(suffixes)) if (lower === `${family} ${suffix}`) return codepage;
  return lower === "gulimche" ? 949 : 1252;
}
function decode(data: Uint8Array, codepage: number): CellValue {
  try { return { kind: "string", value: biffDecode(data, codepage) }; }
  catch (error) { if (error instanceof SsconvertError && error.code === "io") return { kind: "blank" }; throw error; }
}
export async function readLotusWorks(bytes: Uint8Array, context: CapabilityContext, formula: WorksFormulaReader,
  decodeLmbcs: (bytes: Uint8Array) => Promise<string>): Promise<Workbook> {
  const b = new Binary(bytes), sheets: { name: string; cells: Map<string, Cell> }[] = [];
  const fonts: { name: string; variant: number; size: number; codepage: number }[] = [], styles: { style: Record<string, ImportedValue>; format: string; codepage: number }[] = [];
  let at = 0, active = -1, work = 0, count = 0, outside = false;
  const tick = () => { context.signal.throwIfAborted(); if (++work > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert Lotus operations limit exceeded"); };
  const warn = async (message: string) => context.diagnostic?.({ code: "lotus", severity: "warning", message });
  while (at + 4 <= bytes.length) {
    tick(); const id = b.u16(at); let length = b.u16(at + 2); at += 4;
    if (at + length > bytes.length) { await warn("Truncated record.  File is probably corrupted.\n"); length = 0; }
    const data = new Binary(b.slice(at, length)); at += length;
    if (id === 255) { if (sheets.length >= context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert Lotus sheets limit exceeded"); active = sheets.length; sheets.push({ name: formatA1(0, active).slice(0, -1), cells: new Map() }); continue; }
    if (id === 1) { active = -1; continue; }
    const minima: Record<number, number> = { 0x545b: 10, 14: 14, 15: 8, 12: 6, 16: 16, 0x5456: 38, 0x545a: 10 };
    if (minima[id] === undefined) { await warn(`Unknown record 0x${id.toString(16)} of length ${length}.`); continue; }
    if (length < minima[id]!) { await warn(`Record with type 0x${id.toString(16)} has wrong length ${length}.`); continue; }
    if (id === 0x5456) {
      const nameBytes = data.bytes.subarray(2, 36), zero = nameBytes.indexOf(0), name = new TextDecoder().decode(zero < 0 ? nameBytes : nameBytes.subarray(0, zero));
      fonts.push({ name, variant: data.u16(0), size: data.u8(36), codepage: fontCodepage(name) }); continue;
    }
    if (id === 0x545a) {
      const font = fonts[data.u8(4)], align = data.u8(1), style: Record<string, ImportedValue> = {};
      if (font) {
        for (const [bit, attribute] of [[1, "bold"], [2, "italic"], [4, "underline"], [8, "strike"]] as const) style[attribute] = !!(font.variant & bit);
        if (font.size) style.fontSize = font.size / 2;
        if (font.variant & 240) style.fontColor = colors[font.variant >> 4 & 15]!;
        style.fontName = font.name;
      }
      style.horizontalAlignment = ["general", "left", "center", "right", "fill"][align >> 2 & 7] ?? "general";
      style.verticalAlignment = ["bottom", "center", "top"][align >> 6 & 3] ?? 3;
      if (align & 32) style.wrapText = true;
      styles.push({ style, format: format(data.u8(0)), codepage: font?.codepage ?? 1252 });
      await warn(`Unknown record 0x545a of length ${length}.`); continue;
    }
    if (active < 0) continue;
    const s = sheets[active]!, column = id === 0x545b ? data.u8(0) : data.u16(0), row = data.u16(2), fmt = data.u16(4), importedStyle = styles[fmt];
    if (column >= 256) { if (!outside) { outside = true; await warn("File is most likely corrupted.\n(It claims to contain a cell outside the range Gnumeric can handle.)"); } continue; }
    let value: CellValue = { kind: "blank" }, expression: string | undefined;
    if (id === 14 || id === 16) value = { kind: "number", value: data.f64(6) };
    else if (id === 15) { const text = data.bytes.subarray(6), zero = text.indexOf(0); value = decode(zero < 0 ? text : text.subarray(0, zero), importedStyle?.codepage ?? 1252); }
    else if (id === 0x545b) {
      const raw = data.u32(6), packed = new Uint8Array(4), view = new DataView(packed.buffer);
      view.setUint32(0, ((raw & 0xfc000000) | (raw & 0x3fffffe) << 3) >>> 0, true);
      value = { kind: "number", value: view.getFloat32(0, true) / (raw & 1 ? 100 : 1) };
    }
    if (id === 16) {
      const rawLength = data.u16(14), n = rawLength >= 32768 ? rawLength - 65536 : rawLength;
      if (n < 0 || 16 + n > length) continue;
      expression = await formula(data.bytes.subarray(16, 16 + n), row, column, active, i => sheets[i]?.name ?? "#REF!", tick);
      if ((data.u16(12) & 0x7ff8) === 0x7ff0) {
        value = { kind: "error", value: "#VALUE!" };
        if (at + 4 <= bytes.length && b.u16(at) === 0x33) {
          const nextLength = b.u16(at + 2);
          if (at + 4 + nextLength <= bytes.length && nextLength >= 6) value = { kind: "string", value: await decodeLmbcs(b.slice(at + 10, nextLength - 6)) };
          at += 4 + nextLength;
        }
      }
    }
    const key = `${row}:${column}`, old = s.cells.get(key), style = id === 0x545b ? old?.style : importedStyle ? { ...old?.style, ...importedStyle.style } : old?.style;
    const cellFormat = id === 0x545b ? old?.format : importedStyle?.format || old?.format;
    if (!old && ++count > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert Lotus cells limit exceeded");
    s.cells.set(key, { row, column, value, ...(style ? { style } : {}), ...(cellFormat ? { format: cellFormat } : {}), ...(expression ? { formula: expression, cachedResult: value, formulaDirty: false } : {}) });
  }
  context.signal.throwIfAborted();
  if (!sheets.length) throw new SsconvertError("io", "Error while reading lotus workbook.");
  return { sheets: sheets.map((s, i) => ({ id: `lotus-${i}`, name: s.name, size: { rows: 65536, columns: 256 }, cells: [...s.cells.values()].sort((a, b) => a.row - b.row || a.column - b.column) })), activeSheet: "lotus-0" };
}
