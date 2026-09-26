import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import { layoutPrintPages } from "./layout.js";
import { paginateAxis, printWork } from "./pagination.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 } };
const request = { area: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
  defaultRowPoints: 10, defaultColumnPoints: 10,
  paper: { widthPoints: 40, heightPoints: 40 }, margins: { left: 10, right: 10, top: 10, bottom: 10 } };

it("reserves the native initial grid line at an exact-size page boundary", () => {
  expect(paginateAxis({ start: 0, end: 2, defaultSizePoints: 10, usablePoints: 20 }, context)
    .map(page => [page.start, page.end, page.sizePoints])).toEqual([[0, 0, 10], [1, 1, 10], [2, 2, 10]]);
});
it("includes hidden rows preceding an oversized visible row without consuming that row", () => {
  expect(paginateAxis({ start: 0, end: 2, defaultSizePoints: 10, usablePoints: 5,
    items: [{ index: 0, hidden: true }] }, context).map(page => [page.start, page.end]))
    .toEqual([[0, 0], [1, 1], [2, 2]]);
});
it("centers oversized items with the native negative shift", () => {
  expect(layoutPrintPages({ ...request, defaultColumnPoints: 40, defaultRowPoints: 30,
    centerHorizontally: true, centerVertically: true }, context).pages[0])
    .toMatchObject({ originX: 0, originY: 5 });
});
it("uses original column distances when centering formula-display pages", () => {
  expect(layoutPrintPages({ ...request, displayFormulas: true, centerHorizontally: true }, context).pages[0])
    .toMatchObject({ originX: 15 });
});
it("rejects nonfinite and negative work admission without poisoning the budget", () => {
  const tick = printWork(context);
  for (const amount of [NaN, Infinity, -1, 0.5]) expect(() => tick(amount)).toThrow("Invalid ssconvert print work amount");
  expect(() => tick(10000)).not.toThrow();
  expect(() => tick()).toThrow("work limit exceeded");
});
it("rejects nonfinite page numbering instead of replacing it with the default", () => {
  expect(() => layoutPrintPages({ ...request, startPage: NaN }, context)).toThrow("Invalid ssconvert print page number");
});
it("checks the initial line for visible zero-size rows but skips hidden rows", () => {
  expect(paginateAxis({ start: 0, end: 2, defaultSizePoints: 0, usablePoints: 0 }, context)
    .map(page => [page.start, page.end])).toEqual([[0, 0], [1, 1], [2, 2]]);
  expect(paginateAxis({ start: 0, end: 2, defaultSizePoints: 0, usablePoints: 0,
    items: [{ index: 0, hidden: true }, { index: 1, hidden: true }, { index: 2, hidden: true }] }, context)
    .map(page => [page.start, page.end])).toEqual([[0, 2]]);
});
it("treats native data-slice page breaks as explicit boundaries", () => {
  expect(paginateAxis({ start: 0, end: 3, defaultSizePoints: 10, usablePoints: 100,
    breaks: [{ position: 2, type: "data-slice" }, { position: 3, type: "none" }] }, context)
    .map(page => [page.start, page.end])).toEqual([[0, 1], [2, 3]]);
});
