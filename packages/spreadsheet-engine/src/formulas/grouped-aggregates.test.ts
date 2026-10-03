import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each(["SUM", "PRODUCT"])("preserves %s argument grouping and implicit intersection", name => {
  const union = name === "SUM" ? 5 : 6, nested = name === "SUM" ? 9 : 24;
  const cases = [
    ["(A51,A52)", union], ["((A51,A52))", "#VALUE!"],
    ["(A51,(A52,A53))", nested], ["((A51,A52),A53)", nested],
    ["(A51:A52)", "#VALUE!"], ["((A51:A52))", "#VALUE!"],
    ["(A51+A52)", 5], ["A51:A52", union]
  ] as const;
  const book = recalculateWorkbook({ sheets: [{ id: "S", name: "S", cells: [
    ...cases.map(([arg], row) => ({ row, column: 0, formula: `=${name}(${arg})`, value: { kind: "number" as const, value: 999 } })),
    ...[2, 3, 4].map((value, index) => ({ row: 50 + index, column: 0, value: { kind: "number" as const, value } })),
    ...[50, 51].map(row => ({ row, column: 1, formula: `=${name}((A51:A52))`, value: { kind: "number" as const, value: 999 } }))
  ] }] }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  for (const [row, [arg, value]] of cases.entries()) {
    expect(book.sheets[0]!.cells[row]!.value, `${name}(${arg})`).toEqual({
      kind: typeof value === "number" ? "number" : "error", value
    });
  }
  for (const [row, value] of [[50, 2], [51, 3]] as const) {
    expect(book.sheets[0]!.cells.find(cell => cell.row === row && cell.column === 1)!.value).toEqual({ kind: "number", value });
  }
});
