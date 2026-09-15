import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { createRuntimeSetAlgebraMethod } from "./runtime-set-algebra-method.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const h = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, h, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const storage = (...members: RuntimeValue[]) => { const result = new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter); for (const key of members) result.set(key, v.none); return result; };
  const kwargs = v.dictionary(storage());
  return { meter, v, keys, storage, kwargs };
}

describe("multi-source set algebra methods", () => {
  it.each(["union", "intersection"] as const)("returns a fresh result for %s without arguments, even on frozen receivers", name => {
    const { meter, v, storage, kwargs } = fixture();
    for (const receiver of [v.set(storage(v.true)), v.frozenSet(storage(v.true))]) {
      const result = createRuntimeSetAlgebraMethod(receiver, name, v, meter).value.invoke([], kwargs, meter);
      expect(result.kind).toBe(receiver.kind); expect(result).not.toBe(receiver);
      expect(runtimeComparison("==", result, receiver, v, meter)).toBe(v.true);
    }
  });

  it("unions several sources while retaining original member identities", () => {
    const { meter, v, storage, kwargs } = fixture(), member = v.integer(1), receiver = v.frozenSet(storage(member));
    const result = createRuntimeSetAlgebraMethod(receiver, "union", v, meter).value.invoke([v.list([v.true, v.false]), v.set(storage(v.integer(2)))], kwargs, meter);
    expect(result.kind).toBe("frozenset"); if (result.kind !== "frozenset") throw new Error("expected frozenset");
    expect(result.items.snapshot()[0][0]).toBe(member); expect(result.items.size).toBe(3); expect(receiver.items.size).toBe(1);
  });

  it("intersects in source order and preserves short-circuited iterator tails", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.false)), tail = v.list([]), iterator = v.iterator([v.integer(1), tail][Symbol.iterator]());
    const result = createRuntimeSetAlgebraMethod(receiver, "intersection", v, meter).value.invoke([v.set(storage(v.true)), iterator], kwargs, meter);
    expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set");
    expect(result.items.snapshot()).toEqual([[v.integer(1), v.none]]); expect(iterator.value.next().value).toBe(tail);
    expect(receiver.items.size).toBe(2);
  });

  it("does not skip a later invalid iterable after reaching an empty intersection", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true));
    expect(() => createRuntimeSetAlgebraMethod(receiver, "intersection", v, meter).value.invoke([v.list([]), v.true], kwargs, meter)).toThrow("'bool' object is not iterable");
  });

  it("publishes intersection_update only after every source succeeds", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.false)), original = receiver.items;
    const method = createRuntimeSetMutationMethod(receiver, "intersection_update", v, meter);
    expect(() => method.value.invoke([v.list([v.true]), v.list([v.list([])])], kwargs, meter)).toThrow("unhashable type: 'list'");
    expect(receiver.items.size).toBe(2);
    expect(method.value.invoke([v.list([v.true])], kwargs, meter)).toBe(v.none);
    expect(receiver.items).toBe(original); expect(receiver.items.snapshot()).toEqual([[v.true, v.none]]);
  });

  it("does not roll back mutations performed by an input iterator itself", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true));
    const source = v.iterator({ next() { receiver.items.set(v.false, v.none); throw new Error("next failed"); } });
    expect(() => createRuntimeSetMutationMethod(receiver, "intersection_update", v, meter).value.invoke([source], kwargs, meter)).toThrow("next failed");
    expect(receiver.items.size).toBe(2);
  });

  it("skips original-receiver union arguments without equality work", () => {
    const { meter, v, storage, keys, kwargs } = fixture();
    keys.hash = () => 1n;
    const receiver = v.set(storage(v.true, v.false));
    keys.equal = () => { throw new Error("unexpected equality"); };
    const result = createRuntimeSetAlgebraMethod(receiver, "union", v, meter).value.invoke([receiver, receiver], kwargs, meter);
    expect(result.kind).toBe("set");
  });
});
