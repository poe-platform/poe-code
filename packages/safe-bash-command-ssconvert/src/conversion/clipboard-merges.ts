import type { CapabilityContext } from "../contracts.js";
import type { CellRange, Range, Sheet } from "../workbook.js";

/** Native copy retains every overlapping merge, without clipping its bounds. */
export function clipboardMerges(sheet: Sheet, range: CellRange, context: CapabilityContext): readonly Range[] {
  return (sheet.merges ?? []).filter(merge => {
    context.signal.throwIfAborted();
    return merge.startRow <= range.endRow && merge.endRow >= range.startRow &&
      merge.startColumn <= range.endColumn && merge.endColumn >= range.startColumn;
  }).sort((a, b) => b.startRow - a.startRow || a.startColumn - b.startColumn).map(merge => ({ startRow: merge.startRow - range.startRow, endRow: merge.endRow - range.startRow,
    startColumn: merge.startColumn - range.startColumn, endColumn: merge.endColumn - range.startColumn }));
}
