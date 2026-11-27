import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-io-engine/commands/text-programs/shared";
import { string, inputValue, inputValueFromSlice, formatted, numeric, text } from "./awk-values.js";

test("dynamic scalars do not share tenant data through module caches", () => {
  for (const value of ["tenant-secret", "\ud800", "\u0100", "a\udfff"]) {
    assert.deepEqual(string(value), { kind: "string", text: value });
    assert.notEqual(string(value), string(value));
  }
  assert.notEqual(inputValue("secret"), inputValue("secret"));
  assert.notEqual(inputValueFromSlice("a secret b", 2, 8), inputValueFromSlice("a secret b", 2, 8));
});

for (const [format, value, expected] of [
  ["%.0f", 0.5, "0"], ["%.0f", 1.5, "2"], ["%.0f", 2.5, "2"],
  ["%.1f", 0.25, "0.2"], ["%.1f", 0.75, "0.8"],
  ["%.0f", -2.5, "-2"], ["%.1f", -0.25, "-0.2"],
  ["%.0f", -0.5, "-0"], ["%+.0f", -0, "-0"],
  ["%.2f", 2.675, "2.67"], ["%.2f", 2.685, "2.69"],
  ["%.0f", 0.5000000000000001, "1"], ["%.0f", 0.49999999999999994, "0"],
  ["%.0f", 1e21, "1000000000000000000000"],
  ["%.0e", 2.5, "2e+00"], ["%.0E", 3.5, "4E+00"],
  ["%.1e", 1.25, "1.2e+00"], ["%.1e", 1.75, "1.8e+00"],
  ["%.0e", 9.5, "1e+01"], ["%.1e", 9.96875, "1.0e+01"],
  ["%.1g", 2.5, "2"], ["%.0g", 2.5, "2"], ["%.1G", 3.5, "4"],
  ["%.2g", 1.25, "1.2"], ["%.2g", 1.75, "1.8"],
  ["%.1g", 9.5, "1e+01"], ["%.2g", 99.5, "1e+02"],
  ["%.1g", 0.000099999, "0.0001"], ["%.1g", 0.0000099999, "1e-05"],
  ["%#.0f", 2.5, "2."], ["%#.0e", 2.5, "2.e+00"],
  ["%#.1g", 2.5, "2."], ["%#.2g", 99.5, "1.0e+02"],
  ["%+.1f", 0.25, "+0.2"], ["%08.1f", -0.25, "-00000.2"],
  ["%.0f", 0, "0"], ["%.0e", 0, "0e+00"], ["%#.3g", 0, "0.00"],
  ["%.1g", Number.MIN_VALUE, "5e-324"], ["%.1g", Number.MAX_VALUE, "2e+308"],
  ["%.101f", 0.25, "0.25" + "0".repeat(99)],
  ["%.101e", 0.25, "2.5" + "0".repeat(100) + "e-01"],
  ["%.101g", 0.25, "0.25"],
] as const) test(`floating format ${format} of ${value} matches awk`, () => {
  assert.equal(formatted(format, [numeric(value)], text), expected);
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, { maxBufferBytes: expected.length });
  assert.equal(formatted(format, [numeric(value)], text, budget), expected);
});
