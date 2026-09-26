import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

it("keeps absent optional function calls as native #NAME? cell errors rather than conversion failures", () => {
  const context: CapabilityContext = { signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 }, own() {} };
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: ["PERL_ADDER(17,22)", "PY_BITAND(12,6)"].map((formula, column) =>
    ({ row: 0, column, formula: "=" + formula, formulaDirty: true, value: { kind: "blank" as const } })) }] }, context);
  expect(result.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" }
  ]);
});
