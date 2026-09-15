import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
const bytes = (input: number[]) => ImmutableBytes.copyOf(input, budget());

it("truncates byte fields before left or right space padding", () => {
  const source = bytes([0, 128, 255, 97]);
  expect([...source.formatField(4n, 2n, false, budget())]).toEqual([32, 32, 0, 128]);
  expect([...source.formatField(4n, 2n, true, budget())]).toEqual([0, 128, 32, 32]);
  expect([...source.formatField(0n, 0n, false, budget())]).toEqual([]);
});
it("retains unchanged storage and accepts huge precision without narrowing", () => {
  const source = bytes([255]);
  expect(source.formatField(0n, null, false, budget())).toBe(source);
  expect(source.formatField(1n, 10n ** 100n, true, budget())).toBe(source);
  expect([...bytes([]).formatField(2n, null, false, budget())]).toEqual([32, 32]);
});
it("charges one exact owned allocation for combined truncation and padding", () => {
  const source = bytes([0, 128, 255]), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 5 });
  const result = source.formatField(5n, 2n, true, meter);
  expect([...result]).toEqual([0, 128, 32, 32, 32]);
  expect(meter.usage.allocatedBytes).toBe(5);
  expect(Object.isFrozen(result)).toBe(true);
  expect([...source]).toEqual([0, 128, 255]);
});
it("requires normalized dimensions and rejects large output before allocation", () => {
  const source = bytes([0]);
  expect(() => source.formatField(-1n, null, false, budget())).toThrow(RangeError);
  expect(() => source.formatField(0n, -1n, false, budget())).toThrow(RangeError);
  for (const width of [10001n, 10n ** 100n]) {
    const meter = budget();
    expect(() => source.formatField(width, null, false, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  }
});
it("meters output copying and checks cancellation for unchanged storage", () => {
  const source = bytes([0]), controller = new AbortController(); controller.abort();
  expect(() => source.formatField(0n, null, false, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => source.formatField(20n, null, false, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});
