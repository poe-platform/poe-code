import { snapshotWorkbook, type Workbook } from "@poe-code/spreadsheet-ast";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxXml } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";

/** Admit and own input before loading codecs or beginning asynchronous output. */
export function snapshotXlsxWorkbook(book: Workbook, context: CapabilityContext,
  charge = createXlsxXml(context).charge): Workbook {
  context.signal.throwIfAborted();
  // Preserve the codec's established coordinate diagnostic before the shared
  // snapshot rejects nonfinite numbers. Inspect data descriptors only: this
  // admission must never execute workbook accessors or traverse unbounded arrays.
  const suppliedSheets = Object.getOwnPropertyDescriptor(book, "sheets")?.value as unknown;
  if (Array.isArray(suppliedSheets) && suppliedSheets.length <= context.limits.sheets) {
    let cells = 0;
    for (let sheetIndex = 0; sheetIndex < suppliedSheets.length; sheetIndex++) {
      charge();
      const sheet = Object.getOwnPropertyDescriptor(suppliedSheets, String(sheetIndex))?.value as unknown;
      if (sheet === null || typeof sheet !== "object") continue;
      const suppliedCells = Object.getOwnPropertyDescriptor(sheet, "cells")?.value as unknown;
      if (!Array.isArray(suppliedCells)) continue;
      cells += suppliedCells.length;
      if (cells > context.limits.cells) break;
      for (let index = 0; index < suppliedCells.length; index++) {
        charge();
        const cell = Object.getOwnPropertyDescriptor(suppliedCells, String(index))?.value as unknown;
        if (cell === null || typeof cell !== "object") continue;
        const row = Object.getOwnPropertyDescriptor(cell, "row"), column = Object.getOwnPropertyDescriptor(cell, "column");
        if (row && column && Object.hasOwn(row, "value") && Object.hasOwn(column, "value") &&
          (![row.value, column.value].every(Number.isSafeInteger) || row.value < 0 || column.value < 0 || row.value >= 1048576 || column.value >= 16384))
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX cell outside writer sheet limits");
      }
    }
  }
  return snapshotWorkbook(book, context.limits);
}
