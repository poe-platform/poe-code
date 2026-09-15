import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { createLenBuiltin } from "./builtin-len.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { readRuntimeTypeAttribute, mutateRuntimeTypeAttribute } from "./runtime-type-attributes.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import { beginRuntimeDictionary } from "./runtime-dictionary-display.js";
import { beginRuntimeCall } from "./runtime-call.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (key: RuntimeValue) => runtimeHash(key, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const source = dictionary(), proxy = v.mappingProxy(source), key = v.string("x");
  return { meter, v, hash, keys, dictionary, source, proxy, key };
}

describe("dictionary-backed mapping proxies", () => {
  it("fetches mapping values after key collection and hashes through mapping expansion", () => {
    const { meter, v, dictionary } = fixture(); let hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: RuntimeValue, b: RuntimeValue) => a === b };
    const source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
    const target = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), key = v.string("x");
    source.items.set(key, v.true); const proxy = v.mappingProxy(source); hashes = 0;
    updateRuntimeDictionary(target, proxy, v, meter); expect(hashes).toBe(2);
    hashes = 0;
    const call = beginRuntimeCall(v.none, { values: v, keys, name: () => "f()", keywordName: () => "x", callable: () => true, invoke: () => dictionary() }, meter);
    call.mapping(proxy); expect(hashes).toBe(3);
  });
  it("preserves dictionary identity for in-place union with proxies and iterable pairs", () => {
    const { meter, v, source, proxy, dictionary, key } = fixture(), target = dictionary(); source.items.set(key, v.true);
    expect(runtimeInPlace("|", target, proxy, v, meter)).toBe(target);
    expect(target.items.lookup(key)?.value).toBe(v.true);
    expect(runtimeInPlace("|", target, v.list([v.tuple([key, v.false])]), v, meter)).toBe(target);
    expect(target.items.lookup(key)?.value).toBe(v.false);
  });
  it("retains earlier writes when mapping lookup loses a later captured key", () => {
    const { meter, v, source, proxy, key } = fixture(), later = v.string("later");
    source.items.set(key, v.true); source.items.set(later, v.false);
    const target = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({
      hash() { source.items.delete(later); return 1n; }, equal: (a, b) => a === b
    }, meter));
    expect(() => updateRuntimeDictionary(target, proxy, v, meter)).toThrow("dictionary key not found");
    expect(target.items.snapshot()).toEqual([[key, v.true]]);
  });
  it("rejects duplicate call keys before fetching their proxy values", () => {
    const { meter, v, keys, dictionary, key } = fixture(); let reading = false;
    const source = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({
      hash() { if (reading) throw new Error("source value was fetched"); return 23n; }, equal: (a, b) => a === b
    }, meter));
    source.items.set(key, v.true); reading = true;
    const call = beginRuntimeCall(v.none, { values: v, keys, name: () => "f()", keywordName: () => "x", callable: () => true, invoke: () => dictionary() }, meter);
    call.keywords([["x", v.false]]);
    expect(() => call.mapping(v.mappingProxy(source))).toThrow("f() got multiple values for keyword argument 'x'");
  });
  it("exposes live lookup, membership, truth, length and key iteration without copying", () => {
    const { meter, v, source, proxy, key, dictionary } = fixture();
    expect(Object.isFrozen(proxy)).toBe(true); expect(runtimeTruth(proxy, meter)).toBe(false);
    source.items.set(key, v.true);
    expect(runtimeIndex(proxy, key, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", key, proxy, v, meter)).toBe(v.true);
    expect(runtimeTruth(proxy, meter)).toBe(true);
    expect(createLenBuiltin(v, meter).value.invoke([proxy], dictionary(), meter)).toEqual(v.integer(1));
    const iterator = runtimeIterate(proxy, v, meter); expect(iterator.next().value).toBe(key);
    source.items.set(v.string("y"), v.false);
    expect(() => iterator.next()).toThrow("dictionary changed size during iteration");
    source.items.delete(key); expect(runtimeMembership("not in", key, proxy, v, meter)).toBe(v.true);
    expect(() => runtimeIndex(proxy, key, v, meter)).toThrow("dictionary key not found");
  });
  it("rejects writes before hashing and delegates key and hash errors to the underlying dictionary", () => {
    const { meter, v, proxy, source, hash } = fixture(), key = v.list([]);
    for (const change of [{ kind: "set", value: v.true }, { kind: "delete" }] as const) {
      expect(() => runtimeMutateItem(proxy, key, change, v, meter))
        .toThrow(`'mappingproxy' object does not support item ${change.kind === "set" ? "assignment" : "deletion"}`);
    }
    expect(source.items.size).toBe(0);
    expect(() => runtimeIndex(proxy, key, v, meter)).toThrow("cannot use 'list' as a dict key");
    expect(() => runtimeHash(proxy, hash, meter)).toThrow("unhashable type: 'dict'");
  });
  it("delegates rich comparison while retaining proxy identity and cycle limits", () => {
    const { meter, v, proxy, source, dictionary, key } = fixture(), other = dictionary();
    source.items.set(key, v.true); other.items.set(key, v.true);
    for (const [a, b] of [[proxy, other], [other, proxy], [proxy, v.mappingProxy(other)]]) {
      expect(runtimeComparison("==", a, b, v, meter)).toBe(v.true);
      expect(runtimeComparison("!=", a, b, v, meter)).toBe(v.false);
    }
    expect(runtimeComparison("is", proxy, source, v, meter)).toBe(v.false);
    expect(() => runtimeComparison("<", proxy, other, v, meter)).toThrow("'<' not supported between instances of 'dict' and 'dict'");
    expect(() => runtimeComparison("<", other, proxy, v, meter)).toThrow("'>' not supported between instances of 'dict' and 'dict'");
    source.items.set(key, proxy); other.items.set(key, v.mappingProxy(other));
    expect(() => runtimeComparison("==", proxy, other, v, meter, 20)).toThrow("maximum recursion depth exceeded");
  });
  it("unions into a fresh dictionary in operand order and rejects in-place union", () => {
    const { meter, v, proxy, source, dictionary, key } = fixture(), other = dictionary();
    source.items.set(key, v.true); other.items.set(key, v.false);
    const result = runtimeBinary("|", proxy, v.mappingProxy(other), v, meter);
    expect(result.kind).toBe("dict"); expect(runtimeIndex(result, key, v, meter)).toBe(v.false);
    expect(source.items.lookup(key)?.value).toBe(v.true);
    expect(runtimeIndex(runtimeBinary("|", other, proxy, v, meter), key, v, meter)).toBe(v.true);
    expect(() => runtimeInPlace("|", proxy, other, v, meter)).toThrow("'|=' is not supported by mappingproxy; use '|' instead");
    expect(runtimeBinary("+", proxy, other, v, meter)).toBe(v.notImplemented);
    expect(() => runtimeBinary("|", proxy, v.integer(1), v, meter)).toThrow("unsupported operand type(s) for |: 'dict' and 'int'");
    expect(() => runtimeBinary("|", v.none, proxy, v, meter)).toThrow("unsupported operand type(s) for |: 'NoneType' and 'dict'");
  });
  it("supports dictionary construction and both forms of mapping expansion", () => {
    const { meter, v, proxy, source, dictionary, key, keys } = fixture(); source.items.set(key, v.true);
    const target = dictionary(); updateRuntimeDictionary(target, proxy, v, meter); expect(target.items.lookup(key)?.value).toBe(v.true);
    const display = beginRuntimeDictionary([], v, keys, meter); display.update(proxy);
    const displayed = display.finish();
    if (displayed.kind !== "dict") throw new Error("expected dictionary display");
    expect(displayed.items.snapshot()).toEqual(target.items.snapshot());
    const call = beginRuntimeCall(v.none, { values: v, keys, name: () => "f()", keywordName: () => "x", callable: () => true,
      invoke(_callee, positional, keywords) { expect(positional).toEqual([]); return keywords; } }, meter);
    call.mapping(proxy); expect(runtimeIndex(call.invoke(), key, v, meter)).toBe(v.true);
  });
  it("installs a read-only type dictionary descriptor with fresh live views", () => {
    const { meter, v, keys, dictionary, key } = fixture(), registry = new RuntimeTypeRegistry(v, keys, meter);
    const cls = registry.publish(new RuntimeTypeLayout("C", [registry.object.value], dictionary(), meter), registry.type);
    const context = { slots: () => undefined }, name = v.string("__dict__");
    const first = readRuntimeTypeAttribute(cls, name, context, v, meter)!.value;
    const second = readRuntimeTypeAttribute(cls, name, context, v, meter)!.value;
    expect(first.kind).toBe("mappingproxy"); expect(first).not.toBe(second);
    mutateRuntimeTypeAttribute(cls, key, { kind: "set", value: v.true }, context, v, meter);
    expect(runtimeIndex(first, key, v, meter)).toBe(v.true);
    cls.value.namespace.items.set(name, v.false);
    expect(readRuntimeTypeAttribute(cls, name, context, v, meter)!.value.kind).toBe("mappingproxy");
    expect(() => mutateRuntimeTypeAttribute(cls, name, { kind: "set", value: dictionary() }, context, v, meter))
      .toThrow("attribute '__dict__' of 'type' objects is not writable");
  });
});
