import { describe, expect, it } from "vitest";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const v = new RuntimeValues(meter), list = v.list([0, 1, 2, 3].map(n => v.integer(n)));
  return { meter, v, list };
}

describe("runtime item mutation", () => {
  it("sets and deletes list positions including negative and bool indices", () => {
    const { meter, v, list } = fixture();
    runtimeMutateItem(list, v.integer(-1n), { kind: "set", value: list }, v, meter);
    expect(list.items.get(3n)).toBe(list);
    runtimeMutateItem(list, v.true, { kind: "delete" }, v, meter);
    expect(list.items.length).toBe(3); expect(list.items.get(1n)).toEqual(v.integer(2n));
  });
  it("handles self replacement without corrupting shifted source slots", () => {
    const { meter, v, list } = fixture();
    runtimeMutateItem(list, v.slice({ lower: v.integer(1n), upper: v.integer(3n) }), { kind: "set", value: list }, v, meter);
    expect(list.items.snapshot()).toEqual([0, 0, 1, 2, 3, 3].map(n => v.integer(n)));
  });
  it("materializes non-list iterables before replacing any target slots", () => {
    const { meter, v, list } = fixture(); let pulls = 0;
    const source = v.iterator({ next: () => {
      expect(list.items.length).toBe(4); pulls++;
      return pulls <= 2 ? { done: false, value: v.true } : { done: true, value: undefined };
    } });
    runtimeMutateItem(list, v.slice({}), { kind: "set", value: source }, v, meter);
    expect(pulls).toBe(3); expect(list.items.snapshot()).toEqual([v.true, v.true]);
  });
  it("normalizes slices against list size after replacement iteration side effects", () => {
    const { meter, v, list } = fixture(); let pulls = 0;
    const source = v.iterator({ next: () => {
      if (pulls++ === 0) { list.items.clear(); list.items.append(v.integer(8n)); list.items.append(v.integer(9n)); }
      return pulls <= 2 ? { done: false, value: v.integer(pulls + 4) } : { done: true, value: undefined };
    } });
    runtimeMutateItem(list, v.slice({ lower: v.integer(-2n) }), { kind: "set", value: source }, v, meter);
    expect(list.items.snapshot()).toEqual([v.integer(5n), v.integer(6n)]);
  });
  it("preserves target slots after replacement iteration failure", () => {
    const { meter, v, list } = fixture(); let pulls = 0;
    const source = v.iterator({ next: () => {
      if (pulls++ === 0) return { done: false, value: v.true };
      throw new PythonRuntimeError("TypeError", "next failed");
    } });
    expect(() => runtimeMutateItem(list, v.slice({}), { kind: "set", value: source }, v, meter)).toThrow("next failed");
    expect(list.items.snapshot()).toEqual([0, 1, 2, 3].map(n => v.integer(n)));
  });
  it("checks extended slice size without partially assigning and supports strided deletion", () => {
    const { meter, v, list } = fixture(), key = v.slice({ step: v.integer(2n) });
    expect(() => runtimeMutateItem(list, key, { kind: "set", value: v.tuple([v.true]) }, v, meter)).toThrow("attempt to assign sequence of size 1 to extended slice of size 2");
    expect(list.items.length).toBe(4);
    runtimeMutateItem(list, key, { kind: "delete" }, v, meter);
    expect(list.items.snapshot()).toEqual([v.integer(1n), v.integer(3n)]);
  });
  it("validates keys before consuming replacements and uses slice-assignment diagnostics", () => {
    const { meter, v, list } = fixture();
    const source = v.iterator({ next: () => { throw new Error("consumed"); } });
    expect(() => runtimeMutateItem(list, v.slice({ step: v.integer(0n) }), { kind: "set", value: source }, v, meter)).toThrow("slice step cannot be zero");
    expect(() => runtimeMutateItem(list, v.slice({}), { kind: "set", value: v.none }, v, meter)).toThrow("must assign iterable to extended slice");
    expect(() => runtimeMutateItem(list, v.none, { kind: "delete" }, v, meter)).toThrow("list indices must be integers or slices, not NoneType");
  });
  it("rejects immutable receivers with operation-specific diagnostics", () => {
    const { meter, v } = fixture();
    expect(() => runtimeMutateItem(v.tuple([]), v.integer(0n), { kind: "set", value: v.none }, v, meter)).toThrow("'tuple' object does not support item assignment");
    expect(() => runtimeMutateItem(v.tuple([]), v.integer(0n), { kind: "delete" }, v, meter)).toThrow("'tuple' object doesn't support item deletion");
    expect(() => runtimeMutateItem(v.none, v.integer(0n), { kind: "delete" }, v, meter)).toThrow("'NoneType' object does not support item deletion");
  });
  it("stops infinite replacement iterators at the fatal budget without assignment", () => {
    const { v, list } = fixture(), meter = new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 });
    const source = v.iterator({ next: () => ({ done: false, value: v.none }) });
    expect(() => runtimeMutateItem(list, v.slice({}), { kind: "set", value: source }, v, meter)).toThrow(ExecutionLimitError);
    expect(list.items.length).toBe(4);
  });
});
