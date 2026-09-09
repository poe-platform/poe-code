import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const b = (input: number[]) => v.bytes(Uint8Array.from(input));
  const call = (args: RuntimeValue[], receiver = b([]), budget = meter) => {
    const method = runtimeNativeAttribute(receiver, "maketrans", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, b, keywords, call };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("constructs an identity table and changes each requested byte mapping", () => {
  const { call, b } = fixture(), identity = Array.from({ length: 256 }, (_, i) => i);
  expect(bytes(call([b([]), b([])]))).toEqual(identity);
  expect(bytes(call([b(identity), b(identity.map(i => 255 - i))]))).toEqual(identity.map(i => 255 - i));
  const expected = [...identity]; expected[0] = 255; expected[255] = 0;
  expect(bytes(call([b([0, 255]), b([255, 0])]))).toEqual(expected);
});

it("uses the last mapping when a source byte occurs repeatedly", () => {
  const { call, b } = fixture(), table = bytes(call([b([65, 66, 65]), b([1, 2, 3])]));
  expect(table[65]).toBe(3); expect(table[66]).toBe(2);
});

it("ignores the instance receiver and produces a fresh table each time", () => {
  const { call, b } = fixture(), from = b([65]), to = b([66]);
  const first = call([from, to], b([255])), second = call([from, to], b([0, 1]));
  expect(bytes(first)).toEqual(bytes(second)); expect(first).not.toBe(second);
});

it("validates both byte arguments before comparing lengths", () => {
  const { call, b, v } = fixture();
  expect(() => call([v.none, v.none])).toThrow("a bytes-like object is required, not 'NoneType'");
  expect(() => call([b([65]), v.string("x")])).toThrow("a bytes-like object is required, not 'str'");
  expect(() => call([b([65]), b([])])).toThrow("maketrans arguments must have same length");
});

it("requires exactly two positional arguments", () => {
  const { call, b, v, keywords } = fixture();
  for (const args of [[], [b([])], [b([]), b([]), b([])]]) expect(() => call(args)).toThrow(`maketrans expected 2 arguments, got ${args.length}`);
  keywords.items.set(v.string("frm"), v.none);
  expect(() => call([])).toThrow("bytes.maketrans() takes no keyword arguments");
});

it("allocates only the table and keeps source and exported bytes immutable", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
  const from = ImmutableBytes.copyOf(Uint8Array.of(65, 65), setup), to = ImmutableBytes.copyOf(Uint8Array.of(0, 255), setup);
  const meter = new ExecutionBudget({ maxSteps: 300, maxAllocatedBytes: 256 });
  const result = ImmutableBytes.maketrans(from, to, meter);
  expect(meter.usage.allocatedBytes).toBe(256); expect([...result][65]).toBe(255);
  result.toUint8Array(setup).fill(0); expect([...result][65]).toBe(255);
  expect([...from]).toEqual([65, 65]); expect([...to]).toEqual([0, 255]);
});

it("checks allocation before construction and meters long duplicate mapping lists", () => {
  const { call, b } = fixture(), from = b(Array<number>(2000).fill(65)), to = b(Array<number>(2000).fill(66));
  expect(() => call([from, to], b([]), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
  expect(() => call([from, to], b([]), new ExecutionBudget({ maxSteps: 400, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});
