import { snapshotWorkbook, type Cell } from "@poe-code/spreadsheet-ast";
import { createRecordSnapshot } from "@poe-code/spreadsheet-ast/model";
import { SsconvertError, type RuntimeLimits } from "../contracts.js";
import type { WorkbookSource } from "../codecs/types.js";

/** Admit replayable scalar cells with the same aggregate ownership budget as an
 * array workbook. Metadata owns the empty arrays; each index and cell is depth 4.
 * Iteration order replaces the full duplicate-address set for these sources.
 */
export async function ownWorkbookSource(source: WorkbookSource, limits: RuntimeLimits,
  check: () => void): Promise<WorkbookSource> {
  check();
  const metadata = snapshotWorkbook(source.metadata, limits);
  const readCells = source.cells.bind(source);
  if (metadata.detachedSheets?.length || metadata.sheets.some(sheet => sheet.cells.length))
    throw new SsconvertError("invalid-request", "Workbook source metadata must have empty cell arrays");
  const copy = createRecordSnapshot(limits);
  copy(metadata);
  let count = 0;
  function validate(cell: Cell, sheet: (typeof metadata.sheets)[number], previous?: Cell) {
    check();
    if (cell.formula !== undefined || cell.formulaGroup !== undefined)
      throw new SsconvertError("invalid-request", "Workbook source requires evaluated scalar cells");
    if (previous && (previous.row > cell.row || previous.row === cell.row && previous.column >= cell.column))
      throw new SsconvertError("invalid-request", "Workbook source cells must have unique row-major addresses");
    snapshotWorkbook({ sheets: [{ ...sheet, cells: [cell] }] }, limits);
  }
  for (const sheet of metadata.sheets) {
    let previous: Cell | undefined, index = 0;
    for await (const supplied of readCells(sheet.id)) {
      check();
      if (++count > limits.cells) throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
      copy(String(index++), 4);
      const cell = copy(supplied, 4);
      validate(cell, sheet, previous); previous = cell;
    }
  }
  check();
  return Object.freeze({ metadata, async *cells(id: string) {
    const sheet = metadata.sheets.find(sheet => sheet.id === id);
    if (!sheet) throw new SsconvertError("invalid-request", "Unknown workbook source sheet");
    const copy = createRecordSnapshot(limits);
    copy(metadata);
    let previous: Cell | undefined, index = 0;
    for await (const supplied of readCells(id)) {
      check();
      if (index >= limits.cells) throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
      copy(String(index++), 4);
      const cell = copy(supplied, 4);
      validate(cell, sheet, previous); previous = cell;
      yield cell;
    }
    check();
  } });
}
