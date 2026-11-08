import { expect, it } from "vitest";
import { createFormattingCapability, renderCellText } from "../formatting.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 }, own() {}
};
const book: Workbook = { sheets: [] };
const cell: Cell = { row: 0, column: 0, value: { kind: "number", value: 45292.5 }, format: "yyyy-mm-dd" };

it.each([
  ["automatic", "2024/01/01 12:00:00"], ["raw", "45292.5"], ["preserve", "2024-01-01"]
] as const)("matches measured formatted date bytes in %s mode", async (mode, expected) => {
  expect(new TextEncoder().encode(await renderCellText(cell, book, context, mode))).toEqual(new TextEncoder().encode(expected));
});
it("retains captured font-dependent display and every independent style record", async () => {
  const styled: Cell = { ...cell, displayedText: "2024-01-01", richText: [{ start: 0, end: 1, attributes: { bold: true } }],
    style: { font: { family: "Sans", size: 11 }, fill: "blue", border: "thin", alignment: "center", rotation: 45,
      wrapping: true, indentation: 3, protection: { locked: true }, theme: "accent1", palette: ["red"] } };
  const before = structuredClone(styled);
  expect(await renderCellText(styled, book, context, "preserve")).toBe("2024-01-01");
  expect(styled).toEqual(before);
});
it("keeps raw serial precision and signed-zero representation", async () => {
  for (const value of [45292.50000001, 1.2345678901234567, 5e-324, 1e308, -0]) {
    const text = await renderCellText({ ...cell, value: { kind: "number", value } }, book, context, "raw");
    expect(Number(text)).toBe(value === 0 ? 0 : value);
  }
});
it("uses the workbook epoch independently from formatting", async () => {
  expect(await renderCellText({ ...cell, value: { kind: "number", value: 0 } }, { ...book, dateSystem: "1904" }, context)).toBe("1904/01/01");
});
it("preserves borrowed cancellation reason and byte/work limits", async () => {
  const abort = new AbortController(), reason = { cancelled: true }; abort.abort(reason);
  await expect(renderCellText(cell, book, { ...context, signal: abort.signal })).rejects.toBe(reason);
  await expect(renderCellText(cell, book, { ...context, limits: { ...context.limits, outputBytes: 6 } }, "raw")).rejects.toThrow("text limit");
  await expect(createFormattingCapability().format(cell.value, "0".repeat(100), {
    ...context, limits: { ...context.limits, workbookWork: 10 }
  })).rejects.toThrow("formatting work limit");
});
it("admits automatic selection's stored pattern before parsing", async () => {
  await expect(renderCellText({ ...cell, format: '"€€"0' }, book, {
    ...context, limits: { ...context.limits, workbookTextBytes: 8 }
  })).rejects.toThrow("pattern limit");
});
