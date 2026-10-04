import type { Cell, Sheet } from "@poe-code/spreadsheet-ast";

/** Locate occupied visible cells once, including formulas whose result is blank. */
export function createPrintSpans(sheet: Sheet, column: (index: number) => { start: number; size: number }, tick: (amount?: number) => void) {
  const rows = new Map<number, number[]>();
  for (const cell of sheet.cells) {
    tick();
    if (cell.value.kind === "blank" && cell.formula === undefined || column(cell.column).size === 0) continue;
    let occupied = rows.get(cell.row);
    if (!occupied) rows.set(cell.row, occupied = []);
    occupied.push(cell.column);
  }
  for (const occupied of rows.values()) occupied.sort((a, b) => { tick(); return a - b; });
  return (cell: Cell, available: number, direction: "left" | "right" = "right"): number => {
    const occupied = rows.get(cell.row) ?? [];
    let low = 0, high = occupied.length;
    while (low < high) {
      tick();
      const middle = low + Math.floor((high - low) / 2);
      if (direction === "right" ? occupied[middle]! <= cell.column : occupied[middle]! < cell.column) low = middle + 1;
      else high = middle;
    }
    const blocker = occupied[direction === "right" ? low : low - 1];
    if (blocker === undefined) return available;
    const origin = column(cell.column), edge = column(blocker);
    return Math.min(available, direction === "right" ? edge.start - origin.start : origin.start + origin.size - edge.start - edge.size);
  };
}

export { createPrintSpans as createRightwardPrintSpans };
