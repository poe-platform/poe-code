import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import { createAxisMap } from "./axis.js";
import { cartesianSeriesPath, type CartesianInterpolation, type CartesianSeriesRequest } from "./line.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 1, operations: 10, workbookWork: 4 } };
const map = createAxisMap({ scale: "linear", minimum: 0, maximum: 10, offset: 10, length: -20 });
const request: CartesianSeriesRequest = { count: 2, x: [1, 4], y: [2, 8], xMap: map, yMap: map, interpolation: "linear", skipInvalid: false };

it("uses the declared invalid-request diagnostic for invalid point counts", () => {
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => [...cartesianSeriesPath({ ...request, count }, context)]).toThrow(expect.objectContaining({ code: "invalid-request" }));
  }
});

it("retains source step order on reversed maps", () => {
  const cases: readonly [CartesianInterpolation, readonly [number, number][]][] = [
    ["linear", []], ["step-start", [[2, 6]]], ["step-end", [[8, -6]]],
    ["step-center-x", [[5, 6], [5, -6]]], ["step-center-y", [[8, 0], [2, 0]]]
  ];
  for (const [interpolation, middle] of cases) {
    expect([...cartesianSeriesPath({ ...request, interpolation }, context)]).toEqual([
      { kind: "move", x: 8, y: 6 }, ...middle.map(([x, y]) => ({ kind: "line", x, y })), { kind: "line", x: 2, y: -6 }
    ]);
  }
});

it("checks cancellation at every emitted command boundary including final settlement", () => {
  for (const interpolation of ["linear", "step-start", "step-end", "step-center-x", "step-center-y"] as const) {
    const count = [...cartesianSeriesPath({ ...request, interpolation }, context)].length;
    for (let boundary = 0; boundary <= count; boundary++) {
      const controller = new AbortController(), reason = new Error(`${interpolation}:${boundary}`);
      const iterator = cartesianSeriesPath({ ...request, interpolation }, { ...context, signal: controller.signal });
      for (let emitted = 0; emitted < boundary; emitted++) expect(iterator.next().done).toBe(false);
      controller.abort(reason);
      expect(() => iterator.next()).toThrow(reason);
    }
  }
});

it("charges missing vector slots and supports a zero-point empty path", () => {
  expect([...cartesianSeriesPath({ ...request, count: 0 }, { ...context, limits: { ...context.limits, workbookWork: 0 } })]).toEqual([]);
  expect(() => [...cartesianSeriesPath({ ...request, count: 3, x: [], y: [] }, { ...context, limits: { ...context.limits, workbookWork: 2 } })]).toThrow(expect.objectContaining({ code: "resource-limit" }));
  expect([...cartesianSeriesPath({ ...request, count: 4, x: [1, NaN, 4], y: [2, 3, 8], skipInvalid: true }, context)]).toEqual([
    { kind: "move", x: 8, y: 6 }, { kind: "line", x: 2, y: -6 }
  ]);
});

it("rejects unknown runtime interpolation before emitting any points", () => {
  expect(() => [...cartesianSeriesPath({ ...request, interpolation: "spline" } as unknown as CartesianSeriesRequest, context)])
    .toThrow(expect.objectContaining({ code: "unsupported-feature" }));
});

it("rejects both finite DBL_MAX mapped sentinels without treating them as valid path vertices", () => {
  const identity = createAxisMap({ scale: "linear", minimum: 0, maximum: 1, offset: 0, length: 1 });
  for (const sentinel of [Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, NaN]) {
    expect([...cartesianSeriesPath({ ...request, count: 3, x: [1, sentinel, 4], y: [2, 3, 8], xMap: identity }, context)])
      .toEqual([{ kind: "move", x: 1, y: 6 }, { kind: "move", x: 4, y: -6 }]);
  }
});
