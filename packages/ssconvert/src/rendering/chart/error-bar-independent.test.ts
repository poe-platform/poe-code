import { expect, it } from "vitest";
import { createAxisMap } from "./axis.js";
import { cartesianErrorBarSegments, errorBarBounds, type CartesianErrorBarRequest } from "./error-bar.js";

// Independent cases derived from gog-error-bar.c (GOffice 0.10.61), not
// a second implementation of the candidate algorithm. No native oracle runs.
const xMap = createAxisMap({ scale: "linear", minimum: -10, maximum: 10, offset: 200, length: 80, inverted: true });
const yMap = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 20, length: 100 });
const request: CartesianErrorBarRequest = {
  x: 2, y: 3, minus: 3, plus: 5, direction: "horizontal", display: "both",
  xMap, yMap, capWidth: 4, lineWidth: 1, pointsToX: 8, pointsToY: 3
};

it("rejects runtime directions outside the Cartesian port instead of interpreting them as vertical", () => {
  for (const direction of ["diagonal", "radial", "angular", undefined]) {
    expect(cartesianErrorBarSegments({ ...request, direction } as unknown as CartesianErrorBarRequest)).toEqual([]);
  }
});

it("preserves shaft and cap order on an inverted horizontal axis with unequal point scales", () => {
  expect(cartesianErrorBarSegments(request)).toEqual([
    { x1: 212, y1: 50, x2: 244, y2: 50 },
    { x1: 212, y1: 44, x2: 212, y2: 56 },
    { x1: 244, y1: 44, x2: 244, y2: 56 }
  ]);
  // Horizontal cap comparison uses Y conversion for cap and X for stroke.
  expect(cartesianErrorBarSegments({ ...request, lineWidth: 1.5 })).toEqual([
    { x1: 212, y1: 50, x2: 244, y2: 50 }
  ]);
});

it("retains off-axis geometry and suppresses only the disabled cap", () => {
  expect(cartesianErrorBarSegments({ ...request, plus: 20, display: "positive" })).toEqual([
    { x1: 152, y1: 50, x2: 232, y2: 50 },
    { x1: 152, y1: 44, x2: 152, y2: 56 }
  ]);
  expect(cartesianErrorBarSegments({ ...request, display: "negative" })).toEqual([
    { x1: 232, y1: 50, x2: 244, y2: 50 },
    { x1: 244, y1: 44, x2: 244, y2: 56 }
  ]);
});

it("rejects overflow only when its endpoint is enabled, and always rejects an invalid center", () => {
  const overflow = { ...request, x: Number.MAX_VALUE, plus: Number.MAX_VALUE };
  expect(cartesianErrorBarSegments(overflow)).toEqual([]);
  expect(cartesianErrorBarSegments({ ...overflow, display: "negative" })).toHaveLength(2);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    expect(cartesianErrorBarSegments({ ...request, x: invalid })).toEqual([]);
    expect(cartesianErrorBarSegments({ ...request, y: invalid })).toEqual([]);
  }
});

it("never checks a disabled logarithmic endpoint but rejects an enabled invalid endpoint", () => {
  const log = createAxisMap({ scale: "logarithmic", minimum: 1, maximum: 100, offset: 0, length: 10 });
  const bar = { ...request, xMap: log, minus: 3 };
  expect(cartesianErrorBarSegments(bar)).toEqual([]);
  expect(cartesianErrorBarSegments({ ...bar, display: "positive" })).toHaveLength(2);
  expect(cartesianErrorBarSegments({ ...bar, display: "none" })).toEqual([]);
});

it("handles shorter error vectors, empty inherited negative vectors and independent invalid signs", () => {
  expect(errorBarBounds({ type: "absolute", values: [1, 2, 3], positive: [4, 5], negative: [6] }, 2))
    .toEqual({ minus: 6, plus: -1 });
  expect(errorBarBounds({ type: "absolute", values: [1], positive: [4], negative: [] }, 0))
    .toEqual({ minus: 4, plus: 4 });
  for (const invalid of [0, -0, -2, NaN, Infinity, -Infinity]) {
    expect(errorBarBounds({ type: "absolute", values: [1], positive: [invalid], negative: [6] }, 0))
      .toEqual({ minus: 6, plus: -1 });
  }
});

it("retains native relative overflow and negative-zero sentinel behavior", () => {
  expect(errorBarBounds({ type: "relative", values: [Number.MAX_VALUE], positive: [2] }, 0))
    .toEqual({ minus: Infinity, plus: Infinity });
  const empty = errorBarBounds({ type: "percent", values: [-0], positive: [0], negative: [NaN] }, 0);
  expect(Object.is(empty?.minus, -0)).toBe(true);
  expect(Object.is(empty?.plus, -0)).toBe(true);
  expect(errorBarBounds({ type: "absolute", values: [1], positive: [2] }, 0.5)).toBeUndefined();
});
