import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import { layoutPrintPages } from "./layout.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 10, operations: 100, workbookWork: 10000 } };
const request = {
  area: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 },
  defaultRowPoints: 10, defaultColumnPoints: 10,
  paper: { widthPoints: 40, heightPoints: 40 },
  margins: { left: 10, right: 10, top: 10, bottom: 10 }
};
it("uses native down-then-across page order by default", () => {
  expect(layoutPrintPages({ ...request, paper: { widthPoints: 41, heightPoints: 41 } }, context).pages.map(page => page.area)).toEqual([
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    { startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 },
    { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 },
    { startRow: 2, endRow: 3, startColumn: 2, endColumn: 3 }
  ]);
});
it("centers scaled content in landscape paper and numbers pages explicitly", () => {
  const layout = layoutPrintPages({ ...request, paper: { widthPoints: 41, heightPoints: 60 },
    orientation: "landscape", scale: { kind: "percentage", x: 50, y: 50 },
    centerHorizontally: true, centerVertically: true, startPage: 7 }, context);
  expect(layout).toMatchObject({ widthPoints: 60, heightPoints: 41, scaleX: 0.5, scaleY: 0.5 });
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0]).toMatchObject({ number: 7, originX: 20, originY: 10.5 });
});
it("fits both dimensions with one shared scale and the native two-point allowance", () => {
  expect(layoutPrintPages({ ...request, scale: { kind: "fit", rows: 1, columns: 1 } }, context))
    .toMatchObject({ scaleX: 20 / 42, scaleY: 20 / 42, pages: [{ number: 1 }] });
});
it("rejects a page product before allocating it", () => {
  expect(() => layoutPrintPages({ ...request, rowBreaks: [{ position: 1, type: "manual" }],
    columnBreaks: [{ position: 1, type: "manual" }] },
  { ...context, limits: { ...context.limits, workbookWork: 30 } })).toThrow("work limit exceeded");
});
it("normalizes a positive percentage that underflows to zero like native print.c", () => {
  expect(layoutPrintPages({ ...request, scale: { kind: "percentage", x: Number.MIN_VALUE, y: Number.MIN_VALUE } }, context))
    .toMatchObject({ scaleX: 1, scaleY: 1 });
});
