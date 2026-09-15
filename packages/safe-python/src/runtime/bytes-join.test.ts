import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const storage = (input: number[]) => ImmutableBytes.copyOf(Uint8Array.from(input), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }));

it("joins into one exact-size owned buffer", () => {
  const separator = storage([0, 255]), left = storage([1, 128]), right = storage([2]), meter = new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 7 });
  const result = separator.join([left, storage([]), right], meter);
  expect([...result]).toEqual([1, 128, 0, 255, 0, 255, 2]);
  expect(meter.usage.allocatedBytes).toBe(7);
  result.toUint8Array(new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 7 })).fill(0);
  expect([...result]).toEqual([1, 128, 0, 255, 0, 255, 2]);
});

it("handles empty and singleton sequences without copying a payload", () => {
  const sep = storage([1]), part = storage([2]), meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 0 });
  expect(sep.join([part], meter)).toBe(part); expect(sep.join([], meter).length).toBe(0);
});

it("rejects output allocation before copying any bytes", () => {
  const sep = storage([1]), part = storage([2, 3]), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 4 });
  expect(() => sep.join([part, part], meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
});

it("checks work budgets inside large part copies", () => {
  const sep = storage([]), part = storage(Array<number>(1000).fill(1));
  expect(() => sep.join([part, part], new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 2000 }))).toThrow(ExecutionLimitError);
});
