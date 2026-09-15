import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import type { IntegerPercentField } from "./integer-percent-field.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
function field(code = 100, options: Partial<Omit<IntegerPercentField, "flags">> = {}, flags: Partial<IntegerPercentField["flags"]> = {}): IntegerPercentField {
  return { code, width: 0n, precision: null, ...options, flags: { alternate: false, zero: false, left: false, space: false, sign: false, ...flags } };
}
const render = (value: bigint, format: IntegerPercentField) => String.fromCodePoint(...CodePointString.fromIntegerPercentField(value, format, budget()));
it("renders signed decimal variants and octal/hexadecimal digits", () => {
  for (const code of [100, 105, 117]) expect(render(-255n, field(code))).toBe("-255");
  expect(render(-255n, field(111))).toBe("-377");
  expect(render(255n, field(120))).toBe("ff");
  expect(render(-255n, field(88))).toBe("-FF");
});
it("applies sign before alternate prefixes and zero width padding", () => {
  expect(render(255n, field(120, { width: 10n }, { alternate: true, sign: true, zero: true }))).toBe("+0x00000ff");
  expect(render(-255n, field(88, { width: 10n }, { alternate: true, sign: true, zero: true }))).toBe("-0X00000FF");
  expect(render(1n, field(111, {}, { alternate: true, space: true }))).toBe(" 0o1");
  expect(render(1n, field(100, {}, { alternate: true, space: true, sign: true }))).toBe("+1");
});
it("keeps the zero digit even at precision zero", () => {
  expect(render(0n, field(100, { precision: 0n }))).toBe("0");
  expect(render(0n, field(111, { precision: 0n }, { alternate: true }))).toBe("0o0");
  expect(render(0n, field(88, { precision: 0n }, { alternate: true }))).toBe("0X0");
});
it("combines precision zeroes with width and left alignment", () => {
  expect(render(-1n, field(100, { width: 5n, precision: 3n }, { zero: true }))).toBe("-0001");
  expect(render(1n, field(120, { width: 8n, precision: 5n }, { alternate: true, zero: true, left: true }))).toBe("0x00001 ");
  expect(render(1n, field(100, { width: 6n, precision: 3n }))).toBe("   001");
  expect(render(1234n, field(100, { width: 1n, precision: 2n }))).toBe("1234");
});
it("preserves arbitrary-size integers and enforces decimal conversion limits", () => {
  expect(render(123456789012345678901234567890n, field())).toBe("123456789012345678901234567890");
  expect(() => render(10n ** 4300n, field())).toThrow("Exceeds the limit (4300 digits)");
  const output = CodePointString.fromIntegerPercentField(10n ** 4300n, field(), budget(), 0);
  expect(output.length).toBe(4301);
});
it("requires supported codes and normalized dimensions", () => {
  for (const format of [field(115), field(100, { width: -1n }), field(100, { precision: -1n })]) expect(() => render(1n, format)).toThrow(RangeError);
});
it("adopts one final buffer without copying or intermediate padded strings", () => {
  // Two one-digit host-string reservations (34 each), then eight code points.
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
  const result = CodePointString.fromIntegerPercentField(1n, field(100, { width: 8n }, { sign: true, zero: true }), meter);
  expect(String.fromCodePoint(...result)).toBe("+0000001");
  expect(meter.usage.allocatedBytes).toBe(100);
  expect(Object.isFrozen(result)).toBe(true);
});
it("rejects huge final output dimensions before host allocation", () => {
  for (const format of [field(100, { width: 1n << 100n }), field(120, { precision: 1n << 100n })]) expect(() => render(1n, format)).toThrow(ExecutionLimitError);
  expect(() => CodePointString.fromIntegerPercentField(1n, field(100, { width: 1000n }), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 500 }))).toThrow(ExecutionLimitError);
});
it("checks entry cancellation and meters filling the result", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => CodePointString.fromIntegerPercentField(0n, field(), new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => CodePointString.fromIntegerPercentField(1n, field(100, { width: 100n }), new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
