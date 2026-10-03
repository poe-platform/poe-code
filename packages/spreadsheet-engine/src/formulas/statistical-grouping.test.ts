import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each([
  ["AVERAGE", 2.5], ["MIN", 2], ["MAX", 3], ["COUNT", 2],
  ["COUNTA", 2], ["STDEV", Math.SQRT1_2], ["VAR", 0.5], ["MEDIAN", 2.5],
  ["SUBTOTAL", 2.5, 1], ["SUBTOTAL", 2, 2], ["SUBTOTAL", 2, 3],
  ["SUBTOTAL", 3, 4], ["SUBTOTAL", 2, 5], ["SUBTOTAL", 6, 6],
  ["SUBTOTAL", Math.SQRT1_2, 7], ["SUBTOTAL", 0.5, 8],
  ["SUBTOTAL", 5, 9], ["SUBTOTAL", 0.5, 10], ["SUBTOTAL", 0.25, 11]
] as const)("preserves scalar grouping in %s arguments", (name, ungrouped, code?: number) => {
  const args = ["(A51:A52)", "GroupedRange", "((A51,A52))", "DirectSet"];
  const book = recalculateWorkbook({
    names: [
      { name: "GroupedRange", expression: "=(Cases!$A$51:$A$52)" },
      { name: "DirectSet", expression: "=(Cases!$A$51,Cases!$A$52)" }
    ],
    sheets: [{ id: "S", name: "Cases", cells: [
      ...args.map((arg, row) => ({ row, column: 0, formula: `=${name}(${code === undefined ? "" : `${code},`}${arg})`, value: { kind: "number" as const, value: 999 } })),
      ...[2, 3].map((value, i) => ({ row: 50 + i, column: 0, value: { kind: "number" as const, value } }))
    ] }]
  }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  const grouped = name === "COUNT" || code === 2 ? 0 : name === "COUNTA" || code === 3 ? 1 : "#VALUE!";
  for (const [row, arg] of args.entries()) {
    const value = row === 3 ? ungrouped : grouped;
    expect(book.sheets[0]!.cells[row]!.value, `${name}(${arg})`)
      .toEqual({ kind: typeof value === "number" ? "number" : "error", value });
  }
});
