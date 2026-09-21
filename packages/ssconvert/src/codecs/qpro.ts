// Gnumeric 1.12.61 plugins/qpro/qpro-read.c; GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Sheet, Workbook } from "../workbook.js";
import { formatA1 } from "../workbook.js";
import { Binary, isCfb, readCfb } from "./biff-binary.js";
import { qproFunctions, qproUnavailableFunctions } from "./qpro-functions.js";

function mainStream(bytes: Uint8Array, context: CapabilityContext): Uint8Array | undefined {
  return isCfb(bytes) ? readCfb(bytes, context).get("PerfectOffice_MAIN") : bytes;
}
export function probeQpro(bytes: Uint8Array, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  try {
    const stream = mainStream(bytes, context);
    if (!stream || stream.length < 6) return false;
    const b = new Binary(stream);
    return b.u16(0) === 0 && b.u16(2) === 2 && [0x1001, 0x1002, 0x1006, 0x1007].includes(b.u16(4));
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof SsconvertError && error.code === "io") return false;
    throw error;
  }
}
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const c of bytes) { if (!c) break; text += String.fromCharCode(c); }
  return text;
}

export async function readQpro(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const stream = mainStream(new Uint8Array(bytes), context);
  const sheets: Sheet[] = [];
  const warn = async (message: string, terminal = message.endsWith("\n") ? message : message + "\n") => {
    await context.diagnostic?.({ code: "qpro", severity: "warning", message,
      bytes: new TextEncoder().encode(terminal) });
    context.signal.throwIfAborted();
  };
  if (!stream) {
    await warn("Unable to find the PerfectOffice_MAIN stream.  Is this really a Quattro Pro file?", "");
    return { sheets };
  }
  const b = new Binary(stream);
  let at = 0, corrupted = false, count = 0, formulaOperations = 0;
  let current: { name: string; cells: Map<string, Cell>; view: Record<string, string | number | boolean> } | undefined;
  async function corrupt() {
    if (!corrupted) { corrupted = true; await warn("File is most likely corrupted.\n"); }
  }
  async function condition(ok: boolean, expression: string): Promise<boolean> {
    if (ok) return true;
    await corrupt(); await warn(`Condition "${expression}" failed.\n`); return false;
  }
  async function next(): Promise<{ id: number; data: Binary } | undefined> {
    context.signal.throwIfAborted();
    if (!await condition(at + 4 <= stream!.length, "data != NULL")) return;
    const id = b.u16(at), length = b.u16(at + 2); at += 4;
    if (length && id !== 837 && id !== 907 && !await condition(length < 0x2000, "*len < 0x2000")) return;
    if (!await condition(at + length <= stream!.length, "data != NULL")) return;
    const data = new Binary(b.slice(at, length)); at += length; return { id, data };
  }
  async function validate(data: Binary, name: string, length: number): Promise<boolean> {
    const actual = data.bytes.length;
    if (length === -1 || (length >= 0 ? actual === length : actual >= -length)) return true;
    await corrupt();
    await warn(`Invalid '${name}' record of length ${actual}${length >= 0 ? ` instead of ${length}` : `, expected at least ${-length}`}\n`);
    return false;
  }
  function put(cell: Cell) {
    const key = `${cell.row}:${cell.column}`, old = current!.cells.get(key);
    if (!old && ++count > context.limits.cells)
      throw new SsconvertError("resource-limit", "ssconvert QPro cells limit exceeded");
    // gnm_cell_assign_value changes only the value, retaining an earlier expr.
    if (!cell.formula && old?.formula) cell = { ...cell, formula: old.formula, cachedResult: cell.value, formulaDirty: old.formulaDirty ?? false };
    current!.cells.set(key, cell);
  }
  function finish() {
    if (!current) return;
    const id = `qpro-${sheets.length}`;
    sheets.push({ id, name: current.name, size: { rows: 65536, columns: 256 },
      cells: [...current.cells.values()].sort((a, b) => a.row - b.row || a.column - b.column), view: current.view });
    current = undefined;
  }
  async function formula(data: Binary, row: number, column: number): Promise<Cell | undefined> {
    const end = data.bytes.length;
    if (!await condition(end >= 14, "end - data >= 14")) return;
    const magic = data.u16(6) & 0x7ff8, offset = data.u16(12);
    let f = 14, refs = f + offset;
    if (!await condition(refs <= end, "refs <= end")) return;
    const stack: string[] = [];
    const ref = (p: number): string => {
      const flags = data.u16(p + 2), raw = data.u8(p), c = raw >= 128 ? raw - 256 : raw, r = flags & 0x1fff;
      const rr = !!(flags & 0x2000), cr = !!(flags & 0x4000);
      const targetRow = rr ? row + (r & 0x1000 ? r - 0x2000 : r) : r;
      const targetCol = cr ? column + c : c;
      if (targetRow < 0 || targetCol < 0) return "#REF!";
      const a1 = formatA1(targetRow, targetCol);
      let split = 0; while (a1[split]! >= "A" && a1[split]! <= "Z") split++;
      return (cr ? "" : "$") + a1.slice(0, split) + (rr ? "" : "$") + a1.slice(split);
    };
    while (f < refs && data.u8(f) !== 3) {
      context.signal.throwIfAborted();
      if (++formulaOperations > context.limits.operations)
        throw new SsconvertError("resource-limit", "ssconvert QPro formula operations limit exceeded");
      const op = data.u8(f++);
      if (op === 0) {
        if (!await condition(refs - f >= 8, "refs - fmla >= 8")) return;
        stack.push(String(data.f64(f))); f += 8;
      } else if (op === 1 || op === 2) {
        const length = op === 1 ? 6 : 10;
        if (!await condition(end - refs >= length, `end - refs >= ${length}`)) return;
        stack.push(ref(refs + 2) + (op === 2 ? `:${ref(refs + 6)}` : "")); refs += length;
      } else if (op === 4) continue;
      else if (op === 5) {
        if (!await condition(refs - f >= 2, "refs - fmla >= 2")) return;
        const n = data.u16(f); stack.push(String(n >= 32768 ? n - 65536 : n)); f += 2;
      } else if (op === 6) {
        const start = f; while (f < refs && data.u8(f)) f++;
        stack.push('"' + latin1(data.slice(start, f - start)).split('"').join('""') + '"'); f++;
      } else if (op === 7) stack.push("");
      else if (op === 8 || op === 22 || op === 23) {
        if (!await condition(stack.length > 0, "stack")) return;
        const a = stack.pop()!;
        stack.push(op === 22 ? `NOT(${a})` : `${op === 8 ? "-" : "+"}(${a})`);
      } else if (op >= 9 && op <= 24) {
        if (!await condition(stack.length >= 2, "stack && stack->next")) return;
        const right = stack.pop()!, left = stack.pop()!;
        const operators = ["+", "-", "*", "/", "^", "=", "<>", "<=", ">=", "<", ">"];
        stack.push(op === 20 || op === 21 ? `${op === 20 ? "AND" : "OR"}(${left},${right})` : `(${left}${op === 24 ? "&" : operators[op - 9]}${right})`);
      } else if (op >= 32 && op <= 161) {
        const [name, args] = qproFunctions[op - 32]!;
        if (!name) { await warn(`QPRO function ${op} is not known.`); continue; }
        if (qproUnavailableFunctions.has(name)) { await warn(`QPRO function ${name.toLowerCase()} is not supported!`); continue; }
        if (args === -1) { await warn(`QPRO function ${name.toLowerCase()} is not supported.`); return; }
        let n = args;
        if (args === -2) {
          if (!await condition(refs - f >= 1, "refs - fmla >= 1")) return;
          n = data.u8(f++);
        }
        const available = Math.min(n, stack.length), missing = n - available;
        const operands = stack.splice(stack.length - available);
        if (missing) {
          const message = `File is probably corrupted.\n(Expression stack is short by ${missing} arguments)`;
          await warn(message, message); operands.unshift(...Array<string>(missing).fill(""));
        }
        stack.push(`${name}(${operands.join(",")})`);
      } else { await corrupt(); await warn(`Operator ${op} encountered.\n`); }
    }
    if (!await condition(f !== refs, "fmla != refs") || !await condition(stack.length > 0, "stack != NULL") ||
      !await condition(stack.length === 1, "stack->next == NULL")) return;
    let value: CellValue = magic === 0x7ff0 ? { kind: "error", value: "#VALUE!" } : { kind: "number", value: data.f64(0) };
    if (magic === 0x7ff8) {
      let cached = await next(); while (cached?.id === 270) cached = await next();
      if (!await condition(cached !== undefined, "data != NULL")) return;
      if (!await condition(cached!.id === 51, "id == QPRO_FORMULA_STRING") || !await condition(cached!.data.bytes.length >= 7, "len >= 7")) return;
      if (!await condition(column === cached!.data.u8(0) && row === cached!.data.u16(2), "col == new_col && row == new_row")) return;
      value = { kind: "string", value: latin1(cached!.data.bytes.subarray(7)) };
    }
    return { row, column, formula: `=${stack[0]}`, value, cachedResult: value, formulaDirty: false };
  }
  for (let r; (r = await next()) !== undefined;) {
    const { id, data } = r, length = data.bytes.length;
    if (!current) {
      if (id === 0) await validate(data, "QPRO_BEGINNING_OF_FILE", 2);
      else if (id === 202) {
        if (sheets.length >= context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert QPro sheets limit exceeded");
        current = { name: formatA1(0, sheets.length).slice(0, -1), cells: new Map(), view: {} };
      } else if (id > 1999) await warn(`Invalid record ${id} of length ${length}`, "");
      if (id === 1) break;
      continue;
    }
    if (id >= 12 && id <= 16) {
      const names = ["QPRO_BLANK_CELL", "QPRO_INTEGER_CELL", "QPRO_FLOATING_POINT_CELL", "QPRO_LABEL_CELL", "QPRO_FORMULA_CELL"];
      const lengths = [6, 8, 14, -7, -20];
      if (!await validate(data, names[id - 12]!, lengths[id - 12]!)) continue;
      const column = data.u8(0), row = data.u16(2);
      if (id === 12) {
        const key = `${row}:${column}`, old = current.cells.get(key);
        if (old?.style) { const { style: ignoredStyle, ...cell } = old; current.cells.set(key, cell); }
        continue;
      }
      if (id === 16) { const cell = await formula(new Binary(data.bytes.subarray(6)), row, column); if (cell) put(cell); continue; }
      if (id === 13 || id === 14) put({ row, column, value: { kind: "number", value: id === 13 ? data.u16(6) : data.f64(6) } });
      else {
        const alignment = data.u8(6), aligns: Record<number, number> = { 39: 2, 94: 8, 34: 4 };
        if (![39, 94, 34, 92, 124, 0].includes(alignment)) await warn("Ignoring unknown alignment\n");
        put({ row, column, value: { kind: "string", value: latin1(data.bytes.subarray(7)) },
          ...(aligns[alignment] === undefined || alignment === 39 ? {} : { style: { HAlign: aligns[alignment]! } }) });
      }
    } else if (id === 203) finish();
    else if (id === 204) current.name = latin1(data.bytes);
    else if (id === 36 && await validate(data, "QPRO_PROTECTION", 1)) current.view.protected = data.u8(0) === 255;
    else if (id >= 210 && id <= 213) await validate(data, id < 212 ? "QPRO_DEFAULT_ROW_HEIGHT" : "QPRO_DEFAULT_COL_WIDTH", 2);
    else if (id === 308 && await validate(data, "QPRO_PAGE_TAB_COLOR", 4)) current.view.tabColor = [...data.bytes.subarray(0, 3)].map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase();
    else if (id === 309 && await validate(data, "QPRO_PAGE_ZOOM_FACTOR", 4) && data.u16(0) === 100) {
      const zoom = data.u16(2);
      if (zoom < 10 || zoom > 400) await warn(`Invalid zoom ${zoom >= 32768 ? zoom - 65536 : zoom} %`, ""); else current.view.zoom = zoom / 100;
    }
  }
  finish();
  return { sheets, ...(sheets[0] ? { activeSheet: sheets[0].id } : {}) };
}
