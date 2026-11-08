import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it("retains grouping through named aggregate arguments and aliases", () => {
  const definitions = [
    ["DirectSet", "=(Cases!$A$51,Cases!$A$52)"],
    ["GroupedSet", "=((Cases!$A$51,Cases!$A$52))"],
    ["GroupedRange", "=(Cases!$A$51:$A$52)"],
    ["AliasGroupedSet", "=GroupedSet"], ["AliasDirectSet", "=DirectSet"],
    ["Cycle", "=Cycle"], ["MissingSheet", "=Missing!GroupedSet"]
  ] as const;
  const cases = [
    [0, 0, "=SUM(DirectSet)", 5], [1, 0, "=PRODUCT(DirectSet)", 6],
    [2, 0, "=SUM(GroupedSet)", "#VALUE!"], [3, 0, "=PRODUCT(GroupedSet)", "#VALUE!"],
    [4, 0, "=SUM(GroupedRange)", "#VALUE!"], [5, 0, "=PRODUCT(GroupedRange)", "#VALUE!"],
    [6, 0, "=SUM(AliasGroupedSet)", "#VALUE!"], [7, 0, "=SUM(AliasDirectSet)", 5],
    [8, 0, "=SUM(Cycle)", "#NAME?"], [9, 0, "=PRODUCT(MissingSheet)", "#NAME?"],
    [50, 1, "=SUM(GroupedRange)", 2], [51, 2, "=PRODUCT(GroupedRange)", 3]
  ] as const;
  const book = recalculateWorkbook({
    names: definitions.map(([name, expression]) => ({ name, expression, position: { sheet: "S", row: 0, column: 0 } })),
    sheets: [{ id: "S", name: "Cases", cells: [
      ...cases.map(([row, column, formula]) => ({ row, column, formula, value: { kind: "number" as const, value: 999 } })),
      ...[2, 3, 4].map((value, index) => ({ row: 50 + index, column: 0, value: { kind: "number" as const, value } }))
    ] }]
  }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  for (const [row, column, formula, value] of cases) {
    expect(book.sheets[0]!.cells.find(cell => cell.row === row && cell.column === column)!.value, formula)
      .toEqual({ kind: typeof value === "number" ? "number" : "error", value });
  }
});
