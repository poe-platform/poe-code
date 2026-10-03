import { expect, it } from "vitest";
import { createAxisMap } from "./axis.js";
import { cartesianSeriesPath } from "./line.js";
import type { CapabilityContext } from "../../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 1, operations: 10, workbookWork: 10 } };
const xMap = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 0, length: 100 });
const yMap = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 100, length: -100 });
const base = { count: 3, y: [2, NaN, 4], xMap, yMap, interpolation: "linear" as const, skipInvalid: false };
it("breaks the path at invalid values and retains one-based implicit categories", () => {
  expect([...cartesianSeriesPath(base, context)]).toEqual([
    { kind: "move", x: 10, y: 80 }, { kind: "move", x: 30, y: 60 }
  ]);
  expect([...cartesianSeriesPath({ ...base, skipInvalid: true }, context)]).toEqual([
    { kind: "move", x: 10, y: 80 }, { kind: "line", x: 30, y: 60 }
  ]);
});
it("centers logarithmic steps in view coordinates rather than data coordinates", () => {
  const log = createAxisMap({ scale: "logarithmic", minimum: 1, maximum: 100, offset: 0, length: 100 });
  expect([...cartesianSeriesPath({ ...base, count: 2, x: [1, 100], y: [2, 4], xMap: log, interpolation: "step-center-x" }, context)]).toEqual([
    { kind: "move", x: 0, y: 80 }, { kind: "line", x: 49.99999999999999, y: 80 },
    { kind: "line", x: 49.99999999999999, y: 60 }, { kind: "line", x: 99.99999999999999, y: 60 }
  ]);
});
it("rejects mapped DBL_MAX log sentinels even though they are finite", () => {
  const log = createAxisMap({ scale: "logarithmic", minimum: 1, maximum: 100, offset: 0, length: 100 });
  expect([...cartesianSeriesPath({ ...base, x: [1, 0, 100], y: [2, 3, 4], xMap: log }, context)]).toEqual([
    { kind: "move", x: 0, y: 80 }, { kind: "move", x: 99.99999999999999, y: 60 }
  ]);
});
it("charges skipped data and checks cancellation between step commands", () => {
  expect(() => [...cartesianSeriesPath({ ...base, y: [NaN, NaN, NaN] }, { ...context, limits: { ...context.limits, workbookWork: 2 } })]).toThrow("work limit");
  const controller = new AbortController(), reason = new Error("stop");
  const iterator = cartesianSeriesPath({ ...base, count: 2, y: [2, 4], interpolation: "step-start" }, { ...context, signal: controller.signal });
  iterator.next(); iterator.next();
  controller.abort(reason);
  expect(() => iterator.next()).toThrow(reason);
});
