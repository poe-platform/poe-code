import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { buildClass, type ClassBuilderContext } from "./class-builder.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Value { name?: string; items?: Value[]; entries?: Map<string, Value>; type?: boolean; fn?: boolean; text?: string }
function fixture(failure?: string) {
  const events: string[] = [], error = new Error("failure");
  const step = (name: string) => { events.push(name); if (failure === name) throw error; };
  const meta: Value = { type: true }, base: Value = { type: true }, proxy: Value = {};
  const body: Value = { fn: true }, name: Value = { text: "C" }, result: Value = {};
  const namespace: Value = { entries: new Map() }, originalTuples: Value[] = [];
  const keywords = new Map([["metaclass", meta], ["flag", proxy]]);
  const context: ClassBuilderContext<Value> = {
    isFunction: value => value.fn === true,
    isString: value => value.text !== undefined,
    bases: {
      tupleItems: value => value.items, isType: value => value.type === true,
      lookup: () => { step("lookup-base"); return { value: proxy }; },
      call: (hook, original) => { step("resolve"); expect(original.items).toEqual([proxy]); return { items: [base] }; },
      iterateTuple: value => value.items![Symbol.iterator](),
      tuple: items => { const tuple = { items: [...items] }; originalTuples.push(tuple); return tuple; }
    },
    preparation: {
      defaultType: meta, tupleItems: value => value.items,
      isType: (value): value is Value => value.type === true,
      typeOf: () => meta, mro: () => [meta], typeName: () => "type",
      lookupPrepare: () => { step("lookup-prepare"); return { value: meta }; },
      callPrepare: (hook, className, bases, remaining) => {
        step("prepare"); expect(className).toBe(name); expect(bases.items).toEqual([base]);
        expect([...remaining]).toEqual([["flag", proxy]]); return namespace;
      },
      emptyNamespace: () => namespace, isMapping: value => value.entries !== undefined
    },
    executeBody: (fn, ns) => {
      step("body"); expect(fn).toBe(body); expect(ns).toBe(namespace);
      namespace.entries!.set("__orig_bases__", body); return undefined;
    },
    storeOriginalBases: (ns, original) => { step("original"); expect(ns).toBe(namespace); ns.entries!.set("__orig_bases__", original); },
    construction: {
      call: (selected, className, bases, ns, remaining) => {
        step("construct"); expect(selected).toBe(meta); expect(className).toBe(name);
        expect(bases.items).toEqual([base]); expect(ns).toBe(namespace);
        expect([...remaining]).toEqual([["flag", proxy]]); return result;
      },
      isType: value => value.type === true, reprName: value => `'${value.text}'`, repr: () => "value"
    }
  };
  const run = (args = [body, name, proxy], maxSteps = 1000) => buildClass(args, keywords, context, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 }));
  return { context, events, error, meta, base, proxy, body, name, namespace, result, originalTuples, keywords, run };
}

describe("builtin class builder", () => {
  it("preserves the original guest string object through preparation and construction", () => {
    const state = fixture();
    state.context.preparation.callPrepare = (hook, name) => { expect(name).toBe(state.name); return state.namespace; };
    state.context.construction.call = (meta, name) => { expect(name).toBe(state.name); return state.result; };
    expect(state.run()).toBe(state.result);
  });

  it("resolves bases, prepares, executes, installs original bases and constructs", () => {
    const state = fixture();
    expect(state.run()).toBe(state.result);
    expect(state.events).toEqual(["lookup-base", "resolve", "lookup-prepare", "prepare", "body", "original", "construct"]);
    expect(state.namespace.entries!.get("__orig_bases__")).toBe(state.originalTuples[0]);
    expect([...state.keywords.keys()]).toEqual(["metaclass", "flag"]);
  });

  it("does not overwrite body-defined original bases when no resolution occurred", () => {
    const state = fixture();
    expect(state.run([state.body, state.name, state.base])).toBe(state.result);
    expect(state.namespace.entries!.get("__orig_bases__")).toBe(state.body);
    expect(state.events).toEqual(["lookup-prepare", "prepare", "body", "construct"]);
  });

  it.each(["lookup-base", "resolve", "lookup-prepare", "prepare", "body", "original", "construct"])("stops at %s failure without undoing effects", stage => {
    const state = fixture(stage);
    expect(() => state.run()).toThrow(state.error);
    expect(state.events.at(-1)).toBe(stage);
    if (stage === "original") expect(state.namespace.entries!.get("__orig_bases__")).toBe(state.body);
    if (stage === "construct") expect(state.namespace.entries!.get("__orig_bases__")).toBe(state.originalTuples[0]);
  });

  it.each([{ args: [] }, { args: [{}] }])("rejects insufficient arguments before inspecting their values: $args", ({ args }) => {
    const state = fixture();
    state.context.isFunction = () => { throw new Error("unexpected check"); };
    expect(() => state.run(args)).toThrow("__build_class__: not enough arguments");
    expect(state.events).toEqual([]);
  });

  it("requires an actual function before inspecting the name or bases", () => {
    const state = fixture();
    state.context.isString = () => { throw new Error("unexpected check"); };
    expect(() => state.run([{}, {}, state.proxy])).toThrow("__build_class__: func must be a function");
    expect(state.events).toEqual([]);
  });

  it("rejects a non-string name before resolving bases", () => {
    const state = fixture();
    expect(() => state.run([state.body, {}, state.proxy])).toThrow("__build_class__: name is not a string");
    expect(state.events).toEqual([]);
  });

  it("validates the exact body-returned class cell after construction", () => {
    const state = fixture();
    const cell = { owner: analyzeModule("class C: pass").scopes.children[0].scope };
    state.context.executeBody = () => cell;
    state.result.type = true;
    expect(() => state.run()).toThrow("__class__ not set defining 'C' as value");
    expect(state.events.at(-1)).toBe("construct");
  });

  it("checks the entry budget before touching any value", () => {
    const state = fixture();
    state.context.isFunction = () => { throw new Error("unexpected check"); };
    expect(() => state.run(undefined, 0)).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
});
