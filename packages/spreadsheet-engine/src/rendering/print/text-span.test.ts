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
it("spans leftward to the nearest occupied cell and respects page bounds", () => {
  const end = { ...start, column: 4 };
  const span = createRightwardPrintSpans(book([end, start, { ...start, column: 2 }]), column, () => {});
  expect(span(end, 500, "left")).toBe(96);
  expect(span(end, 60, "left")).toBe(60);
});
it("leftward spans ignore blanks and hidden cells but stop at blank formulas", () => {
  const end = { ...start, column: 4 };
  const span = createRightwardPrintSpans(book([end, start, { row: 0, column: 3, value: { kind: "blank" } },
    { row: 0, column: 2, value: { kind: "blank" }, formula: '=IF(TRUE,"",1)' }]), column, () => {});
  expect(span(end, 500, "left")).toBe(96);
  const hidden = createRightwardPrintSpans(book([end, start, { ...start, column: 3 }]), index => ({ start: index * 48, size: index === 3 ? 0 : 48 }), () => {});
  expect(hidden(end, 500, "left")).toBe(192);
});

it("limits centered spans to whole columns needed on each side", () => {
  const center = {...start, column: 3};
  const span = createRightwardPrintSpans(book([center, {...start, column: 5}]), column, () => {});
  expect(span(center, 400, "left", 49)).toBe(96);
  expect(span(center, 400, "left", 97)).toBe(144);
  expect(span(center, 400, "right", 200)).toBe(96);
  expect(span(center, 70, "left", 97)).toBe(70);
});
it("charges hidden-column traversal to caller work", () => {
  let work = 0;
  const span = createRightwardPrintSpans(book([]), index => ({start: 0, size: index === 0 ? 48 : 0}), () => {
    if (++work > 10) throw new Error("cancelled");
  });
  expect(() => span(start, 400, "right", 97)).toThrow("cancelled");
});

it("does not create a phantom centered span from fractional adjacent boundaries", () => {
  const center = {...start, column: 3}, size = 42.002524166666674;
  const span = createRightwardPrintSpans(book([center, {...start, column: 2}, {...start, column: 4}]),
    index => ({start: index * size, size}), () => {});
  expect(span(center, 500, "left", 90)).toBe(size);
  expect(span(center, 500, "right", 90)).toBe(size);
});
