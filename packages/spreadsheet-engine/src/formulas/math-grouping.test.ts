import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each([
  ["GCD", 1], ["LCM", 6], ["MULTINOMIAL", 10], ["SUMSQ", 13],
  ["SUMA", 5], ["HYPOT", 3.6055512754639891], ["G_PRODUCT", 6],
  ["INVSUMINV", 1.2000000000000002], ["BITAND", 2], ["BITOR", 3],
  ["BITXOR", 1], ["IMSUM", 5], ["IMPRODUCT", 6]
] as const)("preserves scalar grouping in %s arguments", (name, ungrouped) => {
  const args = ["(A501:A502)", "GroupedRange", "((A501,A502))", "DirectSet"];
  const book = recalculateWorkbook({
    names: [
      { name: "GroupedRange", expression: "=(Cases!$A$501:$A$502)" },
      { name: "DirectSet", expression: "=(Cases!$A$501,Cases!$A$502)" }
    ],
    sheets: [{ id: "S", name: "Cases", cells: [
      ...args.map((arg, row) => ({ row, column: 0, formula: `=${name}(${arg})`, value: { kind: "number" as const, value: 999 } })),
      ...[2, 3].map((value, i) => ({ row: 500 + i, column: 0, value: { kind: "number" as const, value } }))
    ] }]
  }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  for (const [row, arg] of args.entries()) {
    expect(book.sheets[0]!.cells[row]!.value, `${name}(${arg})`)
      .toEqual(row === 3 ? { kind: "number", value: ungrouped } : { kind: "error", value: "#VALUE!" });
  }
});
