import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

// BIFF permits explicit PtgParen set members that the native text parser rejects.
it.each([
  ["SUM", "#VALUE!", "#VALUE!"], ["PRODUCT", "#VALUE!", "#VALUE!"],
  ["AVERAGE", "#VALUE!", "#VALUE!"], ["COUNT", 1, 1], ["COUNTA", 2, 2],
  ["AND", "#VALUE!", "#VALUE!"], ["CONCAT", "#VALUE!", "#VALUE!"],
  ["ARRAY", "#VALUE!", 4]
] as const)("retains explicit grouped set members in %s", (name, left, right) => {
  const args = ["(((A51,A52)),A53)", "(A53,((A51,A52)))"];
  const book = recalculateWorkbook({ sheets: [{ id: "S", name: "Cases", cells: [
    ...args.map((arg, row) => ({ row, column: 0, formula: `=${name}(${arg})`, value: { kind: "number" as const, value: 999 } })),
    ...[2, 3, 4].map((value, i) => ({ row: 50 + i, column: 0, value: { kind: "number" as const, value } }))
  ] }] }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  for (const [row, value] of [left, right].entries()) {
    expect(book.sheets[0]!.cells[row]!.value, `${name}(${args[row]})`)
      .toEqual({ kind: typeof value === "number" ? "number" : "error", value });
  }
});
