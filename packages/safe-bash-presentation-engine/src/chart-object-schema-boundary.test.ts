import { expect, it } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { chartObjectSchema, validateChartObjectUpdates } from "./chart-object-operations.js";

const validator = compileJsonSchema(chartObjectSchema);
it.each([
  { target: "legend", horzOffset: -1.001 },
  { target: "legend", horzOffset: 1.001 },
  { target: "valueAxis", majorUnit: 0 },
  { target: "valueAxis", minorUnit: 0 },
  { target: "valueAxis", majorUnit: -0.5 },
  { target: "valueAxis", minorUnit: -0.5 },
  { target: "legend", position: "CUSTOM" },
  { target: "dataLabels", plot: 0, position: "MIXED" },
  { target: "dataLabel", series: 0, point: 0, position: "MIXED" }
])("schema and runtime reject setter-inadmissible values %j", (update) => {
  expect.soft(validator.validate([update]).ok).toBe(false);
  expect(() => validateChartObjectUpdates([update])).toThrow();
});
it.each([
  { target: "legend", horzOffset: -1 },
  { target: "legend", horzOffset: 1 },
  { target: "valueAxis", majorUnit: Number.MIN_VALUE },
  { target: "valueAxis", minorUnit: 0.5 },
  { target: "valueAxis", majorUnit: null, minorUnit: null },
  { target: "dataLabels", plot: 0, position: null },
  { target: "dataLabel", series: 0, point: 0, position: null },
  { target: "marker", series: 0, style: null, size: null },
  { target: "valueAxis", crosses: "CUSTOM" }
])("schema and runtime retain valid setter boundaries %j", (update) => {
  expect(validator.validate([update]).ok).toBe(true);
  expect(() => validateChartObjectUpdates([update])).not.toThrow();
});

it("admits documented null clearing for legend layout and bubble scale", () => {
  const updates = [
    { target: "legend", horzOffset: null, includeInLayout: null },
    { target: "plot", plot: 0, bubbleScale: null }
  ];
  expect(() => validateChartObjectUpdates(updates)).not.toThrow();
  expect(compileJsonSchema(chartObjectSchema).validate(updates).ok).toBe(true);
});
