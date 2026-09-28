import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { visitFormula } from "./rewriting.js";
import type { Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 10000 } };

// LibreOffice bce0998a compiler.cxx:5262 and token.cxx:518/2192 merge a
// label anchor followed by ':' and an ordinary single-reference token.
// Original ODF readback in signed Calc 26.8 confirms 33 versus grouped 50.
for (const axis of ["column", "row"] as const) {
  const column = axis === "column";
  const position = { sheet: "s", row: column ? 3 : 7, column: column ? 7 : 3 };
  const endpoint = column ? "B5" : "E2", last = column ? "B6" : "F2", previous = column ? "B4" : "D2";
  function book(formula: string): Workbook {
    return { automaticLabelLookup: false, sheets: [{ id: "s", name: "S", cells: [
      { row: column ? 0 : 1, column: column ? 1 : 0, value: { kind: "string", value: "Sales" } },
      ...[2, 7, 11, 13, 17].map((value, index) => ({ row: column ? index + 1 : 1,
        column: column ? 1 : index + 1, value: { kind: "number" as const, value } })),
      { row: position.row, column: position.column, formula, formulaDirty: true, value: { kind: "number", value: 999 } }
    ], labelRanges: [{ axis,
      labels: { startRow: column ? 0 : 1, endRow: column ? 0 : 1, startColumn: column ? 1 : 0, endColumn: column ? 1 : 0 },
      data: { startRow: 1, endRow: column ? 5 : 1, startColumn: 1, endColumn: column ? 1 : 5 } }] }] };
  }

  for (const [expression, expected] of [
    [`SUM('Sales':[.${endpoint}])`, 33],
    [`SUM(('Sales'):[.${endpoint}])`, 50],
    [`SUM('Sales':([.${endpoint}]))`, 24],
    [`SUM([.${endpoint}]:'Sales')`, 24],
    [`SUM('Sales':[.${previous}:.${endpoint}])`, 24],
    [`SUM('Sales':[.${endpoint}]:[.${last}])`, 50],
    ["'Sales'+1", 12]
  ] as const) it(`evaluates ${axis} label token boundaries in ${expression}`, () => {
    const source = `of:=${expression}`, workbook = book(source);
    const parsed = parseExpression(source, { workbook, position });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const serialized = serializeExpression(parsed.document, undefined, false, true);
    const replay = parseExpression(serialized, { workbook, position });
    if (!replay.ok) throw new Error(replay.diagnostic.message);
    const labels: unknown[] = [];
    visitFormula(replay.document.root, node => { if (node.kind === "reference" && node.label) labels.push(node.label); });
    expect(labels).toHaveLength(1);
    for (const formula of [source, serialized]) {
      const result = recalculateWorkbook(book(formula), context, true);
      expect(result.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: expected });
    }
  });

  it(`does not wrap an out-of-grid ${axis} label anchor when extending a range`, () => {
    const source = column ? "=SUM(@column.odf:DZ$1:B5)" : "=SUM(@row.odf:$A130:E2)";
    const original = book(source);
    const workbook: Workbook = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet,
      size: { rows: 128, columns: 128 } })) };
    expect(recalculateWorkbook(workbook, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "error", value: "#VALUE!" });
  });
}
