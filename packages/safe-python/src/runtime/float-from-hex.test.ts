import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { floatFromHex } from "./float-from-hex.js";

function parse(source: string, meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 })) {
  const setup = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return floatFromHex(new RuntimeValues(setup).string(source).value, meter);
}

it("accepts optional prefixes, fractions, exponents and ASCII edge whitespace", () => {
  for (const [source, value] of [["10", 16], ["0x1", 1], ["1.", 1], [" .8 ", .5], ["\t-0X.8P+1\r", -1], ["1p-4", .0625]] as const) expect(parse(source)).toBe(value);
});
it("preserves signed zero and recognizes case-insensitive non-finite spellings", () => {
  expect(Object.is(parse("-0p999999999999999999999"), -0)).toBe(true);
  expect(parse("+Infinity")).toBe(Infinity); expect(parse("-INF")).toBe(-Infinity);
  expect(parse("NaN")).toBeNaN(); expect(parse("-nan")).toBeNaN();
});
it("rejects malformed syntax and non-ASCII whitespace", () => {
  for (const source of ["", " ", ".", "0x", "1p", "1p+", "1_0", "1 p0", "1p0x", "nanx", "0xinf", "\u00a01", "1\u00a0"]) expect(() => parse(source)).toThrow("invalid hexadecimal floating-point string");
});
it("rounds ties to even at normal and subnormal boundaries", () => {
  expect(parse("0x1.00000000000008p0")).toBe(1);
  expect(parse("0x1.0000000000000800000000000001p0")).toBe(1 + 2 ** -52);
  expect(parse("0x1.00000000000018p0")).toBe(1 + 2 ** -51);
  expect(parse("0x1p-1075")).toBe(0); expect(parse("0x1.000000000000000001p-1075")).toBe(Number.MIN_VALUE);
  expect(parse("0x3p-1075")).toBe(2 * Number.MIN_VALUE);
  expect(Object.is(parse("-1p-999999999999999999999"), -0)).toBe(true);
});
it("reports overflow but permits a zero coefficient with arbitrary exponents", () => {
  for (const source of ["1p99999999999999999999", "-1p1024", "0x1.fffffffffffff8p1023"]) expect(() => parse(source)).toThrow("hexadecimal value too large to represent as a float");
  expect(parse("0p99999999999999999999")).toBe(0);
});
it("uses bounded numeric working storage for long coefficients and meters scanning", () => {
  const source = "1" + "0".repeat(4000) + "p-16000";
  expect(parse(source, new ExecutionBudget({ maxSteps: 20000, maxAllocatedBytes: 4096 }))).toBe(1);
  expect(() => parse(source, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 4096 }))).toThrow(ExecutionLimitError);
});
