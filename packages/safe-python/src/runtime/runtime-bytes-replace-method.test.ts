import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], fresh = false) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input), fresh ? "fresh" : "canonical");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[], budget = meter) => {
    const method = runtimeNativeAttribute(value, "replace", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  const b = (...input: number[]) => v.bytes(Uint8Array.from(input));
  return { v, value, keywords, call, b };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("replaces nonoverlapping patterns with longer, shorter and arbitrary bytes", () => {
  const { call, b, v } = fixture([65, 65, 65, 65, 65]);
  expect(bytes(call([b(65, 65), b(0, 255, 66)]))).toEqual([0, 255, 66, 0, 255, 66, 65]);
  expect(bytes(call([b(65, 65), b(), v.integer(1n)]))).toEqual([65, 65, 65]);
  expect(bytes(call([b(65, 65), b(), v.integer(-2n)]))).toEqual([65]);
});

it("inserts at boundaries for an empty pattern and obeys count limits", () => {
  const { call, b, v } = fixture([65, 66]);
  expect(bytes(call([b(), b(255)]))).toEqual([255, 65, 255, 66, 255]);
  expect(bytes(call([b(), b(255), v.true]))).toEqual([255, 65, 66]);
  const empty = fixture([]);
  expect(bytes(empty.call([empty.b(), empty.b(65)]))).toEqual([65]);
});

it("retains no-op receivers but copies equal nonempty replacements", () => {
  for (const input of [[], [65], [65, 66]]) {
    const { call, b, v, value } = fixture(input, true);
    expect(call([b(255), b(0)])).toBe(value);
    expect(call([b(), b()])).toBe(value);
    expect(call([b(), b(0), v.false])).toBe(value);
  }
  const { call, b, value } = fixture([65]), same = b(65);
  expect(bytes(call([same, same]))).toEqual([65]);
  expect(call([same, same])).not.toBe(value);
  expect(call([same, b()])).toBe(b());
});

it("makes changed nonempty results fresh even for single-byte output", () => {
  const { call, b } = fixture([65, 66]);
  expect(call([b(66), b()])).not.toBe(b(65));
  const empty = fixture([]), replacement = empty.b(65);
  expect(empty.call([empty.b(), replacement])).not.toBe(replacement);
});

it("validates bytes and count before no-op shortcuts", () => {
  const { call, b, v } = fixture([]);
  expect(() => call([v.none, b(), v.false])).toThrow("a bytes-like object is required, not 'NoneType'");
  expect(() => call([b(), v.string("x"), v.false])).toThrow("a bytes-like object is required, not 'str'");
  expect(() => call([b(), b(), v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  expect(() => call([b(), b(), v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
});

it("requires two or three positional arguments and rejects keywords", () => {
  const { call, b, v, keywords } = fixture([]);
  expect(() => call([])).toThrow("replace expected at least 2 arguments, got 0");
  expect(() => call([b()])).toThrow("replace expected at least 2 arguments, got 1");
  expect(() => call([b(), b(), v.true, v.true])).toThrow("replace expected at most 3 arguments, got 4");
  keywords.items.set(v.string("count"), v.true);
  expect(() => call([b(), b()])).toThrow("bytes.replace() takes no keyword arguments");
});

it("meters repetitive searches and refuses expansion beyond the allocation budget", () => {
  const { call, b } = fixture(Array<number>(2000).fill(65));
  expect(() => call([b(65, 65, 65, 66), b()], new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  expect(() => call([b(), b(...Array<number>(100).fill(66))])).toThrow(ExecutionLimitError);
});

it("uses bounded search storage plus one output buffer and preserves immutability", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
  const source = ImmutableBytes.copyOf(Uint8Array.of(65, 65, 65), setup), old = ImmutableBytes.copyOf(Uint8Array.of(65), setup), replacement = ImmutableBytes.copyOf(Uint8Array.of(255, 0), setup);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 142 });
  const result = source.replace(old, replacement, -1n, meter);
  expect([...result]).toEqual([255, 0, 255, 0, 255, 0]);
  expect(meter.usage.allocatedBytes).toBe(142);
  result.toUint8Array(setup).fill(1);
  expect([...result]).toEqual([255, 0, 255, 0, 255, 0]);
  expect([...source]).toEqual([65, 65, 65]);
});
