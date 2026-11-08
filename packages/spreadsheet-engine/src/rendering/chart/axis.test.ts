import { describe, expect, it } from "vitest";
import { createAxisMap } from "./axis.js";

describe("GOffice 0.10.61 explicit-bound axis mapping", () => {
  it("uses explicit invalid-bound fallback intercepts for infinite circular lengths", () => {
    const request = { minimum: 3, maximum: 3, offset: 7, length: Infinity, circular: true };
    const category = createAxisMap({ ...request, scale: "category" });
    expect(category.valid).toBe(false);
    expect(category.fromView(50)).toBe(0);
    const logarithmic = createAxisMap({ ...request, scale: "logarithmic" });
    expect(logarithmic.valid).toBe(false);
    expect(logarithmic.fromView(50)).toBe(1);
  });
  it("preserves category inverse infinities, NaN, signed zero and negative ties", () => {
    const map = createAxisMap({ scale: "category", minimum: 0, maximum: 1, offset: 0, length: 1 });
    expect(map.fromView(Infinity)).toBe(Infinity);
    expect(map.fromView(-Infinity)).toBe(-Infinity);
    expect(map.fromView(NaN)).toBeNaN();
    expect(Object.is(map.fromView(-0.5), -0)).toBe(true);
    expect(map.fromView(-1.5)).toBe(-2);
    expect(map.fromView(-2.5)).toBe(-2);
    expect(map.isFinite(Infinity)).toBe(false);
    expect(map.isFinite(NaN)).toBe(false);
  });
  it.each(["linear", "category", "logarithmic"] as const)("keeps normalized inversion separate from finite-value admission for %s", scale => {
    const map = createAxisMap({ scale, minimum: 1, maximum: 9, offset: 0, length: 80, inverted: true });
    expect(map.normalized(1)).toBe(1);
    expect(map.normalized(9)).toBe(0);
    expect(map.isFinite(-1)).toBe(scale !== "logarithmic");
    expect(map.isFinite(NaN)).toBe(false);
  });
  it("uses the linear baseline algorithm even when category origin differs", () => {
    const map = createAxisMap({ scale: "category", minimum: 1, maximum: 5, offset: 10, length: 80 });
    expect(map.toView(1)).toBe(10);
    expect(map.baseline()).toBe(-10);
  });
  it("uses category coordinates and nearest-even inverse rounding", () => {
    const map = createAxisMap({ scale: "category", minimum: 1, maximum: 5, offset: 10, length: 80 });
    expect(map.toView(2)).toBe(30);
    expect(map.fromView(40)).toBe(2);
    expect(map.fromView(60)).toBe(4);
  });
  it("applies spans before inversion and retains negative viewport lengths", () => {
    const map = createAxisMap({ scale: "linear", minimum: -2, maximum: 6, offset: 100, length: -80, spanStart: 0.25, spanEnd: 0.75, inverted: true });
    expect(map.toView(-2)).toBe(40);
    expect(map.toView(6)).toBe(80);
    expect(map.normalized(-2)).toBe(1);
    expect(map.derivative(2)).toBe(5);
    expect(map.baseline()).toBe(50);
    expect(map.fromView(50)).toBe(0);
  });
  it("does not apply spans to circular axes", () => {
    const map = createAxisMap({ scale: "linear", minimum: 0, maximum: 360, offset: 0, length: 2 * Math.PI, circular: true, spanStart: 0.25, spanEnd: 0.75 });
    expect(map.toView(360)).toBe(2 * Math.PI);
  });
  it("preserves native logarithmic invalid-value sentinels and fallback bounds", () => {
    const map = createAxisMap({ scale: "logarithmic", minimum: -1, maximum: 100, offset: 20, length: 60, inverted: true });
    expect(map.valid).toBe(false);
    expect(map.toView(0)).toBe(-Number.MAX_VALUE);
    expect(map.toView(-1)).toBe(-Number.MAX_VALUE);
    expect(map.toView(NaN)).toBeNaN();
    expect(map.derivative(0)).toBeNaN();
    expect(map.isFinite(0)).toBe(false);
    expect(map.bounds()[0]).toBe(1);
    expect(map.bounds()[1]).toBeCloseTo(10, 14);
    expect(map.baseline()).toBe(80);
  });
  it("maps log data using natural logarithms without clamping outside bounds", () => {
    const map = createAxisMap({ scale: "logarithmic", minimum: 1, maximum: 100, offset: 10, length: 80 });
    expect(map.valid).toBe(true);
    expect(map.toView(10)).toBeCloseTo(50, 13);
    expect(map.fromView(50)).toBeCloseTo(10, 13);
    expect(map.toView(1000)).toBeCloseTo(130, 12);
    expect(map.derivative(10)).toBeCloseTo(80 / Math.log(100) / 10, 14);
  });
  it.each([[3, 3], [Infinity, 4], [NaN, 4], [4, 3]])("retains an invalid map with fallback linear bounds %s %s", (minimum, maximum) => {
    const map = createAxisMap({ scale: "linear", minimum, maximum, offset: 7, length: 9 });
    expect(map.valid).toBe(false);
    expect(map.bounds()).toEqual([0, 1]);
    expect(map.toView(0.5)).toBe(11.5);
  });
});
