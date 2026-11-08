import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each([
  ["AND", { kind: "boolean", value: true }], ["OR", { kind: "boolean", value: true }],
  ["XOR", { kind: "boolean", value: false }], ["CONCAT", { kind: "string", value: "23" }],
  ["CONCATENATE", { kind: "string", value: "23" }], ["TEXTJOIN", { kind: "string", value: "2-3" }],
  ["ARRAY", { kind: "number", value: 2 }], ["SIMTABLE", { kind: "number", value: 2 }]
] as const)("preserves scalar grouping in %s arguments", (name, ungrouped) => {
  const args = ["(A51:A52)", "GroupedRange", "((A51,A52))", "DirectSet"];
  const book = recalculateWorkbook({
    names: [
      { name: "GroupedRange", expression: "=(Cases!$A$51:$A$52)" },
      { name: "DirectSet", expression: "=(Cases!$A$51,Cases!$A$52)" }
    ],
    sheets: [{ id: "S", name: "Cases", cells: [
      ...args.map((arg, row) => ({ row, column: 0,
        formula: `=${name}(${name === "TEXTJOIN" ? '"-",TRUE,' : ""}${arg})`,
        value: { kind: "number" as const, value: 999 } })),
      ...[2, 3].map((value, i) => ({ row: 50 + i, column: 0, value: { kind: "number" as const, value } }))
    ] }]
  }, {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 10000 }
  }, true);
  for (const [row, arg] of args.entries()) {
    expect(book.sheets[0]!.cells[row]!.value, `${name}(${arg})`)
      .toEqual(row === 3 ? ungrouped : { kind: "error", value: "#VALUE!" });
  }
});
