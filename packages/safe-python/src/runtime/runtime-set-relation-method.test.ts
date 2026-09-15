import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeSetRelationMethod } from "./runtime-set-relation-method.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const h = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, h, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const storage = (...members: RuntimeValue[]) => { const result = new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter); for (const key of members) result.set(key, v.none); return result; };
  const kwargs = v.dictionary(storage());
  const call = (receiver: Parameters<typeof createRuntimeSetRelationMethod>[0], name: Parameters<typeof createRuntimeSetRelationMethod>[1], args: RuntimeValue[] = []) => createRuntimeSetRelationMethod(receiver, name, v, meter).value.invoke(args, kwargs, meter);
  return { meter, v, keys, storage, kwargs, call };
}

describe("set and frozen-set relationship methods", () => {
  it("copies mutable sets shallowly and returns frozen receivers unchanged", () => {
    const { v, storage, call } = fixture(), member = v.tuple([v.true]), source = v.set(storage(member)), frozen = v.frozenSet(storage(member));
    const result = call(source, "copy"); expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set");
    expect(result).not.toBe(source); expect(result.items.snapshot()[0][0]).toBe(member); result.items.clear(); expect(source.items.size).toBe(1);
    expect(call(frozen, "copy")).toBe(frozen);
  });

  it.each(["isdisjoint", "issubset", "issuperset"] as const)("uses cached hashes for exact %s operands", name => {
    const { v, keys, storage, call } = fixture(), a = v.set(storage(v.true)), b = v.frozenSet(storage(v.integer(1)));
    keys.hash = () => { throw new Error("unexpected hash"); };
    expect(call(a, name, [b])).toBe(name === "isdisjoint" ? v.false : v.true);
    expect(call(b, name, [a])).toBe(name === "isdisjoint" ? v.false : v.true);
  });

  it("stops generic subset iteration after all receiver members are found", () => {
    const { v, storage, call } = fixture(), source = v.set(storage(v.true)), remaining = v.list([]), iterator = v.iterator([v.integer(1), remaining][Symbol.iterator]());
    expect(call(source, "issubset", [iterator])).toBe(v.true); expect(iterator.value.next().value).toBe(remaining);
  });

  it("does not skip hashing a generic source merely because the receiver is empty", () => {
    const { v, storage, call } = fixture(), empty = v.set(storage());
    expect(() => call(empty, "issubset", [v.list([v.list([])])])).toThrow("unhashable type: 'list'");
    expect(() => call(empty, "isdisjoint", [v.list([v.list([])])])).toThrow("cannot use 'list' as a set element");
  });

  it("stops disjointness at a match and superset testing at a missing member", () => {
    const { v, storage, call } = fixture(), source = v.set(storage(v.true)), tail = v.list([]);
    const disjoint = v.iterator([v.integer(1), tail][Symbol.iterator]()), superset = v.iterator([v.false, tail][Symbol.iterator]());
    expect(call(source, "isdisjoint", [disjoint])).toBe(v.false); expect(disjoint.value.next().value).toBe(tail);
    expect(call(source, "issuperset", [superset])).toBe(v.false); expect(superset.value.next().value).toBe(tail);
  });

  it.each(["isdisjoint", "issubset", "issuperset"] as const)("does not convert mutable-set keys from generic %s inputs", name => {
    const { v, storage, call } = fixture(), source = v.set(storage(v.frozenSet(storage()))), probe = v.set(storage());
    expect(() => call(source, name, [v.list([probe])])).toThrow("unhashable type: 'set'");
  });

  it.each(["copy", "isdisjoint", "issubset", "issuperset"] as const)("validates %s arity and keywords", name => {
    const { v, storage, kwargs, call } = fixture(), source = v.frozenSet(storage());
    expect(() => call(source, name, [v.true, v.false])).toThrow(name === "copy" ? "frozenset.copy() takes no arguments (2 given)" : `frozenset.${name}() takes exactly one argument (2 given)`);
    kwargs.items.set(v.string("x"), v.none);
    expect(() => call(source, name)).toThrow(`frozenset.${name}() takes no keyword arguments`);
  });
});
