import { describe, expect, it } from "vitest";
import { RangeIterator } from "./range-iterator.js";
import { createRange } from "./integer-sequence.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("range iteration", () => {
  it.each([false, true])("iterates exact values (reversed: %s)", reverse => {
    const iterator = new RangeIterator(createRange(-3n, 8n, 3n), reverse, budget());
    expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect([...iterator]).toEqual(reverse ? [6n, 3n, 0n, -3n] : [-3n, 0n, 3n, 6n]);
    expect(iterator.next()).toEqual({ done: true, value: undefined });
  });
  it.each([false, true])("handles descending ranges (reversed: %s)", reverse => {
    expect([...new RangeIterator(createRange(8n, -3n, -3n), reverse, budget())]).toEqual(reverse ? [-1n, 2n, 5n, 8n] : [8n, 5n, 2n, -1n]);
  });
  it.each([false, true])("keeps empty ranges exhausted (reversed: %s)", reverse => {
    const iterator = new RangeIterator(createRange(1n, 5n, -1n), reverse, budget());
    expect(iterator.lengthHint()).toBe(0n);
    expect(iterator.next().done).toBe(true); expect(iterator.next().done).toBe(true);
  });
  it("updates exact length hints only when an item is yielded", () => {
    const iterator = new RangeIterator(createRange(0n, 3n), false, budget());
    expect(iterator.lengthHint()).toBe(3n); expect(iterator.lengthHint()).toBe(3n);
    iterator.next(); expect(iterator.lengthHint()).toBe(2n);
    iterator.next(); iterator.next(); expect(iterator.lengthHint()).toBe(0n);
  });
  it.each([false, true])("handles huge ranges without materializing them (reversed: %s)", reverse => {
    const end = 1n << 200n, meter = budget();
    const iterator = new RangeIterator(createRange(-end, end, 2n), reverse, meter);
    expect(iterator.lengthHint()).toBe(end);
    expect(iterator.next().value).toBe(reverse ? end - 2n : -end);
    expect(iterator.next().value).toBe(reverse ? end - 4n : -end + 2n);
    expect(iterator.lengthHint()).toBe(end - 2n);
    expect(meter.usage.allocatedBytes).toBeLessThan(1000);
  });
  it("captures progression fields instead of observing later host mutation", () => {
    const progression = { start: 1n, stop: 4n, step: 1n, length: 3n };
    const iterator = new RangeIterator(progression, false, budget());
    progression.start = 99n; progression.step = 0n; progression.length = 100n;
    expect([...iterator]).toEqual([1n, 2n, 3n]);
  });
  it("checks execution limits before consuming a value", () => {
    let cancelled = false;
    const iterator = new RangeIterator(createRange(1n, 3n), false, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    cancelled = true; expect(() => iterator.next()).toThrow(ExecutionLimitError);
    cancelled = false; expect(iterator.next().value).toBe(1n);
  });
});
