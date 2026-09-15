import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { IntegerPercentField } from "./integer-percent-field.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
function field(code = 100, options: Partial<Omit<IntegerPercentField, "flags">> = {}, flags: Partial<IntegerPercentField["flags"]> = {}): IntegerPercentField {
  return { code, width: 0n, precision: null, ...options, flags: { alternate: false, zero: false, left: false, space: false, sign: false, ...flags } };
}
const render = (value: bigint, format: IntegerPercentField) => String.fromCodePoint(...ImmutableBytes.fromIntegerPercentField(value, format, budget()));
it("renders decimal, octal and hexadecimal byte fields", () => {
  for (const code of [100, 105, 117]) expect(render(-255n, field(code))).toBe("-255");
  expect(render(-255n, field(111, {}, { alternate: true }))).toBe("-0o377");
  expect(render(255n, field(120, {}, { alternate: true }))).toBe("0xff");
  expect(render(-255n, field(88, {}, { alternate: true }))).toBe("-0XFF");
});
it("combines signs, prefixes, precision and width directly in byte storage", () => {
  expect(render(1n, field(120, { width: 10n, precision: 4n }, { sign: true, alternate: true, zero: true }))).toBe("+0x0000001");
  expect(render(1n, field(120, { width: 10n, precision: 4n }, { space: true, alternate: true, zero: true, left: true }))).toBe(" 0x0001   ");
  expect(render(0n, field(111, { precision: 0n }, { alternate: true }))).toBe("0o0");
});
it("allocates one byte per output position without a code-point buffer", () => {
  // Two one-digit host-string reservations (34 each), then eight output bytes.
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 76 });
  const result = ImmutableBytes.fromIntegerPercentField(1n, field(100, { width: 8n }, { sign: true, zero: true }), meter);
  expect([...result]).toEqual([43, 48, 48, 48, 48, 48, 48, 49]);
  expect(meter.usage.allocatedBytes).toBe(76);
  expect(Object.isFrozen(result)).toBe(true);
});
it("enforces decimal limits separately from formatter precision", () => {
  expect(() => render(10n ** 4300n, field())).toThrow("Exceeds the limit (4300 digits)");
  expect(ImmutableBytes.fromIntegerPercentField(10n ** 4300n, field(), budget(), 0).length).toBe(4301);
  expect(ImmutableBytes.fromIntegerPercentField(1n, field(100, { precision: 5000n }), budget()).length).toBe(5000);
});
it("rejects invalid dimensions and preflights oversized byte results", () => {
  expect(() => render(1n, field(100, { width: -1n }))).toThrow(RangeError);
  expect(() => render(1n, field(115))).toThrow(RangeError);
  expect(() => render(1n, field(100, { precision: 1n << 100n }))).toThrow(ExecutionLimitError);
  expect(() => ImmutableBytes.fromIntegerPercentField(1n, field(100, { width: 1000n }), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 500 }))).toThrow(ExecutionLimitError);
});
it("checks cancellation and meters byte filling", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => ImmutableBytes.fromIntegerPercentField(0n, field(), new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => ImmutableBytes.fromIntegerPercentField(1n, field(100, { width: 100n }), new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
