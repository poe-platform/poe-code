import { DEFAULT_SHEET_SIZE, type Cell, type Sheet, type Workbook } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { LabelReference, ParsePosition, ReferenceEndpoint } from "./ast.js";

/** OpenFormula 1.2 §5.10.2 and Calc ParseColRowName: local declarations,
 * columns before rows, declaration order, then column-major cell order.
 * Capture the label cell; resolving its data interval belongs to evaluation. */
export function bindQuotedLabel(book: Workbook, text: string, position: ParsePosition, semantics: "openformula" | "calc", tick: () => void):
  { first: ReferenceEndpoint; label: LabelReference } | undefined {
  const key = foldSheetName(text);
  function reference(sheet: Sheet, selected: Cell, axis: "row" | "column") {
    return {
      first: { ...(sheet.id === position.sheet ? {} : { sheet: sheet.name }),
        row: { value: selected.row - (axis === "row" ? position.row : 0), relative: axis === "row" },
        column: { value: selected.column - (axis === "column" ? position.column : 0), relative: axis === "column" } },
      label: { axis, referenceClass: "reference" as const, quoted: true, scalar: false,
        ...(semantics === "openformula" ? { semantics } : {}) }
    };
  }
  for (const local of [true, false]) for (const axis of ["column", "row"] as const) for (const sheet of book.sheets) {
    tick();
    if ((sheet.id === position.sheet) !== local) continue;
    for (const pair of sheet.labelRanges ?? []) {
      tick(); if (pair.axis !== axis) continue;
      let selected: Cell | undefined;
      for (const cell of sheet.cells) {
        tick();
        if (cell.row < pair.labels.startRow || cell.row > pair.labels.endRow || cell.column < pair.labels.startColumn ||
          cell.column > pair.labels.endColumn || cell.value.kind !== "string" ||
          sheet.id === position.sheet && cell.row === position.row && cell.column === position.column ||
          foldSheetName(cell.value.value) !== key) continue;
        if (!selected || cell.column < selected.column || cell.column === selected.column && cell.row < selected.row) selected = cell;
      }
      if (selected) return reference(sheet, selected, axis);
    }
  }
  const sheet = book.sheets.find(sheet => { tick(); return sheet.id === position.sheet; });
  if (!book.automaticLabelLookup || !sheet) return undefined;
  const matches = sheet.cells.filter(cell => {
    tick(); return cell.value.kind === "string" && (cell.row !== position.row || cell.column !== position.column) && foldSheetName(cell.value.value) === key;
  }).sort((a, b) => { tick(); return a.column - b.column || a.row - b.row; });
  // Calc ParseColRowName's column-wise proximity/direction selection. Keep
  // the first candidate as Match1; a closer right/below candidate is Match2.
  let first: Cell | undefined, second: Cell | undefined, distance = Infinity, maximum = Infinity;
  for (const cell of matches) {
    tick(); if (cell.column > maximum) break;
    const column = position.column - cell.column, row = position.row - cell.row, next = column * column + row * row;
    if (!first) first = cell;
    else if (next < distance) {
      if (column < 0 || row < 0) second = cell;
      else if (cell.row >= first.row || position.row < first.row) { first = cell; second = undefined; }
      else continue;
    } else continue;
    distance = next; maximum = Math.max(position.column + Math.abs(column), position.row + Math.abs(row));
  }
  if (!first) return undefined;
  let selected = first;
  if (second && !(position.column >= first.column && position.row >= first.row)) {
    if (position.column < first.column) {
      if (position.row >= second.row) selected = second;
    } else {
      const distanceTo = (cell: Cell) => (position.column - cell.column) ** 2 + (position.row - cell.row) ** 2;
      if (distanceTo(second) < distanceTo(first)) selected = second;
    }
  }
  let rowLabel = false, below: Cell | undefined, right: Cell | undefined;
  for (const cell of sheet.cells) {
    tick();
    if (cell.column === selected.column && (cell.row === selected.row - 1 || cell.row === selected.row + 1)) {
      if (cell.value.kind === "string") rowLabel = true;
      if (cell.row === selected.row + 1) below = cell;
    }
    if (cell.row === selected.row && cell.column === selected.column + 1) right = cell;
  }
  // The numeric-right fallback is Calc's extension to OpenFormula §5.10.3.
  const size = sheet.size ?? DEFAULT_SHEET_SIZE;
  if (semantics === "calc" && selected.row < size.rows - 1 && selected.column < size.columns - 1 &&
    (!below || below.value.kind === "blank" && !below.formula) && right?.value.kind === "number") rowLabel = true;
  return reference(sheet, selected, rowLabel ? "row" : "column");
}
