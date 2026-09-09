import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const text = (value: string) => new CodePointString(Uint32Array.from([...value], c => c.codePointAt(0)!));
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });

it("fuses custom fill and format centering into one allocation", () => {
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 20 });
  expect([...text("abcdef").formatField(5n, 2n, "center", 46, meter)]).toEqual([...text(".ab..")]);
  expect(meter.usage.allocatedBytes).toBe(20);
});

it("truncates text before applying minimum field width", () => {
  expect([...text("abcdef").formatField(5n, 3n, "right", 32, budget())]).toEqual([...text("  abc")]);
  expect([...text("abcdef").formatField(5n, 3n, "left", 32, budget())]).toEqual([...text("abc  ")]);
});
it("uses code points for both precision and padding", () => {
  expect([...text("😀éz").formatField(4n, 2n, "right", 32, budget())]).toEqual([32, 32, 0x1f600, 233]);
  const source = new CodePointString(Uint32Array.of(0xd800, 0xdc00, 0x10000));
  expect([...source.formatField(3n, 1n, "left", 32, budget())]).toEqual([0xd800, 32, 32]);
});
it("supports empty precision, absent precision and unbounded internal dimensions", () => {
  expect([...text("abc").formatField(2n, 0n, "right", 32, budget())]).toEqual([32, 32]);
  expect([...text("").formatField(2n, null, "left", 32, budget())]).toEqual([32, 32]);
  const source = text("abc");
  expect(source.formatField(0n, null, "right", 32, budget())).toBe(source);
  expect(source.formatField(3n, 10n ** 100n, "left", 32, budget())).toBe(source);
});
it("allocates just one owned buffer when truncating and padding", () => {
  const source = text("abcdef"), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 20 });
  const result = source.formatField(5n, 2n, "right", 32, meter);
  expect([...result]).toEqual([...text("   ab")]);
  expect(meter.usage.allocatedBytes).toBe(20);
  expect(Object.isFrozen(result)).toBe(true);
  expect([...source]).toEqual([...text("abcdef")]);
});
it("rejects negative dimensions at the normalized field boundary", () => {
  for (const [width, precision] of [[-1n, null], [0n, -1n]] as const) {
    expect(() => text("x").formatField(width, precision, "right", 32, budget())).toThrow(RangeError);
  }
});
it("preflights large output allocation without converting huge widths", () => {
  const source = text("x");
  for (const width of [10000n, 1n << 64n, 10n ** 100n]) {
    const meter = budget();
    expect(() => source.formatField(width, null, "right", 32, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  }
});
it("checks cancellation even for unchanged output and meters output filling", () => {
  const source = text("x"), controller = new AbortController(); controller.abort();
  expect(() => source.formatField(0n, null, "right", 32, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => source.formatField(20n, null, "right", 32, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});
