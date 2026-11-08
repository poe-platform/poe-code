import { expect, it } from "vitest";
import { objectRectangle } from "./layout.js";
import type { SheetObject } from "./index.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1, operations: 100 } };
const object: SheetObject = { kind: "graph", sourceType: "SheetObjectGraph", name: "Plot", zOrder: 0,
  anchor: { range: { startRow: 1, startColumn: 1, endRow: 4, endColumn: 3 }, offsets: [0.5, 0.25, 1, 0.5], mode: "two-cells", direction: "0" },
  payload: { name: "SheetObjectGraph", namespace: "", text: "", attributes: {}, qualifiedAttributes: [], children: [] } };
const metrics = { column(index: number) { return { start: index * 10, size: 10 }; }, row(index: number) { return { start: index * 20, size: 20 }; } };
it("converts two-cell fractional offsets to point endpoints", () => {
  expect(objectRectangle(object, metrics, context)).toEqual({ x: 15, y: 25, width: 25, height: 65 });
});
it.each(["one-cell", "absolute"])("uses point dimensions for %s anchors", mode => {
  const anchored = { ...object, anchor: { ...object.anchor, mode, offsets: [0.5, 0.25, 24, 36] } };
  expect(objectRectangle(anchored, metrics, context)).toEqual({ x: mode === "absolute" ? 0.5 : 15, y: mode === "absolute" ? 0.25 : 25, width: 24, height: 36 });
});
it("rejects unknown anchor modes and invalid metrics", () => {
  expect(() => objectRectangle({ ...object, anchor: { ...object.anchor, mode: "unknown" } }, metrics, context)).toThrow();
  expect(() => objectRectangle(object, { ...metrics, row() { return { start: NaN, size: 20 }; } }, context)).toThrow();
});
it("observes cancellation before invoking metric capabilities", () => {
  const controller = new AbortController(); const reason = new Error("cancel"); controller.abort(reason);
  expect(() => objectRectangle(object, { column() { throw new Error("should not run"); }, row() { throw new Error("should not run"); } }, { ...context, signal: controller.signal })).toThrow(reason);
});
it("stops metric admission when an admitted callback aborts", () => {
  const controller = new AbortController();
  const reason = new Error("metric cancellation");
  let calls = 0;
  expect(() => objectRectangle(object, {
    column() { calls++; controller.abort(reason); return { start: 0, size: 10 }; },
    row() { calls++; throw new Error("row admitted after cancellation"); }
  }, { ...context, signal: controller.signal })).toThrow(reason);
  expect(calls).toBe(1);
});
it("absolute geometry does not admit cell metrics and rejects arithmetic overflow", () => {
  const absolute = { ...object, anchor: { offsets: object.anchor.offsets, direction: object.anchor.direction, mode: "absolute" } };
  const denied = { column() { throw new Error("unexpected column"); }, row() { throw new Error("unexpected row"); } };
  expect(objectRectangle(absolute, denied, context)).toEqual({ x: 0.5, y: 0.25, width: 1, height: 0.5 });
  expect(() => objectRectangle(object, { column() { return { start: Number.MAX_VALUE, size: Number.MAX_VALUE }; }, row: metrics.row }, context)).toThrow("Invalid sheet object geometry");
});
