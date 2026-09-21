import { expect, it } from "vitest";
import { createFormattingCapability, renderCellText } from "../formatting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "de_DE.UTF-8", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};

it.each([
  [1234.5, "#,##0.00", "1.234,50"], [45351, "dddd d mmmm yyyy", "Donnerstag 29 Februar 2024"],
  [45351, "ddd d mmm yyyy", "Do 29 Feb 2024"], [-12.5, '"v."0.00', "-v.12,50"]
] as const)("matches captured German XL display (%s,%s)", async (value, pattern, expected) => {
  expect(await createFormattingCapability().format({ kind: "number", value }, pattern, context)).toBe(expected);
});
it("matches native raw decimal and boolean bytes", async () => {
  for (const [value, expected] of [[{ kind: "number" as const, value: 12.5 }, "12,5"],
    [{ kind: "boolean" as const, value: true }, "WAHR"], [{ kind: "boolean" as const, value: false }, "FALSCH"]] as const) {
    expect(await renderCellText({ row: 0, column: 0, value }, { sheets: [] }, context, "raw")).toBe(expected);
  }
});
it.each([["#NUM!", "#ZAHL!"], ["#N/A", "#NV"], ["#VALUE!", "#WERT!"], ["#REF!", "#BEZUG!"],
  ["#NAME?", "#NAME?"], ["#DIV/0!", "#DIV/0!"]])("matches native localized error %s", async (value, expected) => {
  expect(await renderCellText({ row: 0, column: 0, value: { kind: "error", value } }, { sheets: [] }, context, "raw")).toBe(expected);
});
it("keeps canonical stored patterns and locale-spelled formula TEXT distinct", () => {
  const book = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: '=TEXT(1234.5,"#.##0,00")',
    formulaDirty: true, value: { kind: "number" as const, value: 0 } }] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "1.234,50" });
});
it.each([
  ['=TEXT("hello","\\"pre\\"@\\"post\\"")', "prehellopost"],
  ['=TEXT("12,5","0,00")', "12,50"], ['=TEXT("1.234,5","0,00")', "1234,50"]
])("matches German text matching %s", (formula, expected) => {
  expect(recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0,
    formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: expected });
});
it.each([[60.5, "60,5"], [10000000000.5, "10000000000,5"]] as const)("uses localized raw fallback for invalid automatic date %s", async (value, expected) => {
  expect(await renderCellText({ row: 0, column: 0, value: { kind: "number", value }, format: "yyyy-mm-dd" },
    { sheets: [] }, context)).toBe(expected);
});
it("renders a generated date-format error in the selected locale", async () => {
  expect(await createFormattingCapability().format({ kind: "number", value: 60 }, "yyyy-mm-dd", context)).toBe("#WERT!");
});
