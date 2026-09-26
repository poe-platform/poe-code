import { SsconvertError } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, MAX_SHEET_SIZE, snapshotWorkbook, type Cell, type CellValue } from "../workbook.js";
import type { FunctionHost, Matrix, Reference } from "./functions/types.js";
import type { RuntimeFunctionResult } from "./runtime-functions.js";

/** Own cooperative port values while preserving invocation-owned reference identity. */
export function snapshotRuntimeResult(result: RuntimeFunctionResult, host: FunctionHost): RuntimeFunctionResult {
  const kind = result !== null && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "kind")?.value : undefined;
  if (kind === "matrix") {
    const matrix = result as Matrix;
    const rowsField = Object.getOwnPropertyDescriptor(matrix, "rows");
    if (!rowsField || !Object.hasOwn(rowsField, "value") || !Array.isArray(rowsField.value) || !rowsField.value.length)
      throw new SsconvertError("invalid-request", "Invalid ssconvert runtime matrix");
    const rows = rowsField.value as Matrix["rows"];
    if (rows.length > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert runtime matrix cell limit exceeded");
    const first = Object.getOwnPropertyDescriptor(rows, "0");
    if (!first || !Object.hasOwn(first, "value") || !Array.isArray(first.value) || !first.value.length)
      throw new SsconvertError("invalid-request", "Invalid ssconvert runtime matrix");
    const width = first.value.length;
    if (width > host.context.limits.cells / rows.length) throw new SsconvertError("resource-limit", "ssconvert runtime matrix cell limit exceeded");
    if (rows.length > MAX_SHEET_SIZE.rows || width > MAX_SHEET_SIZE.columns)
      throw new SsconvertError("resource-limit", "ssconvert runtime matrix axis limit exceeded");
    const cells: Cell[] = [];
    for (let row = 0; row < rows.length; row++) {
      host.tick();
      const field = Object.getOwnPropertyDescriptor(rows, String(row));
      if (!field || !Object.hasOwn(field, "value") || !Array.isArray(field.value) || field.value.length !== width)
        throw new SsconvertError("invalid-request", "Invalid ssconvert runtime matrix");
      for (let column = 0; column < width; column++) {
        host.tick();
        const value = Object.getOwnPropertyDescriptor(field.value, String(column));
        if (!value || !Object.hasOwn(value, "value")) throw new SsconvertError("invalid-request", "Invalid ssconvert runtime matrix");
        cells.push({ row, column, value: value.value as CellValue });
      }
    }
    const owned = snapshotWorkbook({ sheets: [{ id: "runtime", name: "Runtime", size: MAX_SHEET_SIZE, cells }] }, host.context.limits).sheets[0]!.cells;
    return Object.freeze({ kind: "matrix" as const, rows: Object.freeze(Array.from({ length: rows.length }, (_row, index) => {
      host.tick(); return Object.freeze(owned.slice(index * width, (index + 1) * width).map(cell => cell.value));
    })) });
  }
  if (kind === "range") {
    const reference = result as Reference;
    for (const key of ["sheets", "firstRow", "lastRow", "firstColumn", "lastColumn"]) {
      host.tick();
      const field = Object.getOwnPropertyDescriptor(reference, key);
      if (!field || !Object.hasOwn(field, "value")) throw new SsconvertError("invalid-request", "Invalid ssconvert runtime reference");
    }
    if (!Array.isArray(reference.sheets) || !reference.sheets.length ||
        [reference.firstRow, reference.lastRow, reference.firstColumn, reference.lastColumn].some(axis => !Number.isSafeInteger(axis) || axis < 0) ||
        reference.firstRow > reference.lastRow || reference.firstColumn > reference.lastColumn)
      throw new SsconvertError("invalid-request", "Invalid ssconvert runtime reference");
    const area = (reference.lastRow - reference.firstRow + 1) * (reference.lastColumn - reference.firstColumn + 1);
    if (reference.sheets.length > host.context.limits.sheets || area > host.context.limits.cells / reference.sheets.length)
      throw new SsconvertError("resource-limit", "ssconvert runtime reference cell limit exceeded");
    const sheets: Reference["sheets"][number][] = [];
    for (let index = 0; index < reference.sheets.length; index++) {
      host.tick();
      const field = Object.getOwnPropertyDescriptor(reference.sheets, String(index));
      if (!field || !Object.hasOwn(field, "value")) throw new SsconvertError("invalid-request", "Invalid ssconvert runtime reference sheet");
      const sheet = field.value as Reference["sheets"][number];
      if (!host.book.sheets.includes(sheet) && !host.book.detachedSheets?.includes(sheet))
        throw new SsconvertError("invalid-request", "Foreign ssconvert runtime reference sheet");
      const size = sheet.size ?? DEFAULT_SHEET_SIZE;
      if (reference.lastRow >= size.rows || reference.lastColumn >= size.columns)
        throw new SsconvertError("invalid-request", "Invalid ssconvert runtime reference bounds");
      sheets.push(sheet);
    }
    return Object.freeze({ kind: "range" as const, sheets: Object.freeze(sheets), firstRow: reference.firstRow, lastRow: reference.lastRow,
      firstColumn: reference.firstColumn, lastColumn: reference.lastColumn });
  }
  return snapshotWorkbook({ sheets: [{ id: "runtime", name: "Runtime", cells: [
    { row: 0, column: 0, value: result as CellValue }
  ] }] }, host.context.limits).sheets[0]!.cells[0]!.value;
}
