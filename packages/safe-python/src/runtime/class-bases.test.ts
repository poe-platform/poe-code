import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { resolveClassBases, type ClassBasesContext } from "./class-bases.js";

type Value = { name?: string; type?: boolean; items?: Value[]; hook?: Value; result?: Value; iteration?: Value[] };
function fixture(items: Value[]) {
  const original: Value = { items }, events: string[] = [];
  const context: ClassBasesContext<Value> = {
    tupleItems: value => value.items,
    isType: value => value.type === true,
    lookup: value => { events.push(`lookup:${value.name}`); return value.hook === undefined ? undefined : { value: value.hook }; },
    call: (hook, bases) => { expect(bases).toBe(original); events.push(`call:${hook.name}`); return hook.result!; },
    iterateTuple: value => { events.push("iterate"); return (value.iteration ?? value.items!)[Symbol.iterator](); },
    tuple: values => { events.push("tuple"); return { items: [...values] }; }
  };
  const run = (maxSteps = 10000) => resolveClassBases(original, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 }));
  return { original, context, events, run };
}

describe("class base resolution", () => {
  it("returns the original tuple when no base is replaced and never looks up types", () => {
    const state = fixture([{ name: "A", type: true, hook: {} }, { name: "plain" }]);
    expect(state.run()).toEqual({ bases: state.original, changed: false });
    expect(state.run().bases).toBe(state.original);
    expect(state.events).toEqual(["lookup:plain", "lookup:plain"]);
  });

  it("replaces proxies left to right using the same original tuple", () => {
    const a = { name: "A", type: true }, b = { name: "B", type: true }, c = { name: "C", type: true };
    const state = fixture([a, { name: "p", hook: { name: "p", result: { items: [b, c] } } }, { name: "plain" }, { name: "q", hook: { name: "q", result: { items: [] } } }]);
    const result = state.run();
    expect(result.changed).toBe(true);
    expect(result.bases.items).toEqual([a, b, c, state.original.items![2]]);
    expect(state.events).toEqual(["lookup:p", "call:p", "iterate", "lookup:plain", "lookup:q", "call:q", "iterate", "tuple"]);
  });

  it("does not recursively resolve replacement entries or require them to be types", () => {
    const replacement = { name: "nested", hook: { name: "never" } };
    const state = fixture([{ name: "p", hook: { name: "p", result: { items: [replacement] } } }]);
    expect(state.run().bases.items).toEqual([replacement]);
    expect(state.events).not.toContain("lookup:nested");
  });

  it("marks replacement even when a proxy returns itself", () => {
    const proxy: Value = { name: "p" };
    proxy.hook = { name: "p", result: { items: [proxy] } };
    const state = fixture([proxy]);
    const result = state.run();
    expect(result.changed).toBe(true);
    expect(result.bases).not.toBe(state.original);
    expect(result.bases.items).toEqual([proxy]);
  });

  it("uses observable iteration for returned tuple subclasses", () => {
    const a = { name: "A", type: true }, b = { name: "B", type: true };
    const state = fixture([{ name: "p", hook: { name: "p", result: { items: [a], iteration: [b] } } }]);
    expect(state.run().bases.items).toEqual([b]);
  });

  it("rejects non-tuple hook results before attempting expansion", () => {
    const state = fixture([{ name: "p", hook: { name: "p", result: {} } }]);
    expect(() => state.run()).toThrow("__mro_entries__ must return a tuple");
    expect(state.events).toEqual(["lookup:p", "call:p"]);
  });

  it.each(["lookup", "call", "iterateTuple", "tuple"] as const)("propagates %s failure", stage => {
    const state = fixture([{ name: "p", hook: { name: "p", result: { items: [] } } }]);
    const error = new Error(stage);
    state.context[stage] = () => { throw error; };
    expect(() => state.run()).toThrow(error);
  });

  it("propagates iteration failures without creating the final tuple", () => {
    const state = fixture([{ name: "p", hook: { name: "p", result: { items: [] } } }]);
    const error = new Error("next");
    state.context.iterateTuple = () => ({ next: () => { throw error; } });
    expect(() => state.run()).toThrow(error);
    expect(state.events).not.toContain("tuple");
  });

  it("bounds a tuple subclass that supplies an infinite iterator", () => {
    const state = fixture([{ name: "p", hook: { name: "p", result: { items: [] } } }]);
    let nexts = 0;
    state.context.iterateTuple = () => ({ next: () => { nexts++; return { done: false, value: {} }; } });
    expect(() => state.run(20)).toThrow(ExecutionLimitError);
    expect(nexts).toBeLessThan(20);
    expect(state.events).not.toContain("tuple");
  });

  it("preserves an empty original tuple", () => {
    const state = fixture([]);
    expect(state.run()).toEqual({ bases: state.original, changed: false });
    expect(state.events).toEqual([]);
  });
});
