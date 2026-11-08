import { expect, it } from "vitest";
import { createFormattingCapability, renderCellText } from "../formatting.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 }, own() {}
};
const book: Workbook = { sheets: [] };
const numericCell = (value: number, format: string): Cell => ({ row: 0, column: 0, value: { kind: "number", value }, format });

it.each([
  [1.125, "[hh]:mm:ss", "27:00:00"], [1.125, "[mm]:ss", "27:00:00"],
  [1.125, "[ss]", "27:00:00"], [.5, "[mm]", "12:00:00"],
  [12, '0"days"', "12"], [12, "0\\m", "12"],
  [45292.5, "yyyy-mm-dd", "2024/01/01 12:00:00"],
  [.99999999999999, "yyyy-mm-dd", "1900/01/01"], [60.5, "yyyy-mm-dd", "60.5"],
  [10000000000.5, "yyyy-mm-dd", "10000000000.5"],
  [.5, "AM/PM", "12:00:00"], [.5, "A/P", "12:00:00"],
  [1.125, "[hhh]:mm:ss", "27:00:00"]
] as const)("matches independently captured automatic export (%s,%s)", async (value, pattern, expected) => {
  expect(await renderCellText(numericCell(value, pattern), book, context)).toBe(expected);
});

it("admits patterns by UTF8 bytes rather than UTF16 units", async () => {
  await expect(createFormattingCapability().format({ kind: "number", value: 12 }, '"€€"0', {
    ...context, limits: { ...context.limits, workbookTextBytes: 6 }
  })).rejects.toThrow("pattern limit");
});

it("checks injected capability output by UTF8 bytes", async () => {
  await expect(renderCellText(numericCell(12, "0"), book, {
    ...context, limits: { ...context.limits, outputBytes: 2 }, formatting: { async format() { return "€"; } }
  }, "preserve")).rejects.toThrow("text limit");
});

it("retains exact cancellation reason after an injected formatter resolves", async () => {
  const controller = new AbortController(), reason = { cancelled: true };
  await expect(renderCellText(numericCell(12, "0"), book, {
    ...context, signal: controller.signal, formatting: { async format() { controller.abort(reason); return "12"; } }
  }, "preserve")).rejects.toBe(reason);
});

it("uses captured display only in preserve mode and cached numeric values in raw/automatic", async () => {
  const cell: Cell = { ...numericCell(12.5, "0.00"), cachedResult: { kind: "number", value: 13.25 }, displayedText: "captured" };
  const before = structuredClone(cell);
  expect(await renderCellText(cell, book, context, "preserve")).toBe("captured");
  expect(await renderCellText(cell, book, context, "raw")).toBe("13.25");
  expect(await renderCellText(cell, book, context)).toBe("13.25");
  expect(cell).toEqual(before);
});

it.each(["raw", "automatic", "preserve"] as const)("renders captured German error bytes in %s", async mode => {
  const german = { ...context, environment: { ...context.environment, locale: "de_DE.UTF-8" } };
  expect(await renderCellText({ row: 0, column: 0, value: { kind: "error", value: "#NUM!" } }, book, german, mode)).toBe("#ZAHL!");
});

it.each([
  ["raw", "1234,5"], ["automatic", "1234,5"], ["preserve", "1.234,50"]
] as const)("keeps measured German separators in %s", async (mode, expected) => {
  expect(await renderCellText(numericCell(1234.5, "#,##0.00"), book, {
    ...context, environment: { ...context.environment, locale: "de_DE.UTF-8" }
  }, mode)).toBe(expected);
});
