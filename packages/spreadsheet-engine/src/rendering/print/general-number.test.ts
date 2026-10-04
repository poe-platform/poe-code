import {expect, it} from "vitest";
import {rendered} from "../../formulas/values.js";
import {formatGeneralNumber} from "./general-number.js";

// GOffice0.10.61 go_render_general, native measure_strlen and unit-width metrics.
const controls: readonly (readonly [string, readonly string[]])[] = [
  ["0", ["0", "0", "0", "0", "0", "0", "0"]],
  ["-0", ["0", "0", "−0", "−0", "−0", "−0", "−0"]],
  ["1.25", ["1E+00", "1", "1.25", "1.25", "1.25", "1.25", "1.25"]],
  ["1.125", ["1E+00", "1", "1.13", "1.125", "1.125", "1.125", "1.125"]],
  ["1.2345678901234567", ["1E+00", "1", "1.23", "1.2346", "1.23456789", "1.23456789012346", "1.2345678901234567"]],
  ["9.5", ["1E+01", "1E+01", "9.5", "9.5", "9.5", "9.5", "9.5"]],
  ["99.5", ["1E+02", "1E+02", "99.5", "99.5", "99.5", "99.5", "99.5"]],
  ["-0.125", ["0", "0", "−0.1", "−0.125", "−0.125", "−0.125", "−0.125"]],
  ["-123456789012345", ["−1E+14", "−1E+14", "−1E+14", "−1E+14", "−1.235E+14", "−123456789012345", "−123456789012345"]],
  ["123456789012345", ["1E+14", "1E+14", "1E+14", "1E+14", "1.2346E+14", "123456789012345", "123456789012345"]],
  ["1e-5", ["0", "0", "0", "1E−05", "1E−05", "1E−05", "1E−05"]],
  ["0.0001", ["0", "0", "0", "0.0001", "0.0001", "0.0001", "0.0001"]],
  ["1e15", ["1E+15", "1E+15", "1E+15", "1E+15", "1E+15", "1000000000000000", "1000000000000000"]],
  ["1e17", ["1E+17", "1E+17", "1E+17", "1E+17", "1E+17", "1E+17", "1E+17"]],
  ["1.7976931348623157e308", ["2E+308", "2E+308", "2E+308", "2E+308", "1.798E+308", "1.797693135E+308", "1.7976931348623157E+308"]],
  ["5e-324", ["0", "0", "0", "5E−324", "5E−324", "5E−324", "5E−324"]],
];
it.each(controls.flatMap(([input, expected]) => [0,1,4,6,10,16,24].map((width,i) => ({input,width,expected:expected[i]}))))
  ("matches native General $input at width $width", ({input,width,expected}) => {
    const value = Number(input), initial = rendered({kind: "number", value}).split("-").join("−");
    expect(formatGeneralNumber(value, initial, width, text => Array.from(text).length, "C", () => {})).toBe(expected);
  });
it("keeps locale decimal separators during measured precision reduction", () => {
  expect(formatGeneralNumber(1.23456789, "1,23456789", 5, text => text.length, "de_DE", () => {})).toBe("1,235");
});
it("charges work throughout candidate selection", () => {
  let work = 0;
  expect(() => formatGeneralNumber(1.23456789, "1.23456789", 5, text => text.length, "C", () => {
    if (++work > 5) throw new Error("budget");
  })).toThrow("budget");
});

it("retains ASCII minus when Unicode minus is disabled", () => {
  expect(formatGeneralNumber(-123456789, "-123456789", 7, text => text.length, "C", () => {}, false)).toBe("-1E+08");
});
