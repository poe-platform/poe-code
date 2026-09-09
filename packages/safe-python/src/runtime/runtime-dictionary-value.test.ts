import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { ExecutionBudget } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMutateItem } from "./runtime-mutation.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash: RuntimeHashContext = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const operations = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  return { meter, v, hash, dictionary: () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(operations, meter)) };
}

describe("runtime dictionary records", () => {
  it("retains prepared storage under a frozen value wrapper", () => {
    const { meter, v, dictionary } = fixture(), first = dictionary(), second = v.dictionary(first.items);
    expect(first.kind).toBe("dict"); expect(Object.isFrozen(first)).toBe(true); expect(second.items).toBe(first.items);
    expect(runtimeTruth(first, meter)).toBe(false);
    first.items.set(v.integer(1), first); expect(runtimeTruth(first, meter)).toBe(true);
    expect(second.items.lookup(v.integer(1))?.value).toBe(first);
  });
  it("merges equal numeric keys while retaining the original key and its position", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary(), key = v.integer(1);
    dict.items.set(key, v.none); dict.items.set(v.string("other"), v.true); dict.items.set(v.float(1), v.false);
    expect(dict.items.size).toBe(2); expect(dict.items.lookup(v.true)?.value).toBe(v.false);
    const iterator = runtimeIterate(dict, v, meter);
    expect(iterator.next().value).toBe(key); expect(iterator.next().value).toEqual(v.string("other")); expect(iterator.next().done).toBe(true);
  });
  it("tests membership against keys, not values", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary(); dict.items.set(v.integer(1), v.integer(2));
    expect(runtimeMembership("in", v.float(1), dict, v, meter)).toBe(v.true);
    expect(runtimeMembership("not in", v.integer(2), dict, v, meter)).toBe(v.true);
    expect(() => runtimeMembership("in", v.list([]), dictionary(), v, meter)).toThrow("unhashable type: 'list'");
  });
  it("adds dictionary-key context to unhashable membership errors", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary();
    for (const key of [v.list([]), dictionary(), v.tuple([v.list([])]), v.slice({ lower: v.list([]) })]) {
      const nested = key.kind === "dict" ? "dict" : "list";
      expect(() => runtimeMembership("in", key, dict, v, meter)).toThrow(`cannot use '${key.kind}' as a dict key (unhashable type: '${nested}')`);
    }
  });
  it("preserves insertion order after replacement and delete/reinsert", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary(), a = v.string("a"), b = v.string("b");
    dict.items.set(a, v.true); dict.items.set(b, v.false); dict.items.set(v.string("a"), v.none);
    dict.items.delete(a); dict.items.set(a, v.true);
    const iterator = runtimeIterate(dict, v, meter);
    expect(iterator.next().value).toBe(b); expect(iterator.next().value).toBe(a);
  });
  it("uses live dictionary iterator mutation checks", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary(); dict.items.set(v.integer(1), v.true);
    const iterator = runtimeIterate(dict, v, meter); dict.items.set(v.integer(2), v.false);
    expect(() => iterator.next()).toThrow("dictionary changed size during iteration");
  });
  it("rejects dictionary hashes without traversing cyclic values", () => {
    const { meter, v, hash, dictionary } = fixture(), dict = dictionary(); dict.items.set(v.integer(1), dict);
    expect(() => runtimeHash(dict, hash, meter)).toThrow("unhashable type: 'dict'");
    expect(() => runtimeHash(v.tuple([dict]), hash, meter)).toThrow("unhashable type: 'dict'");
  });
  it("keeps unfinished dictionary access explicit", () => {
    const { meter, v, dictionary } = fixture(), dict = dictionary();
    expect(() => runtimeIndex(dict, v.integer(1), v, meter)).toThrow(UnsupportedExpressionError);
    expect(() => runtimeMutateItem(dict, v.integer(1), { kind: "set", value: v.true }, v, meter)).toThrow(UnsupportedExpressionError);
  });
});
