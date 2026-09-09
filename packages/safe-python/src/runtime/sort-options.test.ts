import { describe, expect, it } from "vitest";
import { bindSortOptions, type SortOptionContext } from "./sort-options.js";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: SortOptionContext<unknown> = {
  isNone: value => value === null,
  truth: value => Boolean(value),
  callKey: (key, value) => (key as (v: unknown) => unknown)(value),
  less: (a, b) => Number(a) < Number(b)
};

describe("list sort option binding", () => {
  it("defaults to identity keys and ascending order", () => {
    const options = bindSortOptions([], new Map(), context, budget()), value = {};
    expect(options.key(value)).toBe(value); expect(options.reverse).toBe(false);
    expect(options.less(1, 2)).toBe(true);
  });
  it("treats explicit None key as identity and converts reverse once", () => {
    let calls = 0;
    const options = bindSortOptions([], new Map<string, unknown>([["key", null], ["reverse", {}]]), {
      ...context, truth: () => { calls++; return true; }
    }, budget());
    expect(calls).toBe(1); expect(options.key(7)).toBe(7); expect(options.reverse).toBe(true);
  });
  it("defers key invocation until the sort visits each item", () => {
    const events: unknown[] = [], key = (value: unknown) => { events.push(value); return -Number(value); };
    const options = bindSortOptions([], new Map([["key", key]]), context, budget()); expect(events).toEqual([]);
    const list = new ListStorage<unknown>([1, 3, 2], budget()); list.sort(options);
    expect(events).toEqual([1, 3, 2]); expect(list.snapshot()).toEqual([3, 2, 1]);
  });
  it("does not validate key callability for an empty sort", () => {
    const failure = new PythonRuntimeError("TypeError", "key not callable");
    const options = bindSortOptions([], new Map([["key", 0]]), { ...context, callKey: () => { throw failure; } }, budget());
    new ListStorage<unknown>([], budget()).sort(options);
    expect(() => new ListStorage<unknown>([1], budget()).sort(options)).toThrow(failure);
  });
  it.each([
    [1, ["key", "reverse", "x"], "sort() takes at most 2 arguments (4 given)"],
    [3, [], "sort() takes at most 2 arguments (3 given)"],
    [0, ["key", "reverse", "x"], "sort() takes at most 2 keyword arguments (3 given)"],
    [1, [], "sort() takes no positional arguments"],
    [2, [], "sort() takes no positional arguments"]
  ] as const)("checks arity %s before keyword conversion", (count, names, message) => {
    expect(() => bindSortOptions(Array(count).fill(null), new Map(names.map(name => [name, null])), context, budget()))
      .toThrow(expect.objectContaining({ name: "TypeError", message }));
  });
  it("rejects unknown keywords before reverse truth conversion", () => {
    let called = false;
    expect(() => bindSortOptions([], new Map([["reverse", true], ["x", true]]), {
      ...context, truth: () => { called = true; return true; }
    }, budget())).toThrow(expect.objectContaining({ message: "sort() got an unexpected keyword argument 'x'" }));
    expect(called).toBe(false);
  });
  it("suggests a close keyword spelling", () => {
    expect(() => bindSortOptions([], new Map([["revers", true]]), context, budget())).toThrow(expect.objectContaining({
      message: "sort() got an unexpected keyword argument 'revers'. Did you mean 'reverse'?"
    }));
  });
  it("propagates reverse conversion failure before any key call", () => {
    const failure = new Error("truth failed");
    expect(() => bindSortOptions([], new Map([["reverse", true]]), { ...context, truth: () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("checks the budget after reverse truth conversion", () => {
    let reject = false;
    expect(() => bindSortOptions([], new Map([["reverse", true]]), { ...context, truth: () => { reject = true; return true; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
