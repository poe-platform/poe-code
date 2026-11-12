import { expect, it } from "vitest";
import { svgPathSteps, svgPathTokens, type SvgPathPoint } from "./svg-path.js";

it("keeps arc subdivision bounded and updates the following relative endpoint", () => {
  const tokens = svgPathTokens("M0,0 A1000000,1000000 0 1 1 2000000,0 l1,2");
  const steps = svgPathSteps(), points: SvgPathPoint[] = [];
  let next = steps.next();
  while (!next.done) {
    if (next.value === undefined) next = steps.next(tokens.next().value);
    else { points.push(next.value); next = steps.next(); }
  }
  expect(points.length).toBeGreaterThan(3);
  expect(points.length).toBeLessThanOrEqual(3202);
  expect(points.every(point => point.every(Number.isFinite))).toBe(true);
  expect(points.at(-2)).toEqual([2000000, 0]);
  expect(points.at(-1)).toEqual([2000001, 2]);
});
