import { describe, expect, it } from "vitest";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { beginRuntimeCall } from "./runtime-call.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), source = dictionary(), key = v.string("x");
  const call = (name: Parameters<typeof createRuntimeDictionaryMutationMethod>[1], args: RuntimeValue[] = [], kwargs = dictionary()) => createRuntimeDictionaryMutationMethod(source, name, v, meter).value.invoke(args, kwargs, meter);
  return { meter, v, keys, dictionary, source, key, call };
}

describe("bound dictionary mutation methods", () => {
  it("returns existing setdefault values without replacing their key or position", () => {
    const { v, source, key, call } = fixture(), payload = v.list([]); source.items.set(key, payload);
    expect(call("setdefault", [v.string("x"), v.false])).toBe(payload);
    expect(source.items.snapshot()).toEqual([[key, payload]]);
    const other = v.string("y"); expect(call("setdefault", [other])).toBe(v.none);
    expect(source.items.snapshot()).toEqual([[key, payload], [other, v.none]]);
  });
  it("pops stored None, handles defaults and retains original KeyError arguments", () => {
    const { v, source, key, call } = fixture(); source.items.set(key, v.none);
    expect(call("pop", [key, v.true])).toBe(v.none); expect(source.items.size).toBe(0);
    expect(call("pop", [key, v.false])).toBe(v.false);
    const unhashable = v.list([]);
    expect(call("pop", [unhashable, v.true])).toBe(v.true);
    try { call("pop", [unhashable]); throw new Error("expected KeyError"); }
    catch (error) { expect(error).toBeInstanceOf(PythonKeyError); expect((error as PythonKeyError).args[0]).toBe(unhashable); }
    source.items.set(key, v.true);
    expect(() => call("pop", [unhashable])).toThrow("cannot use 'list' as a dict key");
    expect(() => call("setdefault", [unhashable])).toThrow("cannot use 'list' as a dict key");
  });
  it("pops the latest item without hashing and clears storage visible to live views", () => {
    const { v, source, key, call } = fixture(), y = v.string("y"); source.items.set(key, v.true); source.items.set(y, v.false); source.items.set(key, v.none);
    expect(call("popitem")).toEqual(v.tuple([y, v.false])); expect(call("popitem")).toEqual(v.tuple([key, v.none]));
    try { call("popitem"); throw new Error("expected KeyError"); }
    catch (error) { expect(error).toBeInstanceOf(PythonKeyError); expect((error as PythonKeyError).args).toEqual([v.string("popitem(): dictionary is empty")]); }
    source.items.set(key, v.true); const cursor = source.items.iterate(k => k);
    expect(call("clear")).toBe(v.none); expect(source.items.size).toBe(0);
    expect(() => cursor.next()).toThrow("dictionary changed size during iteration"); expect(call("clear")).toBe(v.none);
  });
  it("performs one hash for setdefault and nonempty pop", () => {
    const { meter, v, dictionary } = fixture(); let hashes = 0;
    const d = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => { hashes++; return 1n; }, equal: (a, b) => a === b }, meter));
    const set = createRuntimeDictionaryMutationMethod(d, "setdefault", v, meter), pop = createRuntimeDictionaryMutationMethod(d, "pop", v, meter);
    expect(set.value.invoke([v.true, v.none], dictionary(), meter)).toBe(v.none); expect(hashes).toBe(1);
    expect(set.value.invoke([v.true, v.false], dictionary(), meter)).toBe(v.none); expect(hashes).toBe(2);
    expect(pop.value.invoke([v.true], dictionary(), meter)).toBe(v.none); expect(hashes).toBe(3);
    expect(pop.value.invoke([v.true, v.false], dictionary(), meter)).toBe(v.false); expect(hashes).toBe(3);
  });
  it("updates positional pairs before keywords and preserves partial writes on failure", () => {
    const { v, source, key, call, dictionary } = fixture(), kwargs = dictionary(); kwargs.items.set(key, v.false);
    expect(call("update", [v.list([v.tuple([key, v.true])])], kwargs)).toBe(v.none); expect(source.items.lookup(key)?.value).toBe(v.false);
    const later = v.string("later"); kwargs.items.set(later, v.none);
    expect(() => call("update", [v.list([v.tuple([key, v.true]), v.tuple([v.none])])], kwargs)).toThrow("dictionary update sequence element #1 has length 1; 2 is required");
    expect(source.items.lookup(key)?.value).toBe(v.true); expect(source.items.lookup(later)).toBeUndefined();
    const mapping = dictionary(); mapping.items.set(later, v.false);
    expect(call("update", [v.mappingProxy(mapping)])).toBe(v.none); expect(source.items.lookup(later)?.value).toBe(v.false);
  });
  it("preserves exact keyword records and validates them after positional updates", () => {
    const { v, source, call, dictionary } = fixture(), kwargs = dictionary();
    const pair = v.stringPoints(new Uint32Array([0xd800, 0xdc00])), astral = v.stringPoints(new Uint32Array([0x10000]));
    kwargs.items.set(pair, v.true); kwargs.items.set(astral, v.false); call("update", [], kwargs);
    expect(source.items.snapshot()).toEqual([[pair, v.true], [astral, v.false]]);
    kwargs.items.set(v.integer(1), v.none);
    expect(() => call("update", [v.list([v.tuple([v.none, v.none])])], kwargs)).toThrow("keywords must be strings");
    expect(source.items.size).toBe(3); expect(source.items.lookup(v.none)?.value).toBe(v.none);
  });
  it("preserves positional progress before invalid keyword errors through call collection", () => {
    const { meter, v, keys, source, key, dictionary } = fixture(), method = createRuntimeDictionaryMutationMethod(source, "update", v, meter), kwargs = dictionary();
    kwargs.items.set(v.integer(1), v.true);
    const collector = beginRuntimeCall(method, { values: v, keys, name: () => "dict.update()", keywordName: () => "1", callable: () => true,
      invoke(_callee, positional, keywords) { return method.value.invoke(positional, keywords, meter); } }, meter);
    collector.positional(v.list([v.tuple([key, v.false])])); collector.mapping(kwargs);
    expect(() => collector.invoke()).toThrow("keywords must be strings");
    expect(source.items.lookup(key)?.value).toBe(v.false);
  });
  it("validates method arguments without touching storage", () => {
    const { v, source, key, call, dictionary } = fixture(), kwargs = dictionary(); kwargs.items.set(key, v.none);
    for (const name of ["clear", "popitem"] as const) expect(() => call(name, [v.none])).toThrow(`dict.${name}() takes no arguments (1 given)`);
    for (const name of ["pop", "setdefault"] as const) {
      expect(() => call(name)).toThrow(`${name} expected at least 1 argument, got 0`);
      expect(() => call(name, [v.none, v.none, v.none])).toThrow(`${name} expected at most 2 arguments, got 3`);
    }
    for (const name of ["clear", "pop", "popitem", "setdefault"] as const) expect(() => call(name, [], kwargs)).toThrow(`dict.${name}() takes no keyword arguments`);
    expect(() => call("update", [v.none, v.none], kwargs)).toThrow("update expected at most 1 argument, got 2");
    expect(source.items.size).toBe(0);
  });
  it("constructs a popitem result before removing its entry", () => {
    const { meter, v, source, key } = fixture(); source.items.set(key, v.true);
    const failure = new ExecutionLimitError("allocation");
    expect(() => source.items.popitem(() => { throw failure; })).toThrow(failure);
    expect(source.items.snapshot()).toEqual([[key, v.true]]);
    const result = source.items.popitem((key, value) => v.tuple([key, value]));
    expect(result).toEqual(v.tuple([key, v.true])); expect(source.items.size).toBe(0); meter.checkpoint();
  });
});
