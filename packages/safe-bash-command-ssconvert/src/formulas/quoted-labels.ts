import type { Cell, Workbook } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import type { LabelReference, ParsePosition, ReferenceEndpoint } from "./ast.js";

/** OpenFormula 1.2 §5.10.2 and Calc ParseColRowName: local declarations,
 * columns before rows, declaration order, then column-major cell order.
 * Capture the label cell; resolving its data interval belongs to evaluation. */
export function bindDeclaredLabel(book: Workbook, text: string, position: ParsePosition, tick: () => void):
  { first: ReferenceEndpoint; label: LabelReference } | undefined {
  const key = foldSheetName(text);
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
      if (selected) return {
        first: { ...(local ? {} : { sheet: sheet.name }),
          row: { value: selected.row - (axis === "row" ? position.row : 0), relative: axis === "row" },
          column: { value: selected.column - (axis === "column" ? position.column : 0), relative: axis === "column" } },
        label: { axis, referenceClass: "reference", quoted: true, scalar: false }
      };
    }
  }
  return undefined;
}
