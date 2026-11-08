import { expect, it } from "vitest";
import { errorBarBounds, cartesianErrorBarSegments } from "./error-bar.js";
import { createAxisMap } from "./axis.js";

it("broadcasts a single positive error and inherits it only when negative data are absent", () => {
  expect(errorBarBounds({ type: "absolute", values: [10, -20], positive: [3] }, 1)).toEqual({ minus: 3, plus: 3 });
  expect(errorBarBounds({ type: "absolute", values: [10, -20], positive: [3], negative: [1, 0] }, 1)).toEqual({ minus: -1, plus: 3 });
});
it("preserves native sentinel multiplication including negative zero", () => {
  expect(errorBarBounds({ type: "percent", values: [-20], positive: [10], negative: [NaN] }, 0)).toEqual({ minus: -0.2, plus: 2 });
  expect(errorBarBounds({ type: "relative", values: [0] }, 0)).toEqual({ minus: -0, plus: -0 });
});
it("rejects disabled, missing, invalid and negative-index values", () => {
  for (const values of [[], [NaN], [Infinity], [-Infinity]]) {
    expect(errorBarBounds({ type: "absolute", values, positive: [2] }, 0)).toBeUndefined();
  }
  expect(errorBarBounds({ type: "none", values: [1], positive: [2] }, 0)).toBeUndefined();
  expect(errorBarBounds({ type: "absolute", values: [1], positive: [2] }, -1)).toBeUndefined();
});
const xMap = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 0, length: 100 });
const yMap = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 100, length: -100 });
const base = { x: 5, y: 5, minus: 1, plus: 2, display: "both" as const, direction: "vertical" as const,
  capWidth: 6, lineWidth: 1, pointsToX: 2, pointsToY: 3, xMap, yMap };
it("emits positive-to-negative shaft then positive and negative caps with anisotropic metrics", () => {
  expect(cartesianErrorBarSegments(base)).toEqual([
    { x1: 50, y1: 30, x2: 50, y2: 60 },
    { x1: 44, y1: 30, x2: 56, y2: 30 },
    { x1: 44, y1: 60, x2: 56, y2: 60 }
  ]);
});
it("omits caps at exact converted line width, leaving a one-sided shaft", () => {
  expect(cartesianErrorBarSegments({ ...base, display: "positive", capWidth: 3, lineWidth: 2 })).toEqual([
    { x1: 50, y1: 30, x2: 50, y2: 50 }
  ]);
});
it("rejects the whole logarithmic bar if an enabled endpoint is outside the log domain", () => {
  const log = createAxisMap({ scale: "logarithmic", minimum: 1, maximum: 100, offset: 0, length: 100 });
  expect(cartesianErrorBarSegments({ ...base, yMap: log, minus: 5 })).toEqual([]);
  expect(cartesianErrorBarSegments({ ...base, yMap: log, minus: 5, display: "positive" })).toHaveLength(2);
});
