import { expect, it } from "vitest";
import { createMetric } from "./metric.js";

it("bounds metric history and distinguishes missing samples", () => {
  const metric = createMetric({ capacity: 3, unit: "ms" }); [1, 2, 3, 4].forEach(x => metric.push(x));
  expect(metric.samples()).toEqual([2, 3, 4]); expect(metric.render(30)).toContain("4 ms"); metric.push(null); expect(metric.render(30)).toContain("— ms");
});
