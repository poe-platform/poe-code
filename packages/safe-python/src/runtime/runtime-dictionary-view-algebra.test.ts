import { describe, expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const h = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, h, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dict = (...members: RuntimeValue[]) => { const result = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)); for (const key of members) result.items.set(key, v.none); return result; };
  return { meter, v, keys, dict };
}

describe("dictionary-view set algebra", () => {
  it.each([["|", [1, 2, 3]], ["&", [2]], ["-", [1]], ["^", [1, 3]]] as const)("implements key-view %s as a fresh mutable set", (operator, members) => {
    const { meter, v, dict } = fixture(), left = v.dictionaryView(dict(v.integer(1), v.integer(2)), "dict_keys"), right = v.dictionaryView(dict(v.integer(2), v.integer(3)), "dict_keys");
    const result = runtimeBinary(operator, left, right, v, meter);
    expect(result.kind).toBe("set");
    expect(runtimeComparison("==", result, v.set(dict(...members.map(n => v.integer(n))).items), v, meter)).toBe(v.true);
    expect(left.value.items.size).toBe(2); expect(right.value.items.size).toBe(2);
  });

  it("preserves reflected subtraction direction and mutable results with frozen operands", () => {
    const { meter, v, dict } = fixture(), view = v.dictionaryView(dict(v.true), "dict_keys"), frozen = v.frozenSet(dict(v.false).items);
    expect(runtimeComparison("==", runtimeBinary("-", v.list([v.true, v.false]), view, v, meter), v.set(dict(v.false).items), v, meter)).toBe(v.true);
    expect(runtimeBinary("|", frozen, view, v, meter).kind).toBe("set");
    const source = v.set(dict(v.false).items), updated = runtimeInPlace("|", source, view, v, meter);
    expect(updated).not.toBe(source); expect(source.items.size).toBe(1);
  });

  it("cancels equal unhashable item values during item-view xor", () => {
    const { meter, v, dict } = fixture(), a = dict(), b = dict(); a.items.set(v.true, v.list([v.false])); b.items.set(v.integer(1), v.list([v.false]));
    const left = v.dictionaryView(a, "dict_items"), right = v.dictionaryView(b, "dict_items");
    const result = runtimeBinary("^", left, right, v, meter); expect(result.kind).toBe("set");
    if (result.kind !== "set") throw new Error("expected set"); expect(result.items.size).toBe(0);
    b.items.set(v.integer(1), v.list([v.true]));
    expect(() => runtimeBinary("^", left, right, v, meter)).toThrow("unhashable type: 'list'");
  });

  it("distinguishes mutable-set intersection optimization from frozen-set membership", () => {
    const { meter, v, dict } = fixture(), a = dict(); a.items.set(v.true, v.list([])); const view = v.dictionaryView(a, "dict_items");
    expect(() => runtimeBinary("&", view, v.set(dict(v.true).items), v, meter)).toThrow("unhashable type: 'list'");
    const result = runtimeBinary("&", view, v.frozenSet(dict(v.true).items), v, meter);
    expect(result.kind).toBe("set"); if (result.kind !== "set") throw new Error("expected set"); expect(result.items.size).toBe(0);
  });

  it("does not stop generic intersection iteration after finding every view member", () => {
    const { meter, v, dict } = fixture(), view = v.dictionaryView(dict(v.true), "dict_keys"), iterator = v.iterator([v.true, v.list([]), v.false][Symbol.iterator]());
    expect(() => runtimeBinary("&", view, iterator, v, meter)).toThrow("unhashable type: 'list'");
    expect(iterator.value.next().value).toBe(v.false);
  });

  it("unions with mapping proxies in either direction", () => {
    const { meter, v, dict } = fixture(), view = v.dictionaryView(dict(v.true), "dict_keys"), proxy = v.mappingProxy(dict(v.false));
    for (const [left, right] of [[view, proxy], [proxy, view]]) expect(runtimeComparison("==", runtimeBinary("|", left, right, v, meter), v.set(dict(v.true, v.false).items), v, meter)).toBe(v.true);
  });
});
