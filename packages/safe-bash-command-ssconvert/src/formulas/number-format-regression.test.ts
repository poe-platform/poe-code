import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};

it.each([
  ['=TEXT(12.5,"[Red]0.00")', "12.50"],
  ['=TEXT(-12.5,"[Red]0.00")', "-12.50"],
  ['=TEXT(12,"[>=10]0.0;[Red]0.00")', "12.0"],
  ['=TEXT(-12,"[>=10]0.0;[Red]0.00")', "-12.00"]
])("renders measured GOffice section %s", (formula, expected) => {
  const book = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0,
    value: { kind: "number" as const, value: 0 }, formula, formulaDirty: true }] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: expected });
});
