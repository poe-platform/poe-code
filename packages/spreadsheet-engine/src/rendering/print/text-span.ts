import type { Cell, Sheet } from "@poe-code/spreadsheet-ast";

/** Locate occupied visible cells once, including formulas whose result is blank. */
export function createRightwardPrintSpans(sheet: Sheet, column: (index: number) => { start: number; size: number }, tick: (amount?: number) => void) {
  const rows = new Map<number, number[]>();
  for (const cell of sheet.cells) {
    tick();
    if (cell.value.kind === "blank" && cell.formula === undefined || column(cell.column).size === 0) continue;
    let occupied = rows.get(cell.row);
    if (!occupied) rows.set(cell.row, occupied = []);
    occupied.push(cell.column);
  }
  for (const occupied of rows.values()) occupied.sort((a, b) => { tick(); return a - b; });
  return (cell: Cell, available: number): number => {
    const occupied = rows.get(cell.row) ?? [];
    let low = 0, high = occupied.length;
    while (low < high) {
      tick();
      const middle = low + Math.floor((high - low) / 2);
      if (occupied[middle]! <= cell.column) low = middle + 1;
      else high = middle;
    }
    const next = occupied[low];
    return next === undefined ? available : Math.min(available, column(next).start - column(cell.column).start);
  };
}
