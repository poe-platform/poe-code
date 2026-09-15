import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { prepareClass, type ClassPreparationContext } from "./class-preparation.js";

interface Value { name: string; type?: boolean; mro?: Value[]; meta?: Value; items?: Value[]; mapping?: boolean; hook?: Value; result?: Value }
function fixture() {
  const type: Value = { name: "type", type: true }; type.mro = [type]; type.meta = type;
  const a: Value = { name: "A", type: true, meta: type }; a.mro = [a, type];
  const b: Value = { name: "B", type: true, meta: type }; b.mro = [b, a, type];
  const namespace: Value = { name: "namespace", mapping: true };
  const events: string[] = [], calls: unknown[] = [];
  const context: ClassPreparationContext<Value> = {
    defaultType: type,
    tupleItems: value => value.items,
    isType: (value): value is Value => value.type === true,
    typeOf: value => value.meta ?? type,
    mro: value => value.mro!,
    typeName: value => value.name,
    lookupPrepare: value => { events.push(`lookup:${value.name}`); return value.hook ? { value: value.hook } : undefined; },
    callPrepare: (hook, name, bases, keywords) => { events.push("prepare"); calls.push([name, bases, keywords]); return hook.result!; },
    emptyNamespace: () => { events.push("empty"); return namespace; },
    isMapping: value => value.mapping === true
  };
  const run = (items: Value[] = [], keywords = new Map<string, Value>(), maxSteps = 10000) => {
    const bases: Value = { name: "bases", items };
    return { bases, result: prepareClass("C", bases, keywords, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 })) };
  };
  return { type, a, b, namespace, context, events, calls, run };
}

describe("class metaclass and namespace preparation", () => {
  it("defaults to type and a fresh builtin mapping when no prepare hook exists", () => {
    const state = fixture();
    const { result } = state.run();
    expect(result.metaclass).toBe(state.type);
    expect(result.namespace).toBe(state.namespace);
    expect([...result.keywords]).toEqual([]);
    expect(state.events).toEqual(["lookup:type", "empty"]);
  });

  it("selects the most-derived compatible metaclass from resolved bases", () => {
    const state = fixture();
    const { result } = state.run([{ name: "X", meta: state.a }, { name: "Y", meta: state.b }]);
    expect(result.metaclass).toBe(state.b);
    expect(state.events).toEqual(["lookup:B", "empty"]);
  });

  it("removes only the metaclass keyword and preserves order without mutating the input", () => {
    const state = fixture();
    state.b.hook = { name: "prepare", result: state.namespace };
    const one = { name: "one" }, two = { name: "two" };
    const keywords = new Map([["first", one], ["metaclass", state.b], ["last", two]]);
    const { bases, result } = state.run([], keywords);
    expect([...result.keywords]).toEqual([["first", one], ["last", two]]);
    expect(result.keywords).not.toBe(keywords);
    expect([...keywords.keys()]).toEqual(["first", "metaclass", "last"]);
    expect(state.calls).toEqual([["C", bases, result.keywords]]);
    expect(result.namespace).toBe(state.namespace);
  });

  it("rejects metaclass conflicts before prepare lookup", () => {
    const state = fixture(), other: Value = { name: "Other", type: true, mro: [state.type], meta: state.type };
    expect(() => state.run([{ name: "X", meta: state.a }, { name: "Y", meta: other }])).toThrow("metaclass conflict");
    expect(state.events).toEqual([]);
  });

  it("lets an explicit non-type factory bypass type metaclass conflicts", () => {
    const state = fixture(), factory = { name: "factory", hook: { name: "prepare", result: state.namespace } };
    state.context.mro = () => { throw new Error("unexpected MRO access"); };
    const { result } = state.run([{ name: "X", meta: state.a }, { name: "Y", meta: state.b }], new Map([["metaclass", factory]]));
    expect(result.metaclass).toBe(factory);
    expect(state.events).toEqual(["lookup:factory", "prepare"]);
  });

  it("does not require a non-type metaclass to be callable until construction", () => {
    const state = fixture(), none = { name: "None" };
    expect(state.run([], new Map([["metaclass", none]])).result.metaclass).toBe(none);
    expect(state.events).toEqual(["lookup:None", "empty"]);
  });

  it("validates prepare results using the internal mapping protocol flag", () => {
    const state = fixture(), listLike = { name: "list-like", mapping: true };
    state.a.hook = { name: "prepare", result: listLike };
    expect(state.run([], new Map([["metaclass", state.a]])).result.namespace).toBe(listLike);
  });

  it.each([true, false])("formats an invalid prepare result for a type metaclass: %s", typeMeta => {
    const state = fixture(), integerType = { name: "int", type: true };
    const bad = { name: "1", meta: integerType }, meta: Value = typeMeta ? state.a : { name: "factory" };
    meta.hook = { name: "prepare", result: bad };
    expect(() => state.run([], new Map([["metaclass", meta]]))).toThrow(`${typeMeta ? "A" : "<metaclass>"}.__prepare__() must return a mapping, not int`);
  });

  it.each(["lookupPrepare", "callPrepare", "emptyNamespace"] as const)("propagates %s failure", stage => {
    const state = fixture(), error = new Error(stage);
    if (stage !== "emptyNamespace") state.type.hook = { name: "prepare", result: state.namespace };
    state.context[stage] = () => { throw error; };
    expect(() => state.run()).toThrow(error);
  });

  it("stops before prepare effects when the budget is exhausted", () => {
    const state = fixture();
    expect(() => state.run([], new Map(), 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });

  it.each([
    ["M".repeat(250), "M".repeat(200)],
    ["é".repeat(150), "é".repeat(100)],
    ["a" + "😀".repeat(80), "a" + "😀".repeat(49)]
  ])("limits diagnostic type names by complete UTF-8 characters: %s", (name, truncated) => {
    const state = fixture();
    state.a.name = name;
    state.a.hook = { name: "prepare", result: { name: "instance", meta: { name, type: true } } };
    expect(() => state.run([], new Map([["metaclass", state.a]]))).toThrow(expect.objectContaining({
      name: "TypeError", message: `${truncated}.__prepare__() must return a mapping, not ${truncated}`
    }));
  });
});
