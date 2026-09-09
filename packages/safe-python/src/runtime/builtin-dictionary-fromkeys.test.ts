import { describe, expect, it } from "vitest";
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), builtin = createDictionaryFromKeysBuiltin(v, keys, meter);
  return { meter, v, keys, dictionary, builtin };
}

describe("dictionary fromkeys construction", () => {
  it("shares one default value and preserves first equal keys and their order", () => {
    const { meter, v, dictionary, builtin } = fixture(), first = v.integer(1), later = v.string("x"), payload = v.list([]);
    const result = builtin.value.invoke([v.list([first, later, v.true]), payload], dictionary(), meter);
    if (result.kind !== "dict") throw new Error("expected dict");
    expect(result.items.snapshot()).toEqual([[first, payload], [later, payload]]); expect(result.items.snapshot()[0][0]).toBe(first);
    expect(result.items.lookup(later)?.value).toBe(payload); payload.items.append(v.none);
    expect(result.items.lookup(first)?.value).toBe(payload);
    const empty = builtin.value.invoke([v.tuple([])], dictionary(), meter);
    expect(empty.kind).toBe("dict"); expect(empty).not.toBe(builtin.value.invoke([v.tuple([])], dictionary(), meter));
  });
  it("defaults to None and iterates strings by Python code points", () => {
    const { meter, v, dictionary, builtin } = fixture(), text = v.stringPoints(new Uint32Array([0xd800, 0xdc00, 0x10000, 0xd800]));
    const result = builtin.value.invoke([text], dictionary(), meter);
    if (result.kind !== "dict") throw new Error("expected dict");
    expect(result.items.size).toBe(3);
    for (const [key, value] of result.items.snapshot()) { expect(key.kind).toBe("str"); expect(value).toBe(v.none); }
  });
  it("reuses exact dictionary hashes but iterates mapping proxies normally", () => {
    const { meter, v } = fixture(); let hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => a === b }, source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    source.items.set(v.true, v.integer(9)); source.items.set(v.false, v.integer(8));
    const kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), builtin = createDictionaryFromKeysBuiltin(v, keys, meter); hashes = 0;
    const result = builtin.value.invoke([source, v.none], kwargs, meter);
    expect(hashes).toBe(0); if (result.kind !== "dict") throw new Error("expected dict");
    expect(result.items.snapshot()).toEqual([[v.true, v.none], [v.false, v.none]]);
    expect(source.items.snapshot()).toEqual([[v.true, v.integer(9)], [v.false, v.integer(8)]]);
    builtin.value.invoke([v.mappingProxy(source)], kwargs, meter); expect(hashes).toBe(2);
  });
  it("stops at the first invalid key without consuming the iterator remainder", () => {
    const { meter, v, dictionary, builtin } = fixture(), iterator = v.iterator(runtimeIterate(v.list([v.true, v.list([]), v.false]), v, meter));
    expect(() => builtin.value.invoke([iterator], dictionary(), meter)).toThrow("cannot use 'list' as a dict key");
    expect(iterator.value.next().value).toBe(v.false);
  });
  it("validates arguments before construction or iteration", () => {
    const { meter, v, keys, dictionary } = fixture(), unused = (): never => { throw new Error("must not construct"); }, builtin = createDictionaryFromKeysBuiltin(v, keys, meter, { create: unused, set: unused }), kwargs = dictionary();
    kwargs.items.set(v.string("iterable"), v.none);
    expect(() => builtin.value.invoke([], kwargs, meter)).toThrow("dict.fromkeys() takes no keyword arguments");
    expect(() => builtin.value.invoke([], dictionary(), meter)).toThrow("fromkeys expected at least 1 argument, got 0");
    expect(() => builtin.value.invoke([v.none, v.none, v.none], dictionary(), meter)).toThrow("fromkeys expected at most 2 arguments, got 3");
  });
  it("supports explicit class construction/setitem policies with every duplicate key", () => {
    const { meter, v, keys, dictionary } = fixture(), result = v.cell({}), seen: RuntimeValue[] = [], events: string[] = [];
    const context = { create() { expect(this).toBe(context); events.push("create"); return result; }, set(target: RuntimeValue, key: RuntimeValue, value: RuntimeValue) { expect(this).toBe(context); expect(target).toBe(result); expect(value).toBe(v.none); seen.push(key); } };
    const builtin = createDictionaryFromKeysBuiltin(v, keys, meter, context);
    expect(builtin.value.invoke([v.list([v.true, v.true, v.false])], dictionary(), meter)).toBe(result);
    expect(events).toEqual(["create"]); expect(seen).toEqual([v.true, v.true, v.false]);
    expect(() => builtin.value.invoke([v.integer(1)], dictionary(), meter)).toThrow("'int' object is not iterable"); expect(events).toEqual(["create", "create"]);
  });
  it("uses native storage when a class constructor returns the source dictionary itself", () => {
    const { meter, v, keys, dictionary } = fixture(), source = dictionary(); source.items.set(v.true, v.integer(1)); source.items.set(v.false, v.integer(2));
    const builtin = createDictionaryFromKeysBuiltin(v, keys, meter, { create: () => source, set() { throw new Error("exact dict must bypass subclass setitem"); } });
    expect(builtin.value.invoke([source], dictionary(), meter)).toBe(source);
    expect(source.items.snapshot()).toEqual([[v.true, v.none], [v.false, v.none]]);
  });
  it("checks cancellation after construction, next and set callbacks", () => {
    for (const phase of ["create", "next", "set"] as const) {
      const controller = new AbortController(), { meter, v, keys, dictionary } = fixture(controller.signal), result = v.cell({});
      const builtin = createDictionaryFromKeysBuiltin(v, keys, meter, {
        create() { if (phase === "create") controller.abort(); return result; },
        set() { if (phase === "set") controller.abort(); }
      });
      const iterator = v.iterator({ next() { if (phase === "next") controller.abort(); return { done: false as const, value: v.true }; } });
      expect(() => builtin.value.invoke([iterator], dictionary(), meter)).toThrow(ExecutionLimitError);
    }
  });
});
