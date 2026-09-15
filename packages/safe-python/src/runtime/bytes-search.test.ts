import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const storage = (input: number[]) => ImmutableBytes.copyOf(Uint8Array.from(input), new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }));

it("uses a bounded linear substring scan without copying either operand", () => {
  const source = storage([...Array<number>(2000).fill(97), 98]), needle = storage([...Array<number>(100).fill(97), 98]);
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 404 });
  expect(source.search(needle, "find", 0n, null, meter)).toBe(1900);
  expect(meter.usage.allocatedBytes).toBe(404);
});

it("searches integer bytes with no temporary storage", () => {
  const source = storage([255, 0, 255]), meter = new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 0 });
  expect(source.search(255, "find", 0n, null, meter)).toBe(0);
  expect(source.search(255, "rfind", 0n, null, meter)).toBe(2);
  expect(source.search(255, "count", 0n, null, meter)).toBe(2);
});

it("does not allocate a pattern table for impossible windows or empty patterns", () => {
  const source = storage([1]), needle = storage([1, 2]), empty = storage([]), meter = new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 0 });
  expect(source.search(needle, "find", 0n, null, meter)).toBe(-1);
  expect(source.search(empty, "count", 0n, null, meter)).toBe(2);
  expect(source.search(empty, "find", 2n, null, meter)).toBe(-1);
});

it("validates integer bytes and meters integer scanning", () => {
  const source = storage(Array<number>(100).fill(1));
  for (const needle of [-1, 256, 1.5, NaN]) expect(() => source.search(needle, "find", 0n, null, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 0 }))).toThrow(RangeError);
  expect(() => source.search(2, "find", 0n, null, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
});
