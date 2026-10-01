import { DEFAULT_SHEET_SIZE, type CellValue, type Sheet, type Workbook } from "@poe-code/spreadsheet-ast";
import type { FormulaNode, ParsePosition } from "./ast.js";
import { localReferenceRange } from "./local-references.js";
import type { Value } from "./functions/types.js";
import { error } from "./values.js";

/** Calc GetRefColRowNames / ScColRowNameAuto, using this workbook's grid bounds.
 * The stored anchor stays unchanged when the inferred data region changes. */
export function resolveLabelReference(book: Workbook, node: Extract<FormulaNode, { kind: "reference" }>, position: ParsePosition,
  read: (sheet: Sheet, row: number, column: number) => CellValue, tick: () => void, anchorOnly = false): Value {
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
  if (anchorOnly) return { kind: "range", ...anchor };
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
    const rowLabel = range.firstRow === range.lastRow && row === range.firstRow &&
      (column === range.firstColumn - 1 || column === range.lastColumn + 1);
    const columnLabel = range.firstColumn === range.lastColumn && column === range.firstColumn &&
      (row === range.firstRow - 1 || row === range.lastRow + 1);
    if (rowLabel === columnLabel || label.preceding && !columnLabel) return error("#REF!");
    if (!label.scalar) return { kind: "range", ...range };
    if (rowLabel) return position.column < range.firstColumn || position.column > range.lastColumn ? error("#REF!") :
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
  const sameAxis = position.sheet === sheet.id && (columnLabel ? position.column === column : position.row === row);
  let start: number, end: number;
  if (!declared && label.semantics === "openformula") {
    if (!book.automaticLabelLookup) return error("#NAME?");
    const value = read(sheet, row, column);
    if (value.kind !== "string" && value.kind !== "blank") return error("#NAME?");
    start = (columnLabel ? row : column) + 1;
    if (start > maximum) return error("#REF!");
    if (label.scalar) {
      if (sameAxis || ownAxis < start || ownAxis > maximum) return error("#REF!");
      start = end = ownAxis;
    } else {
      // Calc excludes a same-axis formula before expanding its data range.
      // Never clamp an excluded final cell back onto the formula itself.
      if (sameAxis && ownAxis === start) start++;
      if (start > maximum) return error("#REF!");
      const limit = sameAxis && ownAxis > start ? Math.min(maximum, ownAxis - 1) : maximum;
      // OpenFormula §5.10.5: only this row/column, at most one initial blank,
      // then contiguous non-empty cells. Adjacent data cannot bridge a gap.
      const occupied = new Set<number>();
      for (const cell of sheet.cells) {
        tick();
        if (sameAxis && (columnLabel ? cell.row : cell.column) === ownAxis) continue;
        if ((columnLabel ? cell.column === column : cell.row === row) && (cell.value.kind !== "blank" || cell.formula))
          occupied.add(columnLabel ? cell.row : cell.column);
      }
      if (!occupied.has(start) && start < limit && occupied.has(start + 1)) start++;
      end = start;
      if (occupied.has(start)) while (end < limit && occupied.has(end + 1)) { tick(); end++; }
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
    start = (columnLabel ? row : column) + 1; end = maximum;
    if (sameAxis) {
      if (ownAxis === start) start++;
      else if (ownAxis > start) end = ownAxis - 1;
    }
    // Calc scans its workbook-wide pair list here, without filtering the data
    // sheet. The inferred range itself still belongs to the label's sheet.
    for (const owner of [...book.sheets, ...book.detachedSheets ?? []]) {
      tick();
      for (const pair of owner.labelRanges ?? []) {
        tick(); if (pair.axis !== label.axis) continue;
        const data = pair.data;
        const aligned = columnLabel ? column >= data.startColumn && column <= data.endColumn : row >= data.startRow && row <= data.endRow;
        const next = columnLabel ? data.startRow : data.startColumn;
        if (aligned && start < next && next <= end) end = next - 1;
      }
    }
  }
  if (start > end) return error("#REF!");
  if (label.scalar) {
    if (ownAxis < start || ownAxis > end) return error("#REF!");
    start = end = ownAxis;
  } else if (!declared && start !== end) {
    // GetDataArea(includeOld=true, onlyDown=false), preserving the ordered
    // horizontal/vertical perimeter expansion, including diagonal neighbors.
    // Index occupied axes once so each perimeter query is logarithmic rather
    // than scanning every cell at every step. Charge construction and queries.
    const rows = new Map<number, number[]>(), columns = new Map<number, number[]>();
    for (const cell of sheet.cells) {
      tick(); if (cell.value.kind === "blank" && !cell.formula) continue;
      const rowCells = rows.get(cell.row) ?? [], columnCells = columns.get(cell.column) ?? [];
      rowCells.push(cell.column); columnCells.push(cell.row);
      rows.set(cell.row, rowCells); columns.set(cell.column, columnCells);
    }
    for (const index of [rows, columns]) for (const coordinates of index.values()) {
      tick(); coordinates.sort((a, b) => { tick(); return a - b; });
    }
    const occupied = (index: Map<number, number[]>, axis: number, low: number, high: number): boolean => {
      tick(); const coordinates = index.get(axis);
      if (!coordinates) return false;
      let first = 0, last = coordinates.length;
      while (first < last) {
        tick(); const middle = Math.floor((first + last) / 2);
        if (coordinates[middle]! < low) first = middle + 1;
        else last = middle;
      }
      return first < coordinates.length && coordinates[first]! <= high;
    };
    let left = columnLabel ? column : start, right = left;
    let top = columnLabel ? start : row, bottom = top;
    for (;;) {
      const extendLeft = occupied(columns, left - 1, top - 1, bottom + 1);
      const extendRight = occupied(columns, right + 1, top - 1, bottom + 1);
      if (extendLeft) left--; if (extendRight) right++;
      const extendTop = occupied(rows, top - 1, left, right);
      const extendBottom = occupied(rows, bottom + 1, left, right);
      if (extendTop) top--; if (extendBottom) bottom++;
      if (!extendLeft && !extendRight && !extendTop && !extendBottom) break;
    }
    end = Math.min(end, columnLabel ? bottom : right);
    if (sameAxis && ownAxis >= start && ownAxis <= end) {
      if (ownAxis === start) start++;
      else end = ownAxis - 1;
    }
  }
  if (start > end) return error("#REF!");
  return { kind: "range", sheets: [dataSheet], firstRow: columnLabel ? start : row, lastRow: columnLabel ? end : row,
    firstColumn: columnLabel ? column : start, lastColumn: columnLabel ? column : end };
}
