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

describe("set difference and symmetric-difference methods", () => {
  it("returns a fresh receiver-kind difference across multiple sources", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.frozenSet(storage(v.true, v.integer(2), v.integer(3)));
    const method = createRuntimeSetAlgebraMethod(receiver, "difference", v, meter);
    const copy = method.value.invoke([], kwargs, meter); expect(copy.kind).toBe("frozenset"); expect(copy).not.toBe(receiver);
    const result = method.value.invoke([v.list([v.integer(1)]), v.set(storage(v.integer(2)))], kwargs, meter);
    expect(runtimeComparison("==", result, v.set(storage(v.integer(3))), v, meter)).toBe(v.true); expect(receiver.items.size).toBe(3);
  });

  it("streams difference-update removals and keeps them after a later unhashable key", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.false)), tail = v.integer(9), iterator = v.iterator([v.false, v.list([]), tail][Symbol.iterator]());
    expect(() => createRuntimeSetMutationMethod(receiver, "difference_update", v, meter).value.invoke([v.list([v.true]), iterator], kwargs, meter)).toThrow("unhashable type: 'list'");
    expect(receiver.items.size).toBe(0); expect(iterator.value.next().value).toBe(tail);
  });

  it("does not convert mutable-set keys during difference updates", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.frozenSet(storage()))), key = v.set(storage());
    expect(() => createRuntimeSetMutationMethod(receiver, "difference_update", v, meter).value.invoke([v.list([key])], kwargs, meter)).toThrow("unhashable type: 'set'");
    expect(receiver.items.size).toBe(1);
  });

  it("deduplicates generic symmetric-difference inputs before toggling membership", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.integer(2))), input = v.list([v.integer(1), v.integer(1), v.integer(3)]);
    const result = createRuntimeSetAlgebraMethod(receiver, "symmetric_difference", v, meter).value.invoke([input], kwargs, meter);
    expect(runtimeComparison("==", result, v.set(storage(v.integer(2), v.integer(3))), v, meter)).toBe(v.true);
    expect(createRuntimeSetMutationMethod(receiver, "symmetric_difference_update", v, meter).value.invoke([input], kwargs, meter)).toBe(v.none);
    expect(runtimeComparison("==", receiver, result, v, meter)).toBe(v.true);
  });

  it("leaves the receiver unchanged when generic xor input construction fails", () => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.false));
    expect(() => createRuntimeSetMutationMethod(receiver, "symmetric_difference_update", v, meter).value.invoke([v.list([v.true, v.list([])])], kwargs, meter)).toThrow("unhashable type: 'list'");
    expect(receiver.items.size).toBe(2);
  });

  it("uses dictionary cached hashes for initial difference and exact xor updates", () => {
    const { meter, v, keys, storage, kwargs } = fixture(), receiver = v.set(storage(v.true, v.false)), source = v.dictionary(storage(v.true));
    keys.hash = () => { throw new Error("unexpected hash"); };
    const result = createRuntimeSetAlgebraMethod(receiver, "difference", v, meter).value.invoke([source], kwargs, meter);
    expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set"); expect(result.items.snapshot()).toEqual([[v.false, v.none]]);
    expect(createRuntimeSetMutationMethod(receiver, "symmetric_difference_update", v, meter).value.invoke([source], kwargs, meter)).toBe(v.none);
    expect(receiver.items.snapshot()).toEqual([[v.false, v.none]]);
  });

  it("rehashes dictionary sources during difference-update rather than using the initial-difference fast path", () => {
    const { meter, v, keys, storage, kwargs } = fixture(), receiver = v.set(storage(v.true)), source = v.dictionary(storage(v.true));
    keys.hash = () => { throw new Error("hash called"); };
    expect(() => createRuntimeSetMutationMethod(receiver, "difference_update", v, meter).value.invoke([source], kwargs, meter)).toThrow("hash called");
    expect(receiver.items.size).toBe(1);
  });

  it("retains completed exact-xor mutations after a later equality failure", () => {
    const { meter, v } = fixture(); let fail = false;
    const keys = { hash: (key: RuntimeValue) => key === v.true ? 1n : 2n, equal: () => { if (fail) throw new Error("comparison failed"); return false; } };
    const receiver = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), source = v.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    receiver.items.set(v.true, v.none); receiver.items.set(v.false, v.none); source.items.set(v.true, v.none); source.items.set(v.integer(9), v.none); fail = true;
    expect(() => createRuntimeSetMutationMethod(receiver, "symmetric_difference_update", v, meter).value.invoke([source], kwargs, meter)).toThrow("comparison failed");
    expect(receiver.items.snapshot()).toEqual([[v.false, v.none]]);
  });

  it("creates empty hash-policy storage with bounded allocation even from a large sealed source", () => {
    const { meter, v, storage } = fixture(), source = storage(...Array.from({ length: 100 }, (_, i) => v.integer(i)));
    source.seal(); const before = meter.usage.allocatedBytes, result = source.emptyCopy();
    expect(meter.usage.allocatedBytes - before).toBeLessThan(1000); expect(result.size).toBe(0);
    result.set(v.true, v.none); expect(result.containsKey(v.integer(1))).toBe(true); expect(source.size).toBe(100);
  });

  it.each(["symmetric_difference", "symmetric_difference_update"] as const)("requires exactly one source for %s", name => {
    const { meter, v, storage, kwargs } = fixture(), receiver = v.set(storage());
    const method = name === "symmetric_difference" ? createRuntimeSetAlgebraMethod(receiver, name, v, meter) : createRuntimeSetMutationMethod(receiver, name, v, meter);
    expect(() => method.value.invoke([], kwargs, meter)).toThrow(`set.${name}() takes exactly one argument (0 given)`);
    expect(() => method.value.invoke([v.none, v.none], kwargs, meter)).toThrow(`set.${name}() takes exactly one argument (2 given)`);
  });
});
