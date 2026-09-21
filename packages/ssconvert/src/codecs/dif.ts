// Gnumeric 1.12.61 plugins/dif/dif.c (GPL-2.0-or-later).
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, type Cell, type CellValue, type Workbook } from "../workbook.js";
import { recordInput, recordSheet, enteredRecord } from "./record-text.js";
import { documentOutput, documentSheet } from "./document-export.js";
import { gnumericNumber } from "./gnumeric-number.js";
import { renderCellText } from "../formatting.js";

export async function readDif(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = recordInput(bytes, context, "DIF");
  async function next(phase: string): Promise<string> {
    const line = await input.next();
    if (line === undefined) throw new SsconvertError("io", `E Error while reading DIF file.\n  E Unexpected end of file at line ${input.line + 1} while reading ${phase}.`);
    return line;
  }
  async function warning(message: string) { await context.diagnostic?.({ code: "dif-record", severity: "warning", message }); }
  while (true) {
    const topic = await next("header"); await next("header"); await next("header");
    if (topic === "DATA") break;
  }
  let row = -1, column = 0, tooManyRows = false, tooManyColumns = false;
  const cells: Cell[] = [];
  function add(cell: Cell) {
    if (row < 0 || row >= DEFAULT_SHEET_SIZE.rows || column >= DEFAULT_SHEET_SIZE.columns) return;
    if (cells.length >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert DIF cells limit exceeded");
    cells.push(cell);
  }
  while (true) {
    const line = await next("data"), type = parseInt(line, 10) || 0;
    if (type === 0) {
      const comma = line.indexOf(",");
      if (comma < 0) { await warning(`Syntax error at line ${input.line + 1}. Ignoring.`); continue; }
      if (column > DEFAULT_SHEET_SIZE.columns) { tooManyColumns = true; break; }
      let source = line.slice(comma + 1), at = 0;
      while (at < source.length && " \t\r\n\v\f".includes(source[at]!)) at++;
      source = source.slice(at);
      const special = source.toLowerCase(), unsigned = special.startsWith("+") || special.startsWith("-") ? special.slice(1) : special;
      const number = unsigned.startsWith("nan") ? NaN : unsigned.startsWith("inf") ? (special.startsWith("-") ? -Infinity : Infinity) :
        source[0] !== undefined && ("+-0123456789.".includes(source[0])) ? parseFloat(source) || 0 : 0;
      const marker = await next("data");
      let value: CellValue | undefined;
      if (marker === "V") value = Number.isFinite(number) ? { kind: "number", value: number } : { kind: "error", value: "#NUM!" };
      else if (marker === "NA") value = { kind: "error", value: "#N/A" };
      else if (marker === "TRUE" || marker === "FALSE") value = { kind: "boolean", value: marker === "TRUE" };
      else if (marker === "ERROR") await warning(`Unknown value type '${marker}' at line ${input.line + 1}. Ignoring.`);
      if (value) add({ row, column, value });
      column++;
    } else if (type === 1) {
      let text = await next("data");
      if (column > DEFAULT_SHEET_SIZE.columns) { tooManyColumns = true; continue; }
      if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
      add(enteredRecord(text, row, column, context)); column++;
    } else if (type === -1) {
      const marker = await next("data");
      if (marker === "EOD") break;
      if (marker === "BOT") {
        row++; column = 0;
        if (row > DEFAULT_SHEET_SIZE.rows) { tooManyRows = true; break; }
      }
      else await warning(`Unknown data value "${marker}" at line ${input.line + 1}. Ignoring.`);
    } else {
      await warning(`Unknown value type ${type} at line ${input.line + 1}. Ignoring.`); await input.next();
    }
  }
  if (tooManyRows) await warning(`DIF file has more than the maximum number of rows ${DEFAULT_SHEET_SIZE.rows}. Ignoring remaining rows.`);
  if (tooManyColumns) await warning(`DIF file has more than the maximum number of columns ${DEFAULT_SHEET_SIZE.columns}. Ignoring remaining columns.`);
  return { sheets: [{ id: "Sheet1", name: "Sheet1", size: DEFAULT_SHEET_SIZE, cells }], activeSheet: "Sheet1" };
}

export async function writeDif(book: Workbook, _options: readonly string[], context: CapabilityContext): Promise<Uint8Array> {
  const out = documentOutput(context, "DIF"), sheet = recordSheet(book);
  const { cells } = documentSheet(sheet, context, out.tick, false);
  let startRow = Infinity, startColumn = Infinity, endRow = 0, endColumn = 0;
  for (const cell of cells.values()) {
    out.tick(); if ((cell.cachedResult ?? cell.value).kind === "blank") continue;
    startRow = Math.min(startRow, cell.row); startColumn = Math.min(startColumn, cell.column);
    endRow = Math.max(endRow, cell.row); endColumn = Math.max(endColumn, cell.column);
  }
  const r = { startRow: startRow === Infinity ? 0 : startRow, startColumn: startColumn === Infinity ? 0 : startColumn, endRow, endColumn };
  out.put(`TABLE\n0,1\n"GNUMERIC"\nVECTORS\n0,${r.endColumn + 1}\n""\nTUPLES\n0,${r.endRow + 1}\n""\nDATA\n0,0\n""\n`);
  for (let row = r.startRow; row <= r.endRow; row++) {
    out.put("-1,0\nBOT\n");
    for (let column = r.startColumn; column <= r.endColumn; column++) {
      out.tick(); const cell = cells.get(`${row}:${column}`), value = cell?.cachedResult ?? cell?.value;
      if (!value || value.kind === "blank") out.put('1,0\n""\n');
      else if (value.kind === "boolean") out.put(value.value ? "0,1\nTRUE\n" : "0,0\nFALSE\n");
      else if (value.kind === "error") out.put(`0,0\n${value.value === "#N/A" ? "NA" : "ERROR"}\n`);
      else if (value.kind === "number") out.put(`0,${gnumericNumber(value.value, false, 6)}\nV\n`);
      else out.put(`1,0\n"${await renderCellText(cell!, book, context, "preserve")}"\n`);
    }
  }
  out.put("-1,0\nEOD\n"); return out.finish();
}
