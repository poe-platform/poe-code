import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(meter: ExecutionMeter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 })) {
  const v = new RuntimeValues(meter), separator = v.bytes(Uint8Array.of(255));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (source: RuntimeValue, sep = separator) => {
    const method = runtimeNativeAttribute(sep, "join", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke([source], keywords, meter);
  };
  return { v, call, keywords };
}

it("joins arbitrary bytes without text conversion", () => {
  const { v, call } = fixture(), result = call(v.tuple([v.bytes(Uint8Array.of(0, 128)), v.bytes(Uint8Array.of(254))]));
  if (result.kind !== "bytes") throw new Error("expected bytes");
  expect([...result.value]).toEqual([0, 128, 255, 254]);
});

it("retains singleton input identity, including fresh empty bytes", () => {
  const { v, call } = fixture();
  for (const value of [v.bytes(Uint8Array.of(65), "fresh"), v.bytes(new Uint8Array(), "fresh")]) expect(call(v.list([value]))).toBe(value);
  expect(call(v.tuple([]))).toBe(v.bytes(new Uint8Array()));
});

it("keeps nonempty multi-item output fresh but canonicalizes empty output", () => {
  const { v, call } = fixture(), empty = v.bytes(new Uint8Array()), a = v.bytes(Uint8Array.of(65));
  const result = call(v.tuple([a, empty]), empty);
  expect(result === a).toBe(false); if (result.kind !== "bytes") throw new Error("expected bytes");
  expect([...result.value]).toEqual([65]);
  expect(call(v.tuple([empty, empty]), empty)).toBe(empty);
});

it("fully consumes generic iterators before reporting a bad member", () => {
  const { v, call } = fixture(), source = [v.bytes(Uint8Array.of(97)), v.none, v.bytes(Uint8Array.of(98))][Symbol.iterator]();
  expect(() => call(v.iterator(source))).toThrow("sequence item 1: expected a bytes-like object, NoneType found");
  expect(source.next().done).toBe(true);
});

it("preserves iterator failures over previously collected bad members", () => {
  const { v, call } = fixture(); let count = 0;
  const source = v.iterator({ next() { if (count++ === 0) return { done: false, value: v.none }; throw new TypeError("next failed"); } });
  expect(() => call(source)).toThrow("next failed");
});

it("distinguishes noniterable input from non-byte iterable elements", () => {
  const { v, call } = fixture();
  expect(() => call(v.none)).toThrow("can only join an iterable");
  expect(() => call(v.bytes(Uint8Array.of(97)))).toThrow("sequence item 0: expected a bytes-like object, int found");
  expect(() => call(v.string("a"))).toThrow("sequence item 0: expected a bytes-like object, str found");
});

it("checks cancellation immediately after pulling an iterator element", () => {
  let cancelled = false, calls = 0;
  const { v, call } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
  const source = v.iterator({ next() { calls++; cancelled = true; return { done: false, value: v.none }; } });
  expect(() => call(source)).toThrow(ExecutionLimitError); expect(calls).toBe(1);
});

it("validates call shape before traversing input", () => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter);
  const method = runtimeNativeAttribute(v.bytes(new Uint8Array()), "join", v, meter);
  if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  expect(() => method.value.invoke([], keywords, meter)).toThrow("bytes.join() takes exactly one argument (0 given)");
  expect(() => method.value.invoke([v.none, v.none], keywords, meter)).toThrow("bytes.join() takes exactly one argument (2 given)");
  keywords.items.set(v.string("iterable"), v.none);
  expect(() => method.value.invoke([], keywords, meter)).toThrow("bytes.join() takes no keyword arguments");
});
