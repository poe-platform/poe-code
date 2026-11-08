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
    expect(reopened.names?.find(name => name.name === "Global")?.expression).toBe("=Inner");
  }
  expect(book).toEqual(before);
});

it.each([7, 8, "dsf"] as const)("retains native workbook-scope alias spelling in BIFF %s despite permanent local names", async profile => {
  const names = [
    { name: "Sheet_Title", expression: "31" }, { name: "Print_Area", expression: "37" },
    { name: "TitleAlias", expression: "Sheet_Title" }, { name: "AreaAlias", expression: "Print_Area" }
  ];
  const book: Workbook = { names, sheets: [{ id: "here", name: "Here", cells: names.map((name, row) =>
    ({ row, column: 0, formula: "=" + name.name, value: { kind: "number", value: 999 } })) }] };
  const bytes = await createBiffWriter(profile)(book, [], context), before = bytes.slice();
  for (const [stream, input] of readCfb(bytes, context)) {
    const reopened = await readBiff(input, context);
    expect(reopened.names?.filter(name => name.sheet === undefined && name.name.endsWith("Alias"))
      .map(name => [name.name, name.expression]), stream).toEqual([["TitleAlias", "=Sheet_Title"], ["AreaAlias", "=Print_Area"]]);
    expect(reopened.sheets[0]!.cells.slice(0, 2).map(cell => cell.formula), stream).toEqual(["=[]Sheet_Title", "=[]Print_Area"]);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value), stream)
      .toEqual([31, 37, 31, 37].map(value => ({ kind: "number", value })));
  }
  expect(bytes).toEqual(before);
});
