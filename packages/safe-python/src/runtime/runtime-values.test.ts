import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { createRange } from "./integer-sequence.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("execution runtime values", () => {
  it("shares immutable scalar/singleton allocation with compiled constants", () => {
    const values = new RuntimeValues(budget());
    expect(values.boolean(true)).toBe(values.true);
    expect(values.integer(3n)).toEqual({ kind: "int", value: 3n });
  });
  it("owns fresh list slots but preserves element identity", () => {
    const values = new RuntimeValues(budget()), item = values.integer(1n), input: RuntimeValue[] = [item];
    const first = values.list(input), second = values.list(input);
    input.push(values.integer(2n));
    expect(first.items.length).toBe(1); expect(first.items.get(0n)).toBe(item);
    first.items.append(values.integer(3n)); expect(second.items.length).toBe(1);
    expect(first).not.toBe(second); expect(Object.isFrozen(first)).toBe(true);
  });
  it("supports cycles and shared mutable members without recursively copying", () => {
    const values = new RuntimeValues(budget()), list = values.list([]);
    list.items.append(list);
    const tuple: RuntimeValue = values.tuple<RuntimeValue>([list]);
    expect(tuple.items[0]).toBe(list); expect(list.items.get(0n)).toBe(list);
    list.items.append(values.true); expect(list.items.length).toBe(2);
  });
  it("can adopt trusted owned list storage without copying its slots", () => {
    const values = new RuntimeValues(budget()), original = values.list([values.true]);
    const storage = original.items.slice(), adopted = values.list(storage);
    expect(adopted.items).toBe(storage); expect(adopted.items).not.toBe(original.items);
    adopted.items.clear(); expect(original.items.length).toBe(1);
  });
  it("allows slice components to retain arbitrary runtime values without conversion", () => {
    const values = new RuntimeValues(budget()), list = values.list([]);
    const slice: RuntimeValue = values.slice<RuntimeValue>({ lower: list });
    expect(slice.start).toBe(list); expect(slice.stop).toBe(values.none); expect(slice.step).toBe(values.none);
  });
  it("wraps validated ranges without expanding their elements", () => {
    const meter = budget(), values = new RuntimeValues(meter), progression = createRange(0n, 1n << 200n);
    const range = values.range(progression);
    expect(range.kind).toBe("range"); expect(range.value).toBe(progression);
    expect(Object.isFrozen(range)).toBe(true); expect(meter.usage.allocatedBytes).toBeLessThan(1000);
  });
  it("wraps prepared iterators without advancing them", () => {
    const values = new RuntimeValues(budget()); let calls = 0;
    const source = { next: () => { calls++; return { done: false, value: values.true }; } };
    const iterator = values.iterator(source);
    expect(iterator.kind).toBe("iterator"); expect(calls).toBe(0); expect(iterator.value).toBe(source);
    expect(iterator.value.next().value).toBe(values.true); expect(calls).toBe(1);
    expect(Object.isFrozen(iterator)).toBe(true);
  });
  it("charges wrappers before publishing them", () => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 160 }), values = new RuntimeValues(meter);
    expect(() => values.list([])).toThrow(ExecutionLimitError);
  });
});
