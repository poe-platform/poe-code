import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(meter: ExecutionMeter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 })) {
  const v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (target: RuntimeValue, name: string, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(target, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected callable");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, meter, keywords, call };
}

it("creates independent iterators for builtin sequences", () => {
  const { v, call } = fixture();
  for (const [source, first] of [
    [v.list([v.true]), v.true], [v.tuple([v.true]), v.true],
    [v.string("😀"), v.string("😀")], [v.bytes(Uint8Array.of(255)), v.integer(255)],
    [v.range(createRange(7n, 9n)), v.integer(7)]
  ] as const) {
    const a = call(source, "__iter__"), b = call(source, "__iter__");
    // Compare identity before passing to matchers that inspect iterable payloads.
    expect(a === b).toBe(false);
    expect(call(a, "__next__")).toEqual(first);
    expect(call(b, "__next__")).toEqual(first);
  }
});
it("iterator __iter__ retains identity without pulling its cursor", () => {
  const { v, call } = fixture(); let pulls = 0;
  const iterator = v.iterator({ next() { pulls++; return { done: false, value: v.true }; } });
  expect(call(iterator, "__iter__")).toBe(iterator); expect(pulls).toBe(0);
  expect(call(iterator, "__next__")).toBe(v.true); expect(pulls).toBe(1);
});
it("iterates mappings, views and sets through their existing ordered cursors", () => {
  const { v, call, meter } = fixture();
  const storage = () => {
    const map = new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter);
    map.set(v.true, v.false); return map;
  };
  const dict = v.dictionary(storage());
  for (const source of [dict, v.mappingProxy(dict), v.dictionaryView(dict, "dict_keys"), v.set(storage()), v.frozenSet(storage())]) {
    expect(call(call(source, "__iter__"), "__next__")).toBe(v.true);
  }
  expect(call(call(v.dictionaryView(dict, "dict_values"), "__iter__"), "__next__")).toBe(v.false);
  expect(call(call(v.dictionaryView(dict, "dict_items"), "__iter__"), "__next__")).toEqual(v.tuple([v.true, v.false]));
  const iterator = call(dict, "__iter__"); dict.items.set(v.none, v.none);
  expect(() => call(iterator, "__next__")).toThrow("dictionary changed size during iteration");
});
it("exposes live list mutation and sticky exhaustion as StopIteration", () => {
  const { v, call } = fixture(), list = v.list([v.true]), iterator = call(list, "__iter__");
  expect(call(iterator, "__next__")).toBe(v.true);
  list.items.append(v.false); expect(call(iterator, "__next__")).toBe(v.false);
  expect(() => call(iterator, "__next__")).toThrow(expect.objectContaining({ name: "StopIteration", message: "" }));
  list.items.append(v.none);
  expect(() => call(iterator, "__next__")).toThrow(expect.objectContaining({ name: "StopIteration" }));
});
it("validates wrapper arguments before advancing an iterator", () => {
  const { v, call, keywords } = fixture(); let pulls = 0;
  const iterator = v.iterator({ next() { pulls++; return { done: false, value: v.true }; } });
  for (const name of ["__iter__", "__next__"]) {
    expect(() => call(iterator, name, [v.none])).toThrow("expected 0 arguments, got 1");
    keywords.items.set(v.string("x"), v.none);
    expect(() => call(iterator, name, [v.none])).toThrow(`wrapper ${name}() takes no keyword arguments`);
    keywords.items.clear();
  }
  expect(pulls).toBe(0);
});
it("does not expose iteration methods on unsupported receiver kinds", () => {
  const { v, call } = fixture();
  expect(() => call(v.integer(1), "__iter__")).toThrow("'int' object has no attribute '__iter__'");
  expect(() => call(v.list([]), "__next__")).toThrow("'list' object has no attribute '__next__'");
});
it("preserves iterator exceptions without closing the source", () => {
  const { v, call } = fixture(), error = new Error("source failed"); let closed = false;
  const iterator = v.iterator({ next() { throw error; }, return() { closed = true; return { done: true, value: v.none }; } });
  expect(() => call(iterator, "__next__")).toThrow(error); expect(closed).toBe(false);
});
it("checks cancellation after pulling, before delivering values or exhaustion", () => {
  for (const done of [false, true]) {
    let cancelled = false;
    const { v, call } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    const iterator = v.iterator({ next() { cancelled = true; return { done, value: v.true }; } });
    expect(() => call(iterator, "__next__")).toThrow(ExecutionLimitError);
  }
});

it.each(["list", "tuple", "str", "bytes", "range"])("exposes remaining %s iterator hints without pulling", kind => {
  const { v, call } = fixture();
  const sources = { list: v.list([v.true, v.false]), tuple: v.tuple([v.true, v.false]), str: v.string("😀x"), bytes: v.bytes(Uint8Array.of(1, 2)), range: v.range(createRange(0n, 2n)) };
  const iterator = call(sources[kind as keyof typeof sources], "__iter__");
  expect(call(iterator, "__length_hint__")).toEqual(v.integer(2));
  expect(call(iterator, "__length_hint__")).toEqual(v.integer(2));
  call(iterator, "__next__"); expect(call(iterator, "__length_hint__")).toEqual(v.integer(1));
  call(iterator, "__next__"); expect(call(iterator, "__length_hint__")).toEqual(v.integer(0));
});

it("retains unbounded range hints without machine-size conversion", () => {
  const { v, call } = fixture(), size = 1n << 100n;
  const iterator = call(v.range(createRange(0n, size)), "__iter__");
  expect(call(iterator, "__length_hint__")).toEqual(v.integer(size));
  call(iterator, "__next__"); expect(call(iterator, "__length_hint__")).toEqual(v.integer(size - 1n));
});

it("reads live list hints and keeps exhaustion sticky", () => {
  const { v, call } = fixture(), list = v.list([v.true]), iterator = call(list, "__iter__");
  list.items.append(v.false); expect(call(iterator, "__length_hint__")).toEqual(v.integer(2));
  list.items.clear(); expect(call(iterator, "__length_hint__")).toEqual(v.integer(0));
  list.items.append(v.true); expect(call(iterator, "__length_hint__")).toEqual(v.integer(1));
  call(iterator, "__next__"); expect(() => call(iterator, "__next__")).toThrow(expect.objectContaining({ name: "StopIteration" }));
  list.items.append(v.true); expect(call(iterator, "__length_hint__")).toEqual(v.integer(0));
});

it("exposes mapping and set cursor hints without projecting items", () => {
  const { v, call, meter } = fixture();
  const map = new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter);
  map.set(v.true, v.false); map.set(v.none, v.true);
  const dict = v.dictionary(map);
  for (const source of [dict, v.mappingProxy(dict), v.dictionaryView(dict, "dict_keys"), v.dictionaryView(dict, "dict_values"), v.dictionaryView(dict, "dict_items"), v.set(map), v.frozenSet(map)]) {
    const iterator = call(source, "__iter__");
    expect(call(iterator, "__length_hint__")).toEqual(v.integer(2));
    call(iterator, "__next__"); expect(call(iterator, "__length_hint__")).toEqual(v.integer(1));
  }
});

it("leaves hintless cursors without a length-hint attribute", () => {
  const { v, call } = fixture();
  expect(() => call(v.iterator({ next: () => ({ done: true, value: undefined }) }), "__length_hint__")).toThrow("has no attribute '__length_hint__'");
});

it("validates hint arguments and checks cancellation after the callback", () => {
  let cancelled = false, calls = 0;
  const { v, call, keywords } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
  const iterator = v.iterator({ next: () => ({ done: true, value: undefined }), lengthHint() { calls++; cancelled = true; return 1n; } });
  expect(() => call(iterator, "__length_hint__", [v.none])).toThrow("expected 0 arguments");
  keywords.items.set(v.string("x"), v.none);
  expect(() => call(iterator, "__length_hint__")).toThrow("takes no keyword arguments");
  keywords.items.clear(); expect(calls).toBe(0);
  expect(() => call(iterator, "__length_hint__")).toThrow(ExecutionLimitError); expect(calls).toBe(1);
});
