import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { parseFloatText } from "./float-text.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 4000000 }), values = new RuntimeValues(meter);
  return { meter, values, parse: (text: string) => parseFloatText(values.string(text).value,meter) };
}

it("parses decimal floats, underscores, special values and signed zero", () => {
  const { parse } = fixture();
  expect(parse(" \t-1_234.5_0e-0_1\n")).toBe(-123.45);
  expect(parse(".5")).toBe(.5);expect(parse("1.e2")).toBe(100);
  expect(parse("+InFiNiTy")).toBe(Infinity);expect(parse("-inf")).toBe(-Infinity);
  expect(parse("NaN")).toBeNaN();expect(parse("-nan")).toBeNaN();
  expect(Object.is(parse("-0"),-0)).toBe(true);expect(Object.is(parse("-1e-9999"),-0)).toBe(true);
  expect(parse("1e9999")).toBe(Infinity);
});

it("normalizes Unicode decimal digits and whitespace only for strings", () => {
  const { parse, values, meter } = fixture();
  expect(parse("\u2003-١.٢e٣\u00a0")).toBe(-1200);
  expect(parseFloatText(values.bytes([32,49,46,53,10]).value,meter)).toBe(1.5);
  expect(()=>parseFloatText(values.bytes([0xa0,49]).value,meter)).toThrow("could not convert string to float: b'\\xa01'");
});

it("preserves parsed NaN sign bits through transpilation", () => {
  const { parse } = fixture(), bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0,parse("-NaN"));expect(bits.getBigUint64(0)).toBe(0xfff8000000000000n);
  bits.setFloat64(0,parse("+NaN"));expect(bits.getBigUint64(0)).toBe(0x7ff8000000000000n);
});

it.each(["", " ", "+", "_1", "1_", "1__2", "1_.0", "1._0", "1e_1", "1_e1", "1e", "1e+", ".", "0x1", "1 2", "1\u0000", "\u001c1", "nan(x)", "in_f", "infinityx", "１２e＋３"])("rejects invalid float syntax %j", text => {
  expect(()=>fixture().parse(text)).toThrow("could not convert string to float:");
});

it("accepts long decimals without integer-string limits and meters conversion", () => {
  const { parse, values } = fixture();
  expect(parse("0".repeat(5000)+"1")).toBe(1);
  expect(parse("9".repeat(5000))).toBe(Infinity);
  const source=values.string("1".repeat(10000)).value;
  expect(()=>parseFloatText(source,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  expect(()=>parseFloatText(source,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
});
