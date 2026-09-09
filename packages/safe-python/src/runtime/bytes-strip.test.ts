import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const storage = (input: number[]) => ImmutableBytes.copyOf(Uint8Array.from(input), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }));

it("uses exactly six ASCII whitespace values", () => {
  const whitespace = [9, 10, 11, 12, 13, 32], source = storage([...whitespace, 28, 160, ...whitespace]);
  expect([...source.strip("strip", null, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 2 }))]).toEqual([28, 160]);
});

it("indexes a custom byte set once with bounded memory", () => {
  const source = storage([...Array<number>(1000).fill(255), 0, ...Array<number>(1000).fill(255)]), chars = storage(Array<number>(1000).fill(255));
  const meter = new ExecutionBudget({ maxSteps: 4000, maxAllocatedBytes: 257 });
  expect([...source.strip("strip", chars, meter)]).toEqual([0]);
  expect(meter.usage.allocatedBytes).toBe(257);
});

it("avoids copying or scanning unchanged interiors", () => {
  const source = storage([1, ...Array<number>(1000).fill(32), 1]), meter = new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 0 });
  expect(source.strip("strip", null, meter)).toBe(source);
  expect(source.strip("strip", storage([]), new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toBe(source);
});

it("checks work budgets while indexing chars and scanning edges", () => {
  const source = storage(Array<number>(1000).fill(32)), chars = storage(Array<number>(1000).fill(32));
  expect(() => source.strip("strip", null, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  expect(() => source.strip("strip", chars, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 256 }))).toThrow(ExecutionLimitError);
});
