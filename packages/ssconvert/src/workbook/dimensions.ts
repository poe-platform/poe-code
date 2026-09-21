import type { Range, Sheet } from "../workbook.js";
import { DEFAULT_SHEET_SIZE } from "./model.js";

/** Gnumeric sheet_get_cells_extent: blanks count; empty storage has a reversed range. */
export function getCellsExtent(sheet: Sheet): Range {
  const size = sheet.size ?? DEFAULT_SHEET_SIZE;
  let startRow = size.rows - 1,
    startColumn = size.columns - 1,
    endRow = 0,
    endColumn = 0;
  for (const cell of sheet.cells) {
    startRow = Math.min(startRow, cell.row);
    startColumn = Math.min(startColumn, cell.column);
    endRow = Math.max(endRow, cell.row);
    endColumn = Math.max(endColumn, cell.column);
  }
  return Object.freeze({ startRow, startColumn, endRow, endColumn });
}
