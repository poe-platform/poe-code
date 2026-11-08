import type {Range} from "@poe-code/spreadsheet-ast";
import type {CellPrintBorder} from "./cell-style.js";
import {printBorderRow} from "./border-junctions.js";

type Borders = (CellPrintBorder | undefined)[];
/** Resolve shared edges before applying native junction offsets. */
export function printSharedBorders(area: Range, options: {
  borders(row: number, column: number): readonly CellPrintBorder[];
  column(index: number): {start: number; size: number};
  row(index: number): {start: number; size: number};
  hiddenRows: ReadonlySet<number>;
  hiddenColumns: ReadonlySet<number>;
  merges: readonly Range[];
  spans: ReadonlyMap<number, readonly {left: number; right: number}[]>;
}, tick: () => void) {
  // Native print ranges include the columns occupied by displayed spans.
  // Text may reach past the last allocated cell without adding workbook cells.
  let endColumn = area.endColumn;
  for (const [row, spans] of options.spans) {
    tick();
    if (row < area.startRow || row > area.endRow) continue;
    for (const span of spans) {
      while (options.column(endColumn).start + options.column(endColumn).size < span.right) {tick(); endColumn++;}
    }
  }
  area = {...area, endColumn};
  let first = area.startColumn;
  while (first <= area.endColumn && options.hiddenColumns.has(first)) {tick(); first++;}
  if (first > area.endColumn) return [];
  const widths: number[] = [];
  for (let col = first; col <= area.endColumn; col++) {tick(); widths.push(options.column(col).size);}
  const rows: {index: number; top: Borders; bottom: Borders; vertical: Borders}[] = [];
  let bottom: Borders = [];
  for (let row = area.startRow; row <= area.endRow; row++) {
    tick();
    if (options.hiddenRows.has(row)) continue;
    const top = bottom, vertical: Borders = [];
    bottom = [];
    for (let column = first; column <= area.endColumn; column++) {
      tick(); const index = column - first;
      const sides = new Map(options.borders(row, column).map(border => {tick(); return [border.side, border] as const;}));
      top[index] ??= sides.get("Top");
      bottom[index] = sides.get("Bottom");
      vertical[index] ??= sides.get("Left");
      vertical[index + 1] = sides.get("Right");
    }
    rows.push({index: row, top, bottom, vertical});
  }
  for (const row of rows) {
    tick();
    for (const merge of options.merges) {
      tick();
      if (row.index < merge.startRow || row.index > merge.endRow || merge.endColumn < first || merge.startColumn > area.endColumn) continue;
      const left = Math.max(first, merge.startColumn), right = Math.min(area.endColumn, merge.endColumn);
      if (merge.startColumn < first) row.vertical[0] = undefined;
      if (merge.endColumn > area.endColumn) row.vertical[widths.length] = undefined;
      for (let col = left; col <= right; col++) {
        tick(); const index = col - first;
        if (row.index !== merge.startRow) row.top[index] = undefined;
        if (row.index < merge.endRow) row.bottom[index] = undefined;
        if (col > left) row.vertical[index] = undefined;
      }
    }
    for (const span of options.spans.get(row.index) ?? []) {
      for (let col = first; col <= area.endColumn; col++) {
        tick(); const x = options.column(col).start;
        if (x > span.left && x < span.right) row.vertical[col - first] = undefined;
      }
    }
  }
  let previous: Borders = [];
  const origin = options.row(area.startRow).start;
  const lines: ReturnType<typeof printBorderRow> = [];
  for (const row of rows) {
    tick(); const geometry = options.row(row.index);
    for (const line of printBorderRow({...row, previous, widths, y: geometry.start - origin, height: geometry.size}, tick)) {tick(); lines.push(line);}
    previous = row.vertical;
  }
  const last = rows.at(-1);
  if (last) {
    const geometry = options.row(last.index);
    // Native rotates three vertical arrays and clears only real columns when
    // loading its final sentinel row. Preserve the recycled fencepost too.
    const sentinel: Borders = [];
    sentinel[widths.length] = rows.at(-3)?.vertical[widths.length];
    for (const line of printBorderRow({top: last.bottom, bottom: [], vertical: sentinel, previous, widths,
      y: geometry.start + geometry.size - origin, height: 0, last: true}, tick)) {tick(); lines.push(line);}
  }
  return lines;
}
