import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { parseIntegerText } from "./integer-text.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 4000000 }), values = new RuntimeValues(meter);
  return { meter, values, parse: (text: string, base = 10, limit = 4300) => parseIntegerText(values.string(text).value, base, meter, limit) };
}

it("parses signed and underscored integers in all supported bases", () => {
  const { parse } = fixture();
  expect(parse(" \t-1_234\n")).toBe(-1234n);
  for (let base = 2; base <= 36; base++) expect(parse((1234567).toString(base), base)).toBe(1234567n);
  expect(parse("+0x_ff", 0)).toBe(255n); expect(parse("0b_10", 2)).toBe(2n);
  expect(parse("0_0_0", 0)).toBe(0n); expect(parse("0123", 10)).toBe(123n);
});

it("accepts Unicode decimal digits and whitespace only for text", () => {
  const { parse, values, meter } = fixture();
  expect(parse("\u2003-١٢٣\u00a0")).toBe(-123n); expect(parse("٠x_FF", 0)).toBe(255n);
  expect(parseIntegerText(values.bytes(new Uint8Array([32,43,49,50,32])).value,10,meter)).toBe(12n);
  expect(() => parseIntegerText(values.bytes(new Uint8Array([0xa0,49])).value,10,meter)).toThrow("invalid literal for int() with base 10");
  expect(() => parse("\u001c12")).toThrow("invalid literal");
});

it.each(["", " ", "+", "_1", "1_", "1__2", "0x", "0x__1", "01", "0_1", "1 2", "1\u0000"])("rejects invalid auto-base syntax %j", text => {
  expect(() => fixture().parse(text,0)).toThrow("invalid literal for int() with base 0");
});

it("validates bases before syntax and limits only non-power-of-two conversions", () => {
  const { parse } = fixture();
  for (const base of [-1,1,37]) expect(() => parse("bad",base)).toThrow("int() base must be >= 2 and <= 36, or 0");
  expect(() => parse("0".repeat(641),10,640)).toThrow("value has 641 digits");
  expect(parse("1".repeat(1000),2,640)).toBe((1n<<1000n)-1n);
  expect(parse("9".repeat(1000),10,0)).toBe(10n**1000n-1n);
});

it("charges work and allocation for long integer input", () => {
  const { values } = fixture(), source=values.string("1".repeat(10000)).value;
  expect(() => parseIntegerText(source,2,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  expect(() => parseIntegerText(source,2,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
});
