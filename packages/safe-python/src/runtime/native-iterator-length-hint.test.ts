import { expect, it } from "vitest";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";
import { ExecutionBudget } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { CompletionIterator } from "./iterator-completion.js";
import { RuntimeValues } from "./runtime-values.js";
import { runtimeBytesInput } from "./runtime-bytes-input.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { createSortedBuiltin } from "./builtin-sorted.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const next = (): never => { throw Error("hint must not pull"); };

it.each([undefined, 0, 3, 0n, 3n, (1n << 63n) - 1n])("validates native hint %s without pulling or reserving", hint => {
  const meter = budget(), cursor = { next, lengthHint() { expect(this === cursor).toBe(true); return hint; } };
  expect(nativeIteratorLengthHint(cursor, meter, 7n)).toBe(hint === undefined ? 7n : BigInt(hint));
  expect(meter.usage.allocatedBytes).toBe(0);
});

it.each([-1n, -(1n << 70n), 1n << 63n])("rejects invalid native hint %s", hint => {
  expect(() => nativeIteratorLengthHint({ next, lengthHint: () => hint }, budget())).toThrow(
    hint === -1n ? "__length_hint__() should return >= 0" : "Python int too large to convert to C ssize_t");
});

it("uses fallback only for absent hints and call-time guest TypeError", () => {
  expect(nativeIteratorLengthHint({ next }, budget(), -4n)).toBe(-4n);
  const failure = new PythonRuntimeError("TypeError", "unavailable");
  expect(nativeIteratorLengthHint({ next, lengthHint() { throw failure; } }, budget(), 9n)).toBe(9n);
  const cursor: CompletionIterator<unknown> = { next, get lengthHint(): () => bigint { throw failure; } };
  expect(() => nativeIteratorLengthHint(cursor, budget())).toThrow(failure);
  const host = new TypeError("host failure");
  expect(() => nativeIteratorLengthHint({ next, lengthHint() { throw host; } }, budget())).toThrow(host);
});

it.each(["lookup", "call", "throw"])("observes cancellation after native hint %s", phase => {
  const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  const cursor = { next, get lengthHint() {
    if (phase === "lookup") controller.abort();
    return () => { controller.abort(); if (phase === "throw") throw new PythonRuntimeError("TypeError", "ignored"); return 0n; };
  } };
  expect(() => nativeIteratorLengthHint(cursor, meter)).toThrow("execution cancelled");
});

it.each(["bytes", "sorted", "extend"])("validates hints in standalone %s consumers before pulling", consumer => {
  const meter = budget(), v = new RuntimeValues(meter), cursor = v.iterator({ next, lengthHint: () => 1n << 70n });
  const keywords = v.dictionary(new OrderedKeyMap({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  expect(() => {
    if (consumer === "bytes") return runtimeBytesInput(cursor, v, meter);
    const callable = consumer === "sorted" ? createSortedBuiltin(v, meter) : runtimeNativeAttribute(v.list([]), "extend", v, meter);
    if (callable.kind !== "builtin_function_or_method") throw Error("expected method");
    return callable.value.invoke([cursor], keywords, meter);
  }).toThrow("Python int too large to convert to C ssize_t");
});
