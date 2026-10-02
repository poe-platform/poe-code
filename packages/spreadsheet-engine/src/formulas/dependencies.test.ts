import { expect, it } from "vitest";
import type { Cell, Workbook } from "@poe-code/spreadsheet-ast";
import type { FormulaNode, ParsePosition } from "./ast.js";
import { buildDependencyGraph } from "./dependencies.js";
import { localReferenceRange } from "./local-references.js";
import { parseExpression } from "./parser.js";

function graph(book: Workbook, tick: () => void) {
  const parse = (source: string, position: ParsePosition): FormulaNode => {
    const parsed = parseExpression(source, { position, workbook: book });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    return parsed.document.root;
  };
  const roots = new Map<Cell, FormulaNode>();
  for (const sheet of book.sheets) for (const cell of sheet.cells) if (cell.formula)
    roots.set(cell, parse(cell.formula, { sheet: sheet.id, row: cell.row, column: cell.column }));
  return buildDependencyGraph(book, roots, (node, position) => localReferenceRange(book, node, position), parse, tick);
}

it("links sparse single-cell references within a linear work budget", () => {
  const cells: Cell[] = Array.from({ length: 128 }, (_, row) => [
    { row: row * 1000, column: 0, value: { kind: "number" as const, value: row } },
    { row: row * 1000, column: 1, value: { kind: "blank" as const }, formula: `=A${row * 1000 + 1}` }
  ]).flat().reverse();
  let work = 0;
  const result = graph({ sheets: [{ id: "s", name: "S", size: { rows: 1048576, columns: 256 }, cells }] }, () => {
    if (++work > 3000) throw new Error("dependency work exhausted");
  });
  for (let i = 0; i < cells.length; i += 2) {
    expect([...result.precedents.get(cells[i]!) ?? []]).toEqual([cells[i + 1]]);
    expect([...result.dependents.get(cells[i + 1]!) ?? []]).toEqual([cells[i]]);
  }
});

it("indexes static INDIRECT and OFFSET arguments without scanning unrelated cells", () => {
  const source: Cell = { row: 0, column: 0, value: { kind: "string", value: "C1" } };
  const offset: Cell = { row: 0, column: 1, value: { kind: "number", value: 0 } };
  const target: Cell = { row: 0, column: 2, value: { kind: "number", value: 42 } };
  const formulas: Cell[] = Array.from({ length: 64 }, (_, row) => ({ row, column: 3,
    value: { kind: "blank" }, formula: '=INDIRECT($A$1)+OFFSET($C$1,$B$1,$B$1)' }));
  const cells = [...formulas, target, offset, source];
  let work = 0;
  const result = graph({ sheets: [{ id: "s", name: "S", cells }] }, () => {
    if (++work > 5000) throw new Error("dependency work exhausted");
  });
  for (const cell of formulas) expect(result.precedents.get(cell)).toEqual(new Set([source, offset, target]));
});

it("preserves sheet identity, missing cells, and source order for ranges", () => {
  const left: Cell = { row: 1, column: 0, value: { kind: "number", value: 1 } };
  const right: Cell = { row: 0, column: 0, value: { kind: "number", value: 2 } };
  const formula: Cell = { row: 0, column: 1, value: { kind: "blank" }, formula: '=SUM(First!A1:A2)+Second!A1+Second!Z99' };
  const second: Cell = { row: 0, column: 0, value: { kind: "number", value: 3 } };
  const book: Workbook = { sheets: [
    { id: "a", name: "First", cells: [left, right] },
    { id: "b", name: "Second", cells: [formula, second] }
  ] };
  const result = graph(book, () => {});
  expect([...result.precedents.get(formula) ?? []]).toEqual([left, right, second]);
  expect([...result.dependents.get(second) ?? []]).toEqual([formula]);
  const changed = { ...book, sheets: [book.sheets[0]!, { ...book.sheets[1]!, cells: [formula] }] };
  expect([...graph(changed, () => {}).precedents.get(formula) ?? []]).toEqual([left, right]);
});
