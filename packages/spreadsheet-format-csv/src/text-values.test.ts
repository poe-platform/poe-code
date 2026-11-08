import { expect, it } from "vitest";
import type { Cell, Workbook } from "@poe-code/spreadsheet-ast";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createTextColumnInference, inferTextColumns } from "./text-values.js";

const book: Workbook = { sheets: [] };
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };
const cell = (row: number, value: string, column = 0): Cell => ({ row, column, value: { kind: "string", value } });

it("infers generated observations without requiring retained cells or values", () => {
  const inference = createTextColumnInference(book, context, 10001);
  inference.observe(cell(0, "Header"));
  for (let row = 1; row <= 10000; row++) inference.observe(cell(row, row % 2 ? "1.25" : "2.50"));
  expect(inference.apply(cell(0, "Header"))).toMatchObject({ value: { kind: "string", value: "Header" }, format: "0.00" });
  expect(inference.apply(cell(8000, "2.50"))).toMatchObject({ value: { kind: "number", value: 2.5 }, format: "0.00" });
  expect(() => inference.observe(cell(10001, "bad"))).toThrow("finished");
});

it("lets late column evidence change earlier numeric and date interpretation", () => {
  const inference = createTextColumnInference(book, context, 4);
  for (const c of [cell(0, "Dates"), cell(1, "01/02/2020"), cell(2, "13/02/2020"),
    cell(0, "Numbers", 1), cell(1, "1,25", 1), cell(2, "2,50", 1)]) inference.observe(c);
  expect(inference.apply(cell(1, "01/02/2020"))).toMatchObject({ value: { kind: "number", value: 43862 }, format: "d-mmm-yyyy" });
  expect(inference.apply(cell(1, "1,25", 1))).toMatchObject({ value: { kind: "number", value: 1.25 }, format: "0.00" });
});

it("preserves headers, quoted fields, formulas, and mixed general values", () => {
  const formula: Cell = { ...cell(3, "=A1"), formula: "A1" };
  const cells = [cell(0, "Title"), cell(1, "'3"), cell(2, "TRUE"), formula, cell(4, "")];
  const result = inferTextColumns(cells, book, context, 5);
  expect(result.map(c => c.value)).toEqual([
    { kind: "string", value: "Title" }, { kind: "string", value: "3" },
    { kind: "boolean", value: true }, { kind: "string", value: "=A1" },
    { kind: "blank" }
  ]);
  expect(result[3]).toBe(formula);
});

it("checks cancellation during both observation and replay", () => {
  const controller = new AbortController(), reason = new Error("stop");
  const inference = createTextColumnInference(book, { ...context, signal: controller.signal }, 2);
  inference.observe(cell(1, "1.0")); controller.abort(reason);
  expect(() => inference.observe(cell(2, "2.0"))).toThrow(reason);
  expect(() => inference.apply(cell(1, "1.0"))).toThrow(reason);
});
