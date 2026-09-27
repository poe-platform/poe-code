import { DEFAULT_SHEET_SIZE, type CellValue, type Sheet, type Workbook } from "../workbook.js";
import type { FormulaNode, ParsePosition } from "./ast.js";
import { localReferenceRange } from "./local-references.js";
import type { Value } from "./functions/types.js";
import { error } from "./values.js";

/** Calc GetRefColRowNames / ScColRowNameAuto, using this workbook's grid bounds.
 * The stored anchor stays unchanged when the inferred data region changes. */
export function resolveLabelReference(book: Workbook, node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition,
  read: (sheet: Sheet, row: number, column: number) => CellValue, tick: () => void): Value {
  const { label, ...reference } = node;
  const anchor = localReferenceRange(book, reference, position);
  if (!label || !anchor || anchor.sheets.length !== 1 || node.last) return error("#REF!");
  const sheet = anchor.sheets[0]!, size = sheet.size ?? DEFAULT_SHEET_SIZE;
  const row = anchor.firstRow, column = anchor.firstColumn;
  // Label anchors use strict Calc address validity, not ordinary-reference wrap.
  for (const [axis, coordinate] of [["row", row], ["column", column]] as const) {
    const value = node.first[axis];
    if (!value || value.value + (value.relative ? position[axis] : 0) !== coordinate) return error("#REF!");
  }
  if (label.kind === "radical") {
    for (const member of label.preceding ?? []) {
      tick(); const selected = localReferenceRange(book, member, position);
      if (!selected || selected.sheets.length !== 1 || selected.sheets[0] !== sheet) return error("#REF!");
      for (const axis of ["row", "column"] as const) {
        const value = member.first[axis], coordinate = value && value.value + (value.relative ? position[axis] : 0);
        if (coordinate === undefined || coordinate < 0 || coordinate >= (axis === "row" ? size.rows : size.columns)) return error("#REF!");
      }
    }
    // MS-XLS PtgElfRadical's following Area is authoritative. Calc discards
    // those bytes and infers a column range, which loses row/backward ranges.
    if (!label.data) return error("#REF!");
    const range = localReferenceRange(book, label.data, position);
    if (!range || range.sheets.length !== 1 || range.sheets[0] !== sheet) return error("#REF!");
    for (const ref of [label.data.first, label.data.last]) for (const axis of ["row", "column"] as const) {
      tick(); const value = ref[axis];
      const coordinate = value && value.value + (value.relative ? position[axis] : 0);
      if (coordinate === undefined || coordinate < 0 || coordinate >= (axis === "row" ? size.rows : size.columns)) return error("#REF!");
    }
    if (range.firstRow !== range.lastRow && range.firstColumn !== range.lastColumn) return error("#REF!");
    if (!label.scalar || range.firstRow === range.lastRow && range.firstColumn === range.lastColumn) return { kind: "range", ...range };
    if (range.firstRow === range.lastRow) return position.column < range.firstColumn || position.column > range.lastColumn ? error("#REF!") :
      { kind: "range", ...range, firstColumn: position.column, lastColumn: position.column };
    return position.row < range.firstRow || position.row > range.lastRow ? error("#REF!") :
      { kind: "range", ...range, firstRow: position.row, lastRow: position.row };
  }
  const pairs = (sheet.labelRanges ?? []).filter(pair => { tick(); return pair.axis === label.axis; });
  const declared = pairs.find(pair => { tick(); return row >= pair.labels.startRow && row <= pair.labels.endRow &&
    column >= pair.labels.startColumn && column <= pair.labels.endColumn; });
  const columnLabel = label.axis === "column";
  const maximum = (columnLabel ? size.rows : size.columns) - 1;
  const ownAxis = columnLabel ? position.row : position.column;
  const sameAxis = columnLabel ? position.column === column : position.row === row;
  let start: number, end: number;
  if (!declared && label.semantics === "openformula") {
    if (!book.automaticLabelLookup) return error("#NAME?");
    const value = read(sheet, row, column);
    if (value.kind !== "string" && value.kind !== "blank") return error("#NAME?");
    start = (columnLabel ? row : column) + 1;
    if (start > maximum) return error("#REF!");
    if (label.scalar) {
      if (ownAxis < start || ownAxis > maximum) return error("#REF!");
      start = end = ownAxis;
    } else {
      // OpenFormula §5.10.5: only this row/column, at most one initial blank,
      // then contiguous non-empty cells. Adjacent data cannot bridge a gap.
      const occupied = new Set<number>();
      for (const cell of sheet.cells) {
        tick();
        if ((columnLabel ? cell.column === column : cell.row === row) && (cell.value.kind !== "blank" || cell.formula))
          occupied.add(columnLabel ? cell.row : cell.column);
      }
      if (!occupied.has(start) && start < maximum && occupied.has(start + 1)) start++;
      end = start;
      if (occupied.has(start)) while (end < maximum && occupied.has(end + 1)) { tick(); end++; }
    }
    return { kind: "range", sheets: [sheet], firstRow: columnLabel ? start : row, lastRow: columnLabel ? end : row,
      firstColumn: columnLabel ? column : start, lastColumn: columnLabel ? column : end };
  }
  let dataSheet = sheet;
  if (declared) {
    if (declared.dataSheet !== undefined) {
      const target = [...book.sheets, ...book.detachedSheets ?? []].find(s => { tick(); return s.id === declared.dataSheet; });
      if (!target) return error("#REF!");
      dataSheet = target;
    }
    const targetSize = dataSheet.size ?? DEFAULT_SHEET_SIZE;
    if (columnLabel ? column >= targetSize.columns : row >= targetSize.rows) return error("#REF!");
    start = columnLabel ? declared.data.startRow : declared.data.startColumn;
    end = columnLabel ? declared.data.endRow : declared.data.endColumn;
  } else {
    if (!book.automaticLabelLookup) return error("#NAME?");
    const value = read(sheet, row, column);
    if (value.kind !== "string" && value.kind !== "blank") return error("#NAME?");
    start = Math.min((columnLabel ? row : column) + 1, maximum); end = maximum;
    if (sameAxis) {
      if (ownAxis === start) start = Math.min(start + 1, maximum);
      else if (ownAxis > start) end = ownAxis - 1;
    }
    for (const pair of pairs) {
      tick(); const data = pair.data;
      const aligned = columnLabel ? column >= data.startColumn && column <= data.endColumn : row >= data.startRow && row <= data.endRow;
      const next = columnLabel ? data.startRow : data.startColumn;
      if (aligned && start < next && next <= end) end = next - 1;
    }
  }
  if (start !== end && label.scalar) {
    if (ownAxis < start || ownAxis > end) return error("#REF!");
    start = end = ownAxis;
  } else if (!declared && start !== end) {
    // GetDataArea(includeOld=true, onlyDown=false). Scan sparse cells around the
    // rectangle perimeter; diagonal cells can extend it. Never enumerate a grid.
    let left = columnLabel ? column : start, right = left;
    let top = columnLabel ? start : row, bottom = top;
    for (;;) {
      let extendLeft = false, extendRight = false, extendTop = false, extendBottom = false;
      for (const cell of sheet.cells) {
        tick(); if (cell.value.kind === "blank" && !cell.formula) continue;
        if (cell.row >= top - 1 && cell.row <= bottom + 1) {
          if (cell.column === left - 1) extendLeft = true;
          if (cell.column === right + 1) extendRight = true;
        }
      }
      if (extendLeft) left--; if (extendRight) right++;
      for (const cell of sheet.cells) {
        tick(); if (cell.value.kind === "blank" && !cell.formula) continue;
        if (cell.column >= left && cell.column <= right) {
          if (cell.row === top - 1) extendTop = true;
          if (cell.row === bottom + 1) extendBottom = true;
        }
      }
      if (extendTop) top--; if (extendBottom) bottom++;
      if (!extendLeft && !extendRight && !extendTop && !extendBottom) break;
    }
    end = Math.min(end, columnLabel ? bottom : right);
    if (sameAxis && ownAxis >= start && ownAxis <= end) {
      if (ownAxis === start) start = Math.min(start + 1, maximum);
      else end = ownAxis - 1;
    }
  }
  if (start > end) return error("#REF!");
  return { kind: "range", sheets: [dataSheet], firstRow: columnLabel ? start : row, lastRow: columnLabel ? end : row,
    firstColumn: columnLabel ? column : start, lastColumn: columnLabel ? column : end };
}
