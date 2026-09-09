import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  let hashes = 0;
  const operations = { hash: (key: RuntimeValue) => { hashes++; return runtimeHash(key, hash, meter); }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dict = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(operations, meter));
  return { meter, v, dict, hashes: () => hashes, get: (key: RuntimeValue) => runtimeIndex(dict, key, v, meter), set: (key: RuntimeValue, value: RuntimeValue) => runtimeMutateItem(dict, key, { kind: "set", value }, v, meter), remove: (key: RuntimeValue) => runtimeMutateItem(dict, key, { kind: "delete" }, v, meter) };
}

describe("runtime dictionary item access", () => {
  it.each([false, true])("adds root-key context to guest hash failures (raised=%s)", raised => {
    const { v, meter } = fixture(), guest = v.cell({}), failure = new PythonRuntimeError("TypeError", "inside hash");
    const hash: RuntimeHashContext = {
      none: v.none, identity: () => 1n, string: () => 1n, bytes: () => 1n,
      guestHash: value => value !== guest ? undefined : {
        lookupHash: () => () => { if (raised) throw failure; return v.none; },
        integer: () => undefined, typeName: () => "Guest"
      }
    };
    const dict = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: key => runtimeHash(key, hash, meter), equal: (a, b) => a === b }, meter));
    for (const key of [guest, v.tuple([guest])]) {
      const type = key === guest ? "Guest" : "tuple";
      expect(() => runtimeMutateItem(dict, key, { kind: "set", value: v.none }, v, meter)).toThrow(`cannot use '${type}' as a dict key (${raised ? "inside hash" : "__hash__ method should return an integer"})`);
    }
    expect(dict.items.size).toBe(0);
  });
  it("does not relabel comparison errors or change storage after a failed lookup", () => {
    const { v, meter } = fixture(), failure = new PythonRuntimeError("TypeError", "comparison failed");
    const dict = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: () => { throw failure; } }, meter));
    const original = v.integer(1); dict.items.set(original, v.true);
    for (const operation of [() => runtimeIndex(dict, v.integer(2), v, meter), () => runtimeMutateItem(dict, v.integer(2), { kind: "set", value: v.false }, v, meter), () => runtimeMutateItem(dict, v.integer(2), { kind: "delete" }, v, meter)]) expect(operation).toThrow(failure);
    expect(dict.items.size).toBe(1); expect(dict.items.lookup(original)?.value).toBe(v.true);
  });
  it("keeps fatal limits separate from missing-key and hash errors", () => {
    const { v, dict } = fixture(), key = v.integer(1), failure = new ExecutionLimitError("steps");
    const meter = { checkpoint: () => { throw failure; } };
    expect(() => runtimeIndex(dict, key, v, meter)).toThrow(failure);
    expect(() => runtimeMutateItem(dict, key, { kind: "set", value: v.true }, v, meter)).toThrow(failure);
    expect(() => runtimeMutateItem(dict, key, { kind: "delete" }, v, meter)).toThrow(failure);
    expect(dict.items.size).toBe(0);
  });
  it("stores and retrieves exact value identities with one hash per operation", () => {
    const { v, dict, get, set, remove, hashes } = fixture(), value = v.list([]);
    set(v.true, value); expect(hashes()).toBe(1);
    expect(get(v.float(1))).toBe(value); expect(hashes()).toBe(2);
    set(v.integer(1), dict); expect(hashes()).toBe(3); expect(get(v.true)).toBe(dict);
    remove(v.float(1)); expect(hashes()).toBe(5); expect(dict.items.size).toBe(0);
  });
  it("preserves insertion order and original keys on overwrite", () => {
    const { v, dict, get, set, remove } = fixture(), first = v.integer(1), other = v.string("other");
    set(first, v.none); set(other, v.true); set(v.float(1), v.false);
    expect(dict.items.snapshot().map(([key]) => key)).toEqual([first, other]); expect(get(v.true)).toBe(v.false);
    remove(first); set(first, v.true); expect(dict.items.snapshot().map(([key]) => key)).toEqual([other, first]);
  });
  it("keeps missing keys as original exception arguments without converting them", () => {
    const { v, get, remove, hashes } = fixture(), key = v.tuple([v.string("missing"), v.integer(3)]);
    for (const operation of [get, remove]) {
      let error: unknown;
      try { operation(key); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ name: "KeyError", args: [key] });
      expect((error as { args: RuntimeValue[] }).args[0]).toBe(key);
      expect(Object.isFrozen((error as { args: RuntimeValue[] }).args)).toBe(true);
    }
    expect(hashes()).toBe(2);
  });
  it("uses slice objects as hashable keys without applying sequence-index rules", () => {
    const { v, get, set, remove } = fixture(), key = v.slice({ lower: v.string("a"), step: v.integer(0) });
    set(key, v.true); expect(get(v.slice({ lower: v.string("a"), step: v.integer(0) }))).toBe(v.true);
    remove(key);
  });
  it("reports unhashable outer keys consistently for reads, writes and deletion", () => {
    const { v, dict, get, set, remove } = fixture();
    for (const key of [v.list([]), v.tuple([v.list([])]), v.slice({ lower: v.list([]) })]) {
      for (const operation of [get, (key: RuntimeValue) => set(key, v.none), remove]) {
        expect(() => operation(key)).toThrow(`cannot use '${key.kind}' as a dict key (unhashable type: 'list')`);
        expect(dict.items.size).toBe(0);
      }
    }
  });
});
