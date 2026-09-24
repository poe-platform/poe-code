import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 10000 } };

it.each([7, 8, "dsf"] as const)("retains definition scope independently of BIFF %s name parse positions", async profile => {
  const book: Workbook = { names: [
    { name: "Inner", expression: "5" },
    { name: "Inner", sheet: "here", expression: "2" },
    { name: "Inner", sheet: "data", expression: "3" },
    { name: "Default", expression: "Inner" },
    { name: "Global", expression: "Inner", position: { sheet: "data", row: 2, column: 2 } },
    { name: "Local", sheet: "data", expression: "Inner", position: { sheet: "here", row: 2, column: 2 } },
    { name: "Qualified", sheet: "data", expression: "Here!Inner" },
    { name: "Explicit", sheet: "data", expression: "[]Inner" }
  ], sheets: [{ id: "here", name: "Here", cells:
    ["=Default", "=[]Global", "=Data!Local", "=Data!Qualified", "=Data!Explicit", "=Inner"].map((formula, row) =>
      ({ row, column: 4, formula, value: { kind: "number", value: 99 } }))
  }, { id: "data", name: "Data", cells: [] }] };
  const before = structuredClone(book), expected = [5, 5, 3, 2, 5, 2].map(value => ({ kind: "number", value }));
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(expected);
  const bytes = await createBiffWriter(profile)(book, [], context);
  for (const [stream, input] of readCfb(bytes, context)) {
    const reopened = await readBiff(input, context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value), stream).toEqual(expected);
    expect(reopened.names?.find(name => name.name === "Global")?.expression).toBe("=[]Inner");
  }
  expect(book).toEqual(before);
});
