import { expect, it } from "vitest";
import { createBiffWriter, readBiff } from "./biff.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 10000 } };

for (const revision of [7, 8] as const) {
  it.each([
    ["=SUM((S1!A1:A2,S1!B1:B2))", 17],
    ["=SUM(S1!A1:B2 S1!B1:B3)", 12],
    ["=INDEX((S1!A1:B2,S2!A1:B2),2,2,2)", 20],
    ["=ROW(INDEX((S1!A1:B2,S2!A1:B2),2,2,2))", 2]
  ] as const)(`preserves reference operators in BIFF${revision}: %s`, async (formula, expected) => {
    const book: Workbook = { sheets: [
      { id: "first", name: "S1", cells: [2, 5, 3, 7].map((value, index) => ({
        row: Math.floor(index / 2), column: index % 2, value: { kind: "number", value }
      })) },
      { id: "second", name: "S2", cells: [{ row: 1, column: 1, value: { kind: "number", value: 20 } }] },
      { id: "result", name: "Result", cells: [{ row: 0, column: 0, formula, value: { kind: "number", value: 999 } }] }
    ] };
    const output = await createBiffWriter(revision)(book, [], context);
    const reopened = await readBiff(output, context);
    expect(reopened.sheets[2]!.cells[0]!.formula).toContain(formula.startsWith("=SUM") ? "SUM" : "INDEX");
    expect(recalculateWorkbook(reopened, context, true).sheets[2]!.cells[0]!.value)
      .toEqual({ kind: "number", value: expected });
  });
}
