// Gnumeric 1.12.61 plugins/plan-perfect/pln.c; GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1, type AxisMetadata, type CellValue, type Workbook } from "../workbook.js";
import { Binary } from "./biff-binary.js";
import { legacyCells, legacyExpression } from "./legacy-records.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { wpCharsets } from "./pln-charset.js";
import { plnFunctions } from "./pln-functions.js";

export function probePln(bytes: Uint8Array, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  return [255, 87, 80, 67, 16, 0, 0, 0, 9, 10].every((c, i) => bytes[i] === c);
}
function wpText(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i++]!;
    if (c >= 32 && c <= 126) text += String.fromCharCode(c);
    else if (c === 0xc0) {
      if (i + 2 >= bytes.length) break;
      const code = wpCharsets[bytes[i + 1]!] ? wpCharsets[bytes[i + 1]!]![bytes[i]!] ?? 0 : 0;
      if (!code || code >= 0xf000) return "";
      text += String.fromCharCode(code); i += 3;
    } else if (c === 0xc3 || c === 0xc4) i += 2;
  }
  return text;
}
function plnStyle(data: Binary, offset: number) {
  const attr = data.u16(offset);
  return { HAlign: [1, 2, 4, 8][attr >> 8 & 3]!,
    italic: !!(attr & 16), hidden: !!(attr & 32), underline: attr & 4096 ? 2 : attr & 64 ? 1 : 0, bold: !!(attr & 128) };
}

async function expression(bytes: Uint8Array, row: number, column: number, context: CapabilityContext, consumeOperation: () => void): Promise<string> {
  const b = new Binary(bytes);
  if (bytes.length < 2 || b.u16(0) > bytes.length - 2) return "";
  const end = b.u16(0) + 2;
  let at = 2, result = "";
  const tokens: Readonly<Record<number, string>> = { 1: "+", 2: "-", 3: "*", 4: "/", 5: "-", 6: "%", 7: "SUM(",
    11: "^", 14: "?+?", 15: "_MOD_", 16: "_NOT_", 17: "_AND_", 18: "_OR_", 19: "_XOR_", 20: "IF(",
    22: ",", 23: "(", 24: ")", 26: "??ERROR??", 29: "<>1", 35: "0.", 36: "{", 37: ")", 38: "FACTORIAL", 39: "LOOKUP<", 40: "LOOKUP>" };
  const address = (p: number) => {
    const r = b.u16(p), c = b.u16(p + 2);
    const coordinate = (v: number, base: number) => {
      const relative = (v & 0xc000) === 0 || (v & 0xc000) === 0xc000;
      return { relative, value: (v & 0xc000) === 0xc000 ? v - 65536 + base : (v & 0x3fff) + (relative ? base : 0) };
    };
    const rr = coordinate(r, row), cc = coordinate(c, column);
    if (rr.value < 0 || cc.value < 0) return "#REF!";
    const a = formatA1(rr.value, cc.value); let i = 0; while (a[i]! >= "A" && a[i]! <= "Z") i++;
    return (cc.relative ? "" : "$") + a.slice(0, i) + (rr.relative ? "" : "$") + a.slice(i);
  };
  const require = (length: number) => {
    if (at + length > end) throw new SsconvertError("io", "PLN : Truncated formula");
  };
  while (at < end) {
    context.signal.throwIfAborted();
    consumeOperation();
    const code = b.u8(at++);
    if (tokens[code] !== undefined) { result += tokens[code]; continue; }
    if (code === 9 || code === 10 || code === 32) {
      require(1); const length = b.u8(at++); require(length);
      const text = wpText(b.slice(at, length)); at += length;
      result += code === 9 ? '"' + text.split('"').join('""') + '"' : code === 32 ? "_unknown32_" : text;
    } else if (code === 12 || code === 13) {
      require(1); const n = b.u8(at++); result += plnFunctions[code - 12]![n] ?? "ERROR";
    } else if (code === 21) {
      require(1); const n = b.u8(at++), op = ["", "=", "<>", ">", ">=", "<", "<="][n];
      if (op !== undefined) result += op;
      else await context.diagnostic?.({ code: "pln", severity: "warning", message: `unknown comparative operator ${n}` });
    } else if (code === 25) { require(1); result += " ".repeat(b.u8(at++)); }
    else if (code === 27 || code === 28) { require(code === 27 ? 4 : 8); result += address(at) + (code === 28 ? `:${address(at + 4)}` : ""); at += code === 27 ? 4 : 8; }
    else if (code === 30) { require(9); const length = b.u8(at + 8); at += 9; require(length); result += wpText(b.slice(at, length)); at += length; }
    else if (code === 33 || code === 34) { require(2); const length = b.u8(at + 1); at += 2; require(length); result += `_unknown${code}_` + wpText(b.slice(at, length)); at += length; }
    else if (code === 31 || code === 41 || code === 42 || code === 46) { require(1); at++; if (code === 31) result += "_unknown31_"; }
    else if (code === 43) { require(2); at += 2; }
    else if (code !== 44 && code !== 45) await context.diagnostic?.({ code: "pln", severity: "warning", message: `PLN: Undefined formula code ${code}` });
    if (result.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert PLN formula length limit exceeded");
  }
  return result;
}

export async function readPln(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  if (context.limits.sheets < 1) throw new SsconvertError("resource-limit", "ssconvert PLN sheets limit exceeded");
  const b = new Binary(new Uint8Array(bytes)), cells = legacyCells(context, "PlanPerfect"), columns: AxisMetadata[] = [];
  if (bytes.length < 16 || b.u16(12)) throw new SsconvertError("io", "PLN : Spreadsheet is password encrypted");
  let at = 16, maxColumn = 256;
  let formulaWork = 0;
  const consumeOperation = () => {
    if (++formulaWork > context.limits.operations)
      throw new SsconvertError("resource-limit", "ssconvert PLN formula operations limit exceeded");
  };
  while (at + 4 <= bytes.length) {
    context.signal.throwIfAborted();
    const code = b.u16(at), length = b.u16(at + 2); at += 4;
    if (at + length > bytes.length) break;
    if (code === 1 && length >= 4) maxColumn = b.u16(at + 2);
    else if (code === 3) {
      for (let i = 0; i < Math.floor(length / 6) && i <= maxColumn; i++) {
        columns.push({ index: i, sizePoints: (b.u16(at + i * 6 + 4) & 255) * 8, style: plnStyle(b, at + i * 6) });
      }
    }
    at += length; if (code === 25) break;
  }
  while (at + 20 <= bytes.length) {
    context.signal.throwIfAborted();
    const row = b.u16(at), column = b.u16(at + 2), type = b.u16(at + 12), length = b.u16(at + 18);
    if (row === 65535) break;
    if (row > 65536) throw new SsconvertError("io", `Ignoring data that claims to be in row ${row} which is > max row 65536`);
    if (column > maxColumn) throw new SsconvertError("io", `Ignoring data that claims to be in column ${column} which is > max column ${maxColumn}`);
    const start = at; at += 20;
    let value: CellValue = { kind: "blank" };
    const kind = type & 7;
    if (kind === 0 && length === 0) continue;
    if (kind === 0) await context.diagnostic?.({ code: "pln", severity: "warning", message: "an empty unformated cell has an expression ?" });
    if (kind === 0 || kind === 1) {
      const exponent = b.u8(start + 4); let n = 0, scale = 256;
      for (let i = 1; i <= 7; i++) { n += b.u8(start + 4 + i) / scale; scale *= 256; }
      value = { kind: "number", value: n * (exponent & 128 ? -1 : 1) * 2 ** (((exponent & 127) - 64) * 4) };
    } else if (kind === 2) value = { kind: "string", value: wpText(b.slice(start + 5, Math.min(b.u8(start + 4), 15))) };
    else if (kind === 3) {
      const n = b.u16(start + 4);
      if (at + n > bytes.length) break;
      if (n >= 2 && b.u16(at) <= n - 2) value = { kind: "string", value: wpText(b.slice(at + 2, b.u16(at))) };
      at += n;
    } else if (kind === 4 || kind === 5) value = { kind: "error", value: kind === 4 ? "#VALUE!" : "#N/A" };
    let formula: string | undefined;
    if (length) {
      if (at + length > bytes.length) break;
      if (kind !== 6) {
        const text = await expression(b.slice(at, length), row, column, context, consumeOperation);
        const parsed = legacyExpression(text, gnumericGrammar, { sheet: "PlanPerfect", row, column }, context);
        if (parsed.ok) formula = parsed.formula; else value = { kind: "string", value: text };
      }
      at += length;
    }
    if (column >= 256) continue;
    cells.put({ row, column, value, ...(kind ? { style: plnStyle(b, start) } : {}),
      ...(formula === undefined ? {} : { formula, cachedResult: value, formulaDirty: false }) });
  }
  return { sheets: [{ id: "PlanPerfect", name: "PlanPerfect", size: { rows: 65536, columns: 256 }, cells: cells.finish(), columns }], activeSheet: "PlanPerfect" };
}
