import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { constructRuntimeFrozenSet } from "./runtime-frozenset.js";
import { createLenBuiltin } from "./builtin-len.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const storage = (...items: RuntimeValue[]) => { const map = new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter); for (const key of items) map.set(key, v.none); return map; };
  return { meter, v, hash, keys, storage };
}

describe("frozen set runtime values", () => {
  it("seals owned storage and hashes cached member hashes independent of insertion order", () => {
    const { meter, v, hash, storage } = fixture(), frozen = v.frozenSet(storage(v.integer(1), v.integer(2), v.integer(3)));
    expect(Object.isFrozen(frozen)).toBe(true); expect(runtimeHash(frozen, hash, meter)).toBe(-272375401224217160n);
    expect(runtimeHash(v.frozenSet(storage(v.integer(3), v.true, v.integer(2))), hash, meter)).toBe(runtimeHash(frozen, hash, meter));
    expect(() => frozen.items.clear()).toThrow("key storage is sealed");
  });

  it("supports size-based truth, iteration, membership and mutable-set comparison", () => {
    const { meter, v, storage } = fixture(), frozen = v.frozenSet(storage(v.true, v.false)), mutable = v.set(storage(v.integer(1), v.integer(0)));
    expect(runtimeTruth(frozen, meter)).toBe(true); expect(runtimeTruth(v.frozenSet(storage()), meter)).toBe(false);
    expect([...runtimeIterate(frozen, v, meter)]).toEqual([v.true, v.false]);
    expect(runtimeMembership("in", v.integer(1), frozen, v, meter)).toBe(v.true);
    expect(runtimeComparison("==", mutable, frozen, v, meter)).toBe(v.true);
    expect(runtimeComparison("<=", frozen, mutable, v, meter)).toBe(v.true);
  });

  it.each(["&", "|", "^", "-"])("uses the left operand's mutability for binary %s", operator => {
    const { meter, v, storage } = fixture(), frozen = v.frozenSet(storage(v.true)), mutable = v.set(storage(v.false));
    expect(runtimeBinary(operator, frozen, mutable, v, meter).kind).toBe("frozenset");
    expect(runtimeBinary(operator, mutable, frozen, v, meter).kind).toBe("set");
    const result = runtimeInPlace(operator, frozen, mutable, v, meter);
    expect(result.kind).toBe("frozenset"); expect(frozen.items.size).toBe(1);
    expect(runtimeInPlace(operator, mutable, frozen, v, meter)).toBe(mutable);
  });

  it("can be nested and used as a dictionary key without rehashing members", () => {
    const { meter, v, hash, storage } = fixture(), frozen = v.frozenSet(storage(v.true)), nested = v.frozenSet(storage(frozen));
    const dictionary = storage(nested);
    expect(dictionary.containsKey(v.frozenSet(storage(v.frozenSet(storage(v.integer(1))))))).toBe(true);
    expect(runtimeHash(v.tuple([nested]), hash, meter)).toEqual(expect.any(BigInt));
  });

  it("constructs from iterables and returns exact frozen inputs unchanged", () => {
    const { meter, v, keys, storage } = fixture(), kwargs = v.dictionary(storage());
    const source = v.set(storage(v.true, v.false)), frozen = constructRuntimeFrozenSet([source], kwargs, v, keys, meter);
    source.items.clear(); expect(frozen.items.size).toBe(2);
    expect(constructRuntimeFrozenSet([frozen], kwargs, v, keys, meter)).toBe(frozen);
    expect(constructRuntimeFrozenSet([], kwargs, v, keys, meter).items.size).toBe(0);
    expect(() => constructRuntimeFrozenSet([v.true, v.false], kwargs, v, keys, meter)).toThrow("frozenset expected at most 1 argument, got 2");
    kwargs.items.set(v.string("iterable"), v.none);
    expect(() => constructRuntimeFrozenSet([frozen], kwargs, v, keys, meter)).toThrow("frozenset() takes no keyword arguments");
  });

  it("uses equivalent frozen hashes for mutable-set membership probes only", () => {
    const { meter, v, storage } = fixture(), member = v.frozenSet(storage(v.true)), mutableKey = v.set(storage(v.integer(1)));
    for (const container of [v.set(storage(member)), v.frozenSet(storage(member))]) expect(runtimeMembership("in", mutableKey, container, v, meter)).toBe(v.true);
    expect(() => storage().set(mutableKey, v.none)).toThrow("unhashable type: 'set'");
    mutableKey.items.clear(); expect(runtimeMembership("in", mutableKey, v.frozenSet(storage(member)), v, meter)).toBe(v.false);
  });

  it("supports len, set-like dictionary views and cached-hash fromkeys", () => {
    const { meter, v, keys, storage } = fixture(), frozen = v.frozenSet(storage(v.true)), dict = v.dictionary(storage(v.integer(1))), kwargs = v.dictionary(storage());
    expect(createLenBuiltin(v, meter).value.invoke([frozen], kwargs, meter)).toEqual(v.integer(1));
    const view = v.dictionaryView(dict, "dict_keys");
    expect(runtimeComparison("==", frozen, view, v, meter)).toBe(v.true);
    const method = readRuntimeDictionaryViewAttribute(view, "isdisjoint", v, meter); if (method?.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(method.value.invoke([frozen], kwargs, meter)).toBe(v.false);
    const result = createDictionaryFromKeysBuiltin(v, keys, meter).value.invoke([frozen, v.false], kwargs, meter);
    expect(result.kind).toBe("dict"); if (result.kind !== "dict") throw new Error("expected dict");
    expect(result.items.lookup(v.true)?.value).toBe(v.false);
  });

  it("does not rehash frozen inputs for fromkeys or an empty view's disjointness", () => {
    const { meter, v, keys, storage } = fixture(), frozen = v.frozenSet(storage(v.true)), empty = v.dictionary(storage()), kwargs = v.dictionary(storage());
    keys.hash = () => { throw new Error("unexpected hash"); };
    const method = readRuntimeDictionaryViewAttribute(v.dictionaryView(empty, "dict_keys"), "isdisjoint", v, meter);
    if (method?.kind !== "builtin_function_or_method") throw new Error("expected method");
    expect(method.value.invoke([frozen], kwargs, meter)).toBe(v.true);
    const result = createDictionaryFromKeysBuiltin(v, keys, meter).value.invoke([frozen], kwargs, meter);
    expect(result.kind).toBe("dict");
  });
});
