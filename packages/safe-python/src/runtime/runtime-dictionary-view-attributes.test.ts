import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue, type DictionaryViewValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeIndex } from "./runtime-index.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), source = dictionary(), key = v.string("x");
  const call = (view: DictionaryViewValue, name: string, args: RuntimeValue[], kwargs = dictionary()) => {
    const method = readRuntimeDictionaryViewAttribute(view, name, v, meter);
    if (method?.kind !== "builtin_function_or_method") throw new Error("expected bound view method");
    return method.value.invoke(args, kwargs, meter);
  };
  return { meter, v, keys, dictionary, source, key, call };
}

describe("dictionary view read attributes", () => {
  it("publishes a fresh live mapping proxy without exposing the mutable dictionary", () => {
    const { meter, v, source, key } = fixture();
    for (const kind of ["dict_keys", "dict_values", "dict_items"] as const) {
      const view = v.dictionaryView(source, kind), a = readRuntimeDictionaryViewAttribute(view, "mapping", v, meter), b = readRuntimeDictionaryViewAttribute(view, "mapping", v, meter);
      expect(a?.kind).toBe("mappingproxy"); expect(a).not.toBe(b);
      source.items.set(key, v.true); expect(runtimeIndex(a!, key, v, meter)).toBe(v.true);
      source.items.set(key, v.false); expect(runtimeIndex(a!, key, v, meter)).toBe(v.false);
      expect(readRuntimeDictionaryViewAttribute(view, "value", v, meter)).toBeUndefined();
      expect(readRuntimeDictionaryViewAttribute(view, "__dict__", v, meter)).toBeUndefined();
    }
  });
  it("binds reverse iteration to the view and validates before creating a cursor", () => {
    const { meter, v, source, key, call, dictionary } = fixture(), y = v.string("y"); source.items.set(key, v.true); source.items.set(y, v.false);
    for (const kind of ["dict_keys", "dict_values", "dict_items"] as const) {
      const view = v.dictionaryView(source, kind), iterator = runtimeIterate(call(view, "__reversed__", []), v, meter);
      const expected = kind === "dict_keys" ? y : kind === "dict_values" ? v.false : v.tuple([y, v.false]);
      expect(iterator.next().value).toEqual(expected);
      expect(() => call(view, "__reversed__", [v.none])).toThrow(`${kind}.__reversed__() takes no arguments (1 given)`);
      const kwargs = dictionary(); kwargs.items.set(key, v.none);
      expect(() => call(view, "__reversed__", [], kwargs)).toThrow(`${kind}.__reversed__() takes no keyword arguments`);
    }
  });
  it("short-circuits disjointness on the first match without exhausting the iterable", () => {
    const { meter, v, source, key, call } = fixture(); source.items.set(key, v.true);
    for (const kind of ["dict_keys", "dict_items"] as const) {
      const match = kind === "dict_keys" ? key : v.tuple([key, v.true]), iterator = v.iterator(runtimeIterate(v.list([v.none, match, v.false]), v, meter));
      expect(call(v.dictionaryView(source, kind), "isdisjoint", [iterator])).toBe(v.false);
      expect(iterator.value.next().value).toBe(v.false);
    }
  });
  it("compares item values without hashing them and rejects only invalid item keys", () => {
    const { v, source, key, call } = fixture(); source.items.set(key, v.list([])); const view = v.dictionaryView(source, "dict_items");
    expect(call(view, "isdisjoint", [v.list([v.tuple([key, v.list([])])])])).toBe(v.false);
    expect(call(view, "isdisjoint", [v.list([v.list([key, v.list([])])])])).toBe(v.true);
    expect(() => call(view, "isdisjoint", [v.list([v.tuple([v.list([]), v.none])])])).toThrow("cannot use 'list' as a dict key");
  });
  it("uses the smaller set-like view and avoids hashing a view against itself", () => {
    const { meter, v, dictionary, call } = fixture(); let forbidHash = false;
    const source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash() { if (forbidHash) throw new Error("unexpected hash"); return 1n; }, equal: (a, b) => a === b }, meter));
    source.items.set(v.true, v.none); const full = v.dictionaryView(source, "dict_keys"), empty = v.dictionaryView(dictionary(), "dict_keys"); forbidHash = true;
    expect(call(full, "isdisjoint", [full])).toBe(v.false);
    expect(call(full, "isdisjoint", [empty])).toBe(v.true);
    expect(call(empty, "isdisjoint", [full])).toBe(v.true);
    expect(call(empty, "isdisjoint", [empty])).toBe(v.true);
    expect(() => call(empty, "isdisjoint", [v.list([v.list([])])])).toThrow("cannot use 'list' as a dict key");
  });
  it("does not expose isdisjoint on values and rejects bad calls before iteration", () => {
    const { meter, v, source, key, call, dictionary } = fixture();
    expect(readRuntimeDictionaryViewAttribute(v.dictionaryView(source, "dict_values"), "isdisjoint", v, meter)).toBeUndefined();
    for (const kind of ["dict_keys", "dict_items"] as const) {
      const view = v.dictionaryView(source, kind);
      expect(() => call(view, "isdisjoint", [])).toThrow(`${kind}.isdisjoint() takes exactly one argument (0 given)`);
      expect(() => call(view, "isdisjoint", [v.none, v.none])).toThrow(`${kind}.isdisjoint() takes exactly one argument (2 given)`);
      expect(() => call(view, "isdisjoint", [v.integer(1)])).toThrow("'int' object is not iterable");
      const kwargs = dictionary(); kwargs.items.set(key, v.none);
      expect(() => call(view, "isdisjoint", [v.iterator({ next() { throw new Error("must not iterate"); } })], kwargs)).toThrow(`${kind}.isdisjoint() takes no keyword arguments`);
    }
  });
  it("observes cancellation after iterator callbacks even on terminal next", () => {
    for (const done of [true, false]) {
      const controller = new AbortController(), { v, source, key, call } = fixture(controller.signal);
      const iterator = v.iterator({ next() { controller.abort(); return done ? { done: true as const, value: undefined } : { done: false as const, value: key }; } });
      expect(() => call(v.dictionaryView(source, "dict_keys"), "isdisjoint", [iterator])).toThrow(ExecutionLimitError);
    }
  });
});
