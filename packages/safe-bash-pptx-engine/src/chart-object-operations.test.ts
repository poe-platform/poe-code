import { expect, it } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { chartObjectSchema, validateChartObjectUpdates } from "./chart-object-operations.js";

it("admits explicit chart object edits and rejects arbitrary paths before I/O", () => {
  const edits = [
    { target: "legend", position: "BOTTOM", includeInLayout: false },
    { target: "valueAxis", minimumScale: 0, maximumScale: null },
    { target: "marker", series: 0, point: 1, size: 12, style: "DIAMOND" }
  ];
  expect(() => validateChartObjectUpdates(edits)).not.toThrow();
  const validator = compileJsonSchema(chartObjectSchema);
  expect(validator.validate(edits).ok).toBe(true);
  for (const invalid of [
    [],
    [{ target: "constructor", value: "anything" }],
    [{ target: "legend", position: "UNKNOWN" }],
    [{ target: "marker", series: -1, size: 12 }],
    [{ target: "marker", series: 0, size: 73 }],
    [{ target: "valueAxis", minimumScale: "zero" }],
    [{ target: "legend", arbitrary: true }]
  ]) {
    expect(() => validateChartObjectUpdates(invalid)).toThrow();
    expect(validator.validate(invalid).ok).toBe(false);
  }
});

it("rejects sparse arrays and accessors without invoking user code", () => {
  let calls = 0;
  const getter = {
    get target() {
      calls++;
      return "chart";
    },
    hasTitle: true
  };
  const arrayGetter: unknown[] = [];
  Object.defineProperty(arrayGetter, "0", {
    enumerable: true,
    get() {
      calls++;
      return { target: "chart", hasTitle: true };
    }
  });
  for (const input of [
    new Array(1),
    arrayGetter,
    [getter],
    Object.assign([{ target: "chart", hasTitle: true }], { extra: 1 })
  ])
    expect(() => validateChartObjectUpdates(input)).toThrow();
  expect(calls).toBe(0);
});

it("uses the shared drawing schema for explicit owned chart formatting", () => {
  const update = [
    {
      target: "format",
      owner: "valueMajorGridlines",
      drawing: {
        line: {
          width: { value: 2, unit: "pt" },
          fill: { kind: "solid", color: { theme: "accent2", brightness: 0.3 } }
        },
        shadowInherit: false
      }
    }
  ];
  expect(() => validateChartObjectUpdates(update)).not.toThrow();
  expect(compileJsonSchema(chartObjectSchema).validate(update).ok).toBe(true);
  expect(() =>
    validateChartObjectUpdates([
      { target: "format", owner: "point", series: 0, drawing: { fill: { kind: "none" } } }
    ])
  ).toThrow();
});
