import { expect, it } from "vitest";
import { parseFormatSpec } from "./format-spec.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function parse(text: string, type = 0, align: "<" | ">" = ">") {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return parseFormatSpec(new CodePointString(Uint32Array.from([...text].map(c => c.codePointAt(0)!)), meter), type, align, "T", meter);
}
it("parses fill, alignment, sign, z, alternate, width and precision", () => {
  expect(parse("😀^+z#12,.3_f")).toEqual({ fill: 0x1f600, align: "^", sign: "+", noNegativeZero: true, alternate: true, width: 12n, grouping: ",", groupSize: 3, precision: 3n, fractionGrouping: "_", type: 102 });
  expect(parse("", 115, "<")).toEqual({ fill: 32, align: "<", sign: null, noNegativeZero: false, alternate: false, width: null, grouping: null, groupSize: 3, precision: null, fractionGrouping: null, type: 115 });
});
it("distinguishes explicit fill, explicit alignment and zero padding", () => {
  expect(parse("05d")).toMatchObject({ fill: 48, align: "=", width: 5n });
  expect(parse("05", 115, "<")).toMatchObject({ fill: 48, align: "<", width: 5n });
  expect(parse(">05")).toMatchObject({ fill: 48, align: ">", width: 5n });
  expect(parse("x>05")).toMatchObject({ fill: 120, align: ">", width: 5n });
  expect(parse("0")).toMatchObject({ fill: 48, align: "=", width: null });
  expect(parse("00")).toMatchObject({ fill: 48, width: 0n });
});
it("accepts mixed Unicode decimal digits and rejects numeric non-decimals", () => {
  expect(parse("١２𝟛.４٥f")).toMatchObject({ width: 123n, precision: 45n });
  expect(parse("²")).toMatchObject({ width: null, type: 178 });
  expect(parse("٠5")).toMatchObject({ fill: 32, align: ">", width: 5n });
});
it("bounds numeric fields to signed platform size with checked accumulation", () => {
  expect(parse("9223372036854775807.9223372036854775807f")).toMatchObject({ width: 9223372036854775807n, precision: 9223372036854775807n });
  for (const spec of ["9223372036854775808", ".9223372036854775808f", "999999999999999999999999"]) expect(() => parse(spec)).toThrow("Too many decimal digits in format string");
});
it("parses grouping on both sides of the decimal point", () => {
  expect(parse("_x")).toMatchObject({ grouping: "_", groupSize: 4 });
  expect(parse(".,f")).toMatchObject({ precision: null, fractionGrouping: ",", type: 102 });
  expect(parse("._f")).toMatchObject({ precision: null, fractionGrouping: "_", type: 102 });
  for (const spec of [",_f", "_,f", ".,_f", "._,f", ".2,_f", ".2_,f"]) expect(() => parse(spec)).toThrow("Cannot specify both ',' and '_'.");
});
it("retains shared validation precedence and type-specific checks for callers", () => {
  expect(() => parse(".")).toThrow("Format specifier missing precision");
  expect(() => parse(".f")).toThrow("Format specifier missing precision");
  expect(() => parse("10qq")).toThrow("Invalid format specifier '10qq' for object of type 'T'");
  expect(() => parse(",x")).toThrow("Cannot specify ',' with 'x'.");
  expect(() => parse("_n")).toThrow("Cannot specify '_' with 'n'.");
  expect(() => parse("._n")).toThrow("Cannot specify '_' with 'n'.");
  expect(() => parse(",😀")).toThrow("Cannot specify ',' with '\\x1f600'.");
  expect(parse("+zs", 115, "<")).toMatchObject({ sign: "+", noNegativeZero: true, type: 115 });
});
it("retains surrogate fill code points and respects allocation limits", () => {
  expect(parse("\ud800^5s")).toMatchObject({ fill: 0xd800, align: "^" });
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }), source = new CodePointString(Uint32Array.of(49, 48), meter);
  expect(() => parseFormatSpec(source, 0, ">", "T", new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1 }))).toThrow(ExecutionLimitError);
});
