import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import { pieWedges } from "./pie.js";

function context(workbookWork = 100): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 1, operations: 100, workbookWork } };
}
const base = { values: [1, -1, NaN, 0], negativeMode: "white" as const, centerX: 10, centerY: 20, radius: 8, innerRadius: 2, initialAngle: 0, span: 100, separation: 0 };
it("retains data indices and white negative wedges, skipping nonfinite and zero data", () => {
  const wedges = [...pieWedges(base, context())];
  expect(wedges.map(w => [w.index, w.whiteFill])).toEqual([[0, false], [1, true]]);
  expect(wedges[0]?.startAngle).toBe(-Math.PI / 2);
  // Captured with the pinned C expression order, not simplified pi multiples.
  expect(wedges[0]?.endAngle).toBe(1.570796326794897);
  expect(wedges[1]?.endAngle).toBe(4.712388980384691);
  expect(wedges[0]?.innerRadius).toBe(2);
});
it("skips negative values in both totals and geometry", () => {
  const wedges = [...pieWedges({ ...base, negativeMode: "skip" }, context())];
  expect(wedges).toHaveLength(1);
  expect(wedges[0]?.endAngle).toBe(4.712388980384691);
});
it("does not advance angles for slices smaller than the native 1e-3 threshold", () => {
  const wedges = [...pieWedges({ ...base, values: [1e-6, 1], separation: 0.25 }, context())];
  expect(wedges).toHaveLength(1);
  expect(wedges[0]?.index).toBe(1);
  expect(wedges[0]?.startAngle).toBeCloseTo(-Math.PI / 2, 14);
  expect(wedges[0]?.centerY).toBeCloseTo(22, 10);
});
it("charges all data even when no wedge is renderable and checks cancellation while iterating", () => {
  expect(() => [...pieWedges({ ...base, values: [0, 0, 0] }, context(2))]).toThrow("work limit");
  const controller = new AbortController(), reason = new Error("stop");
  const iterator = pieWedges(base, { ...context(), signal: controller.signal });
  expect(iterator.next().done).toBe(false);
  controller.abort(reason);
  expect(() => iterator.next()).toThrow(reason);
});
it("accumulates totals in reverse native order and drops overflowed totals", () => {
  const wedges = [...pieWedges({ ...base, values: [1e16, 1, 1] }, context())];
  expect(wedges).toHaveLength(1);
  expect(wedges[0]?.endAngle).toBe(4.712388980384689);
  expect([...pieWedges({ ...base, values: [Number.MAX_VALUE, Number.MAX_VALUE] }, context())]).toEqual([]);
  expect([...pieWedges({ ...base, values: [Infinity, -Infinity, NaN, 0] }, context())]).toEqual([]);
});
it("includes an exact 1e-3 wedge and keeps overrides aligned after skipped data", () => {
  const scale = 2 * Math.PI / 100 * 100;
  const value = 0.001 / scale;
  const wedges = [...pieWedges({ ...base, values: [NaN, value, 1 - value],
    elementSeparation: new Map([[0, 99], [1, -0.25]]) }, context())];
  expect(wedges.map(w => w.index)).toEqual([1, 2]);
  expect(wedges[0]?.endAngle).toBe(-Math.PI / 2 + 0.001);
  expect(wedges[0]?.centerY).toBeCloseTo(21.999999750000004, 13);
  expect(wedges[1]?.centerX).toBe(10);
  expect(wedges[1]?.centerY).toBe(20);
});
it("admits exactly the two data passes plus initial work and observes final-yield cancellation", () => {
  const request = { ...base, values: [1] };
  expect([...pieWedges(request, context(3))]).toHaveLength(1);
  expect(() => [...pieWedges(request, context(2))]).toThrow("work limit");
  const controller = new AbortController(), reason = new Error("final stop");
  const iterator = pieWedges(request, { ...context(), signal: controller.signal });
  expect(iterator.next().done).toBe(false);
  controller.abort(reason);
  expect(() => iterator.next()).toThrow(reason);
});
it("observes cancellation before reading any caller data", () => {
  const controller = new AbortController(), reason = new Error("before start");
  controller.abort(reason);
  const values = { get length(): number { throw new Error("data accessed"); } } as unknown as readonly number[];
  const iterator = pieWedges({ ...base, values }, { ...context(), signal: controller.signal });
  expect(() => iterator.next()).toThrow(reason);
});
