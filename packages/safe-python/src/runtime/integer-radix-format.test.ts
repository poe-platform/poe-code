import { expect, it } from "vitest";
import { renderIntegerRadixFormat } from "./integer-radix-format.js";
import { parseFormatSpec } from "./format-spec.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const field = (spec: string) => parseFormatSpec(new CodePointString(Uint32Array.from([...spec], c => c.codePointAt(0)!)), 100, ">", "int", meter);
  const format = (value: bigint, spec: string) => String.fromCodePoint(...renderIntegerRadixFormat(value, field(spec), meter));
  return { meter, field, format };
}
it("renders integer bases, signs and alternate prefixes", () => {
  const { format } = fixture();
  for (const [spec, expected] of [["+#b", "+0b11111111"], ["#o", "0o377"], ["#x", "0xff"], ["#X", "0XFF"], [" d", " 255"], ["#d", "255"]]) expect(format(255n, spec)).toBe(expected);
  expect(format(0n, "#x")).toBe("0x0");
  expect(format(-255n, "#010x")).toBe("-0x00000ff");
});
it("groups leading zeroes only for sign-aware zero padding", () => {
  const { format } = fixture();
  for (const [spec, expected] of [["08,d", "-001,234"], ["09,d", "-0,001,234"], ["010,d", "-0,001,234"], ["0>10,d", "0000-1,234"], ["0=10,d", "-0,001,234"], ["*^12_x", "****-4d2****"]]) expect(format(-1234n, spec)).toBe(expected);
  expect(format(0x12345n, "#_X")).toBe("0X1_2345");
});
it("supports code-point fill, odd centering and ignored fractional grouping", () => {
  const { format } = fixture();
  expect(format(12n, "😀^5d")).toBe("😀12😀😀");
  expect(format(-12n, "*=7d")).toBe("-****12");
  expect(format(1234n, "._d")).toBe("1234");
});
it("rejects precision before z and enforces decimal digit limits", () => {
  const { format, field, meter } = fixture();
  expect(() => format(1n, "z.0d")).toThrow("Precision not allowed in integer format specifier");
  expect(() => format(1n, "zd")).toThrow("Negative zero coercion (z) not allowed in integer format specifier");
  expect(() => renderIntegerRadixFormat(1000n, field("d"), meter, 3)).toThrow("Exceeds the limit (3 digits)");
});
it("preflights oversized padding and checks cancellation", () => {
  const { field } = fixture();
  const spec = field("0999999999999,d");
  expect(() => renderIntegerRadixFormat(1n, spec, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
  const controller = new AbortController(); controller.abort();
  expect(() => renderIntegerRadixFormat(0n, field("d"), new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
