import { expect, it } from "vitest";
import { paginateAxis } from "./pagination.js";
import type { CapabilityContext } from "../../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 10, operations: 100, workbookWork: 1000 }
};
it("reserves only title rows already passed and keeps hidden rows in page ranges", () => {
  expect(paginateAxis({ start: 0, end: 5, usablePoints: 31, defaultSizePoints: 10,
    items: [{ index: 1, hidden: true }], repeat: { start: 0, end: 1 } }, context)).toEqual([
    { start: 0, end: 3, repeatCount: 0, repeatStart: 0, sizePoints: 30, repeatPoints: 0 },
    { start: 4, end: 5, repeatCount: 2, repeatStart: 0, sizePoints: 20, repeatPoints: 10 }
  ]);
});
it("manual breaks precede zero-based positions; automatic breaks do not constrain layout", () => {
  expect(paginateAxis({ start: 0, end: 4, usablePoints: 50, defaultSizePoints: 10,
    breaks: [{ position: 2, type: "manual" }, { position: 3, type: "auto" }] }, context)
    .map(page => [page.start, page.end])).toEqual([[0, 1], [2, 4]]);
});
it("admits an oversized first row to guarantee progress", () => {
  expect(paginateAxis({ start: 0, end: 1, usablePoints: 5, defaultSizePoints: 10 }, context)
    .map(page => [page.start, page.end])).toEqual([[0, 0], [1, 1]]);
});
it("keeps partially passed titles from being printed twice", () => {
  const pages = paginateAxis({ start: 0, end: 3, usablePoints: 21, defaultSizePoints: 10,
    repeat: { start: 1, end: 3 } }, context);
  expect(pages.map(page => [page.start, page.end, page.repeatCount])).toEqual([[0, 1, 0], [2, 2, 1], [3, 3, 2]]);
});
it("preserves cancellation identity and refuses unadmitted work", () => {
  const controller = new AbortController(), reason = new Error("stop"); controller.abort(reason);
  expect(() => paginateAxis({ start: 0, end: 2, usablePoints: 20, defaultSizePoints: 10 },
    { ...context, signal: controller.signal })).toThrow(reason);
  expect(() => paginateAxis({ start: 0, end: 2, usablePoints: 20, defaultSizePoints: 10 },
    { ...context, limits: { ...context.limits, workbookWork: 0 } })).toThrow("work limit exceeded");
});
it("observes cancellation before validating the print budget", () => {
  const controller = new AbortController(), reason = new Error("cancelled"); controller.abort(reason);
  expect(() => paginateAxis({ start: 0, end: 2, usablePoints: 20, defaultSizePoints: 10 },
    { ...context, signal: controller.signal, limits: { ...context.limits, workbookWork: -1 } })).toThrow(reason);
});
