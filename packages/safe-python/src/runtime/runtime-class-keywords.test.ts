import { describe, expect, it } from "vitest";
import { buildClass, type ClassBuilderContext } from "./class-builder.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000, signal }), v = new RuntimeValues(meter);
  const metaKey = v.string("metaclass"), meta = v.true, namespace = v.list([]), events: string[] = [];
  const seen: ReadonlyMap<RuntimeValue, RuntimeValue>[] = [];
  const context: ClassBuilderContext<RuntimeValue, RuntimeValue> = {
    isFunction: () => true, isString: value => value.kind === "str",
    bases: { tupleItems: value => value.kind === "tuple" ? value.items : undefined, isType: () => false, lookup: () => undefined, call: () => v.none, iterateTuple: value => { if (value.kind !== "tuple") throw new Error("tuple expected"); return value.items[Symbol.iterator](); }, tuple: items => v.tuple(items) },
    preparation: {
      defaultType: v.none, tupleItems: value => value.kind === "tuple" ? value.items : undefined,
      isType: (_value): _value is RuntimeValue => false, typeOf: () => v.none, mro: () => [], typeName: () => "marker",
      isMetaclassKeyword: key => runtimeComparison("==", key, metaKey, v, meter).value,
      lookupPrepare(value) { events.push("lookup"); expect(value).toBe(meta); return { value: meta }; },
      callPrepare(_hook, _name, _bases, keywords) { events.push("prepare"); seen.push(keywords); return namespace; },
      emptyNamespace: () => namespace, isMapping: () => true
    },
    executeBody() { events.push("body"); return undefined; }, storeOriginalBases() { throw new Error("unexpected changed bases"); },
    construction: {
      call(selected, _name, _bases, ns, keywords) { events.push("construct"); expect(selected).toBe(meta); expect(ns).toBe(namespace); seen.push(keywords); return ns; },
      isType: () => false, reprName: () => "'C'", repr: () => "marker"
    }
  };
  const run = (keywords: ReadonlyMap<RuntimeValue, RuntimeValue>) => buildClass([v.none, v.string("C")], keywords, context, meter);
  return { v, meter, meta, metaKey, context, events, seen, run, namespace };
}

describe("runtime class keyword ownership", () => {
  it("selects the runtime metaclass key and forwards other key identities in order", () => {
    const state = fixture(), { v } = state;
    const first = v.string("flag"), pair = v.stringPoints(new Uint32Array([0xd800, 0xdc00])), astral = v.string("𐀀"), kelvin = v.string("K"), latin = v.string("K");
    const keywords = new Map<RuntimeValue, RuntimeValue>([[first, v.none], [state.metaKey, state.meta], [pair, v.integer(1)], [astral, v.integer(2)], [kelvin, v.integer(3)], [latin, v.integer(4)]]);
    expect(state.run(keywords)).toBe(state.namespace);
    expect(state.events).toEqual(["lookup", "prepare", "body", "construct"]);
    expect(state.seen[0]).toBe(state.seen[1]); expect(state.seen[0]).not.toBe(keywords);
    const keys = [...state.seen[0].keys()]; expect(keys).toEqual([first, pair, astral, kelvin, latin]);
    keys.forEach((key, index) => expect(key).toBe([first, pair, astral, kelvin, latin][index]));
    expect(keywords.size).toBe(6); expect(keywords.get(state.metaKey)).toBe(state.meta);
  });
  it("does not silently ignore non-string keyword records when their policy is absent", () => {
    const state = fixture(); delete state.context.preparation.isMetaclassKeyword;
    expect(() => state.run(new Map([[state.metaKey, state.meta]]))).toThrow("class keyword key policy is required"); expect(state.events).toEqual([]);
  });
  it("observes cancellation from keyword classification before invoking metaclass hooks", () => {
    const controller = new AbortController(), state = fixture(controller.signal);
    state.context.preparation.isMetaclassKeyword = () => { controller.abort(); return true; };
    expect(() => state.run(new Map([[state.metaKey, state.meta]]))).toThrow(ExecutionLimitError); expect(state.events).toEqual([]);
  });
  it("propagates keyword policy failures without beginning preparation", () => {
    const state = fixture(), fault = new Error("key failure"); state.context.preparation.isMetaclassKeyword = () => { throw fault; };
    expect(() => state.run(new Map([[state.metaKey, state.meta]]))).toThrow(fault); expect(state.events).toEqual([]);
  });
});
