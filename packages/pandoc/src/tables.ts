import type { Block, Cell, Row } from "./ast-types.js";
import { AstError } from "./errors.js";

export type Table = Extract<Block, { t: "Table" }>;
export interface PlacedCell {
  readonly cell: Cell;
  readonly row: number;
  readonly column: number;
  readonly path: string;
}
/** Caller first admits shape and logical span area through AST budgets.
 * Storage is bounded by covered columns, never section height times width.
 * Yield during every sparse-index operation for cooperative callers. */
export function* placeRows(rows: readonly Row[], columns: number, path: string, rowHeads = 0): Generator<PlacedCell | undefined> {
  const occupied = new Map<number, number>();
  for (const [i, r] of rows.entries()) {
    for (const [column, end] of occupied) {
      yield;
      if (end <= i) occupied.delete(column);
    }
    let covered = occupied.size;
    let column = 0;
    for (const [index, cell] of r[1].entries()) {
      while ((occupied.get(column) ?? 0) > i) { column++; yield; }
      const pathCell = `${path}[${i}][1][${index}]`;
      if (cell[2] > rows.length - i || cell[3] > columns - column)
        throw new AstError("E_AST", pathCell, "Span exceeds table section");
      if (column < rowHeads && cell[3] > rowHeads - column)
        throw new AstError("E_AST", pathCell, "Row header boundary crossed");
      for (let offset = 0; offset < cell[3]; offset++) {
        if ((occupied.get(column + offset) ?? 0) > i)
          throw new AstError("E_AST", pathCell, "Overlapping spans");
        yield;
        occupied.set(column + offset, i + cell[2]);
      }
      covered += cell[3];
      yield { cell, row: i, column, path: pathCell };
      column += cell[3];
    }
    if (covered !== columns)
      throw new AstError("E_AST", `${path}[${i}]`, "Incomplete row occupancy");
  }
}
export function* tableGeometry(v: Table["c"], p: string): Generator<void> {
  const columns = v[2].length;
  for (const _ of placeRows(v[3][1], columns, `${p}[3][1]`)) { void _; yield; }
  for (const [i, body] of v[4].entries()) {
    if (body[1] < 0 || body[1] > columns)
      throw new AstError("E_AST", `${p}[4][${i}][1]`, "Invalid row head columns");
    for (const _ of placeRows(body[2], columns, `${p}[4][${i}][2]`)) { void _; yield; }
    for (const _ of placeRows(body[3], columns, `${p}[4][${i}][3]`, body[1])) { void _; yield; }
  }
  for (const _ of placeRows(v[5][1], columns, `${p}[5][1]`)) { void _; yield; }
}
