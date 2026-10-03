import { expect, it } from "vitest";
import { orientedBounds, rectanglesOverlap, positionLabel } from "./layout.js";

it("computes centered rotated label bounds independently of text and codec", () => {
  const box = orientedBounds({ x: 20, y: 30, width: 8, height: 4, angle: Math.PI / 4 });
  expect(box.width).toBeCloseTo(12 / Math.sqrt(2), 14);
  expect(box.height).toBeCloseTo(12 / Math.sqrt(2), 14);
  expect(box.x).toBeCloseTo(20 - box.width / 2, 14);
  expect(box.y).toBeCloseTo(30 - box.height / 2, 14);
});
it("positions axis labels from measured dimensions and ignores incoming center", () => {
  const box = { x: 100, y: 200, width: 10, height: 4, angle: 0 };
  expect(positionLabel(box, 0, 3, "left")).toEqual({ box: { ...box, x: 0, y: -5 }, anchor: "top-bottom" });
  const right = positionLabel(box, 0, 3, "right");
  expect(right.box.x).toBeCloseTo(0, 14);
  expect(right.box.y).toBe(5);
  expect(right.anchor).toBe("top-bottom");
});
it("selects left-right on tied projections and accepts an explicit anchor", () => {
  const box = { x: 0, y: 0, width: 10, height: 4, angle: 0 };
  expect(positionLabel({ ...box, width: 0, height: 0 }, 0, 0, "left").anchor).toBe("left-right");
  expect(positionLabel(box, 0, 3, "left", "left-right")).toEqual({ box: { ...box, x: -5, y: -5 }, anchor: "left-right" });
});
it("keeps label placement covariant under a shared arbitrary rotation", () => {
  const box = { x: 8, y: 9, width: 10, height: 4, angle: 0 };
  for (const angle of [-2.7, -0.75, 0.3, 2.2]) {
    for (const side of ["left", "right"] as const) {
      for (const anchor of ["top-bottom", "left-right"] as const) {
        const original = positionLabel(box, 0, -3, side, anchor);
        const rotated = positionLabel({ ...box, angle }, angle, -3, side, anchor);
        expect(rotated.anchor).toBe(anchor);
        expect(rotated.box.x).toBeCloseTo(original.box.x * Math.cos(angle) - original.box.y * Math.sin(angle), 13);
        expect(rotated.box.y).toBeCloseTo(original.box.x * Math.sin(angle) + original.box.y * Math.cos(angle), 13);
      }
    }
  }
});
it("retains signed dimensions for anchor displacement while using absolute projections", () => {
  const box = { x: 0, y: 0, width: -10, height: -4, angle: 0 };
  expect(positionLabel(box, 0, 3, "left")).toEqual({ box: { ...box, x: 0, y: -1 }, anchor: "top-bottom" });
  expect(positionLabel(box, 0, 3, "left", "left-right")).toEqual({ box: { ...box, x: 5, y: -5 }, anchor: "left-right" });
});
it("flips anchor displacement when rotated label projections change sign", () => {
  const box = { x: 0, y: 0, width: 10, height: 4, angle: Math.PI };
  const top = positionLabel(box, 0, 3, "left", "top-bottom");
  expect(top.box.x).toBeCloseTo(0, 14);
  expect(top.box.y).toBeCloseTo(-5, 14);
  const left = positionLabel({ ...box, angle: -Math.PI / 2 }, 0, 3, "left", "left-right");
  expect(left.box.x).toBeCloseTo(0, 14);
  expect(left.box.y).toBeCloseTo(-8, 14);
});
it("treats touching labels as overlapping and tests rotated separating axes", () => {
  const box = { x: 0, y: 0, width: 4, height: 2, angle: 0 };
  expect(rectanglesOverlap(box, { ...box, x: 4 })).toBe(true);
  expect(rectanglesOverlap(box, { ...box, x: 4.001 })).toBe(false);
  expect(rectanglesOverlap(box, { ...box, x: 0, y: 3.1, angle: Math.PI / 2 })).toBe(false);
  expect(rectanglesOverlap(box, { ...box, x: 0, y: 2.9, angle: Math.PI / 2 })).toBe(true);
});
it("uses the native hypot distance without overflow or underflow", () => {
  // go_geometry_cartesian_to_polar uses hypot, including at extreme scales.
  const large = { x: 0, y: 0, width: 4e200, height: 4e200, angle: 0 };
  expect(rectanglesOverlap(large, { ...large, x: 1e200 })).toBe(true);
  const small = { x: 0, y: 0, width: 1e-200, height: 1e-200, angle: 0 };
  expect(rectanglesOverlap(small, { ...small, x: 2e-200 })).toBe(false);
});
it("retains native projection addition grouping at a touching boundary", () => {
  const first = { x: 0, y: 0, width: 5.759409982711077, height: 100, angle: 0 };
  const second = { x: 10.167900002690219, y: 0, width: 6.622831611894071, height: 13.510147435590625, angle: 0.864475782494992 };
  // Native compares distance against pa + pb, with pb summed first.
  expect(rectanglesOverlap(first, second)).toBe(true);
});
