import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { readDurationUnitOptions, readDurationOptions } from "./intl-duration-options.js";

it.each([
  ["hours", "digital", "", "numeric", "always"],
  ["minutes", "long", "numeric", "2-digit", "always"],
  ["seconds", "long", "2-digit", "2-digit", "always"],
  ["milliseconds", "long", "numeric", "fractional", "auto"],
  ["microseconds", "long", "fractional", "fractional", "auto"],
  ["years", "digital", "", "short", "auto"],
  ["days", "long", "", "long", "auto"]
])("resolves %s defaults under %s after %s", async (unit, base, previous, style, display) => {
  expect(await readDurationUnitOptions({}, unit, base, previous, new Budget())).toEqual({ style, display });
});

it.each([
  { milliseconds: "numeric", millisecondsDisplay: "always" },
  { milliseconds: "long" },
  { milliseconds: "2-digit" }
])("rejects invalid subsecond options %j", async input => {
  await expect(readDurationUnitOptions(input, "milliseconds", "long", "numeric", new Budget())).rejects.toBeInstanceOf(RangeError);
});

it("validates a unit style before reading its display option", async () => {
  const trace: string[] = [];
  await expect(readDurationUnitOptions({}, "days", "short", "", new Budget(), {
    stack: [], getProperty: async (_input, key) => {
      trace.push(String(key));
      return "numeric";
    }
  })).rejects.toBeInstanceOf(RangeError);
  expect(trace).toEqual(["days"]);
});

it("resolves top-level options and fractional digit coercion", async () => {
  const result = await readDurationOptions({ style: "digital", numberingSystem: "foobar", fractionalDigits: "2.9" }, ["fi"], new Budget());
  expect(result).toMatchObject({ locale: "fi", numberingSystem: "latn", separator: ".", style: "digital", fractionalDigits: 2,
    units: { minutes: { style: "2-digit", display: "always" }, milliseconds: { style: "fractional", display: "auto" } } });
});

it.each([NaN, -1, 10, Infinity])("rejects fractionalDigits %s", async fractionalDigits => {
  await expect(readDurationOptions({ fractionalDigits }, ["en"], new Budget())).rejects.toBeInstanceOf(RangeError);
});

it.each([null, 3, true, "x", 1n])("rejects non-object constructor options %s", async input => {
  await expect(readDurationOptions(input, ["en"], new Budget())).rejects.toBeInstanceOf(TypeError);
});
