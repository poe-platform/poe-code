import { expect, it } from "vitest";
import type { Cell, Sheet } from "@poe-code/spreadsheet-ast";
import { createRightwardPrintSpans } from "./text-span.js";
const start: Cell = { row: 0, column: 0, value: { kind: "string", value: "long text" } };
const book = (cells: readonly Cell[]): Sheet => ({ id: "s", name: "Data", cells });
const column = (index: number) => ({ start: index * 48, size: 48 });
it("stops at the nearest populated column independent of input order and ignores other rows", () => {
  const span = createRightwardPrintSpans(book([{ ...start, column: 8 }, { ...start, row: 1, column: 1 }, start, { ...start, column: 3 }]), column, () => {});
  expect(span(start, 500)).toBe(144);
  expect(span(start, 100)).toBe(100);
});
it("passes blank cells but stops at formulas with blank results", () => {
  const span = createRightwardPrintSpans(book([start, { row: 0, column: 1, value: { kind: "blank" } },
    { row: 0, column: 2, value: { kind: "blank" }, formula: '=IF(TRUE,"",1)' }]), column, () => {});
  expect(span(start, 500)).toBe(96);
});
it("passes hidden populated columns and remains bounded by the available page width", () => {
  const span = createRightwardPrintSpans(book([start, { ...start, column: 1 }]), index => ({ start: index * 48, size: index === 1 ? 0 : 48 }), () => {});
  expect(span(start, 300)).toBe(300);
});
it("charges index creation and span lookup to caller work", () => {
  expect(() => createRightwardPrintSpans(book([start]), column, () => { throw new Error("cancelled"); })).toThrow("cancelled");
  let cancel = false;
  const span = createRightwardPrintSpans(book([start, { ...start, column: 1 }]), column, () => { if (cancel) throw new Error("cancelled"); });
  cancel = true;
  expect(() => span(start, 500)).toThrow("cancelled");
});
