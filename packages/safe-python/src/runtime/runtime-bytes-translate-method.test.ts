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
    const method = runtimeNativeAttribute(value, "translate", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  const b = (input: number[]) => v.bytes(Uint8Array.from(input));
  return { v, value, keywords, call, b };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("maps all bytes and deletes original bytes before translation", () => {
  const input = Array.from({ length: 256 }, (_, i) => i), { call, b } = fixture(input);
  const table = b(input.map(i => 255 - i));
  expect(bytes(call([table]))).toEqual(input.map(i => 255 - i));
  expect(bytes(call([table, b([0, 0, 255])]))).toEqual(input.slice(1, -1).map(i => 255 - i));
});

it("supports deletion without a translation table", () => {
  const { call, b, v } = fixture([65, 0, 66, 0, 255]);
  expect(bytes(call([v.none, b([0])]))).toEqual([65, 66, 255]);
});

it("retains unchanged receivers and makes changed results fresh or canonical empty", () => {
  for (const input of [[], [65], [65, 66]]) {
    const { call, b, v, value } = fixture(input, true);
    expect(call([v.none])).toBe(value);
    expect(call([b(Array.from({ length: 256 }, (_, i) => i)), b([255])])).toBe(value);
  }
  const { call, b, v } = fixture([65, 66]);
  expect(call([v.none, b([65])])).not.toBe(b([66]));
  expect(call([v.none, b([65, 66])])).toBe(b([]));
});

it("validates the table before deletion even for empty receivers", () => {
  const { call, b, v } = fixture([]);
  expect(() => call([v.true])).toThrow("a bytes-like object is required, not 'bool'");
  for (const length of [0, 255, 257]) expect(() => call([b(Array<number>(length).fill(0)), v.none])).toThrow("translation table must be 256 characters long");
  expect(() => call([v.none, v.none])).toThrow("a bytes-like object is required, not 'NoneType'");
});

it("accepts delete by keyword while requiring a positional table", () => {
  const { call, b, v, keywords } = fixture([65, 66]);
  expect(() => call([])).toThrow("translate() takes at least 1 positional argument (0 given)");
  keywords.items.set(v.string("delete"), b([65]));
  expect(bytes(call([v.none]))).toEqual([66]);
  expect(() => call([v.none, b([])])).toThrow("translate() takes at most 2 arguments (3 given)");
  keywords.items.clear(); keywords.items.set(v.string("table"), v.none);
  expect(() => call([])).toThrow("translate() takes at least 1 positional argument (0 given)");
  expect(() => call([v.none])).toThrow("translate() got an unexpected keyword argument 'table'");
});

it("bounds deletion lookup storage and allocates one exact output buffer", () => {
  const setup = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
  const b = (input: number[]) => ImmutableBytes.copyOf(Uint8Array.from(input), setup);
  const source = b([65, 66, 65, 255]), deleted = b(Array<number>(2000).fill(65));
  const meter = new ExecutionBudget({ maxSteps: 3000, maxAllocatedBytes: 258 });
  const result = source.translate(null, deleted, meter);
  expect([...result]).toEqual([66, 255]); expect(meter.usage.allocatedBytes).toBe(258);
  result.toUint8Array(setup).fill(0); expect([...result]).toEqual([66, 255]);
  expect([...source]).toEqual([65, 66, 65, 255]);
});

it("checks scan and deletion-set budgets", () => {
  const { call, b, v } = fixture(Array<number>(2000).fill(65));
  for (const args of [[b(Array.from({ length: 256 }, (_, i) => i))], [v.none, b(Array<number>(2000).fill(65))]]) expect(() => call(args, new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});
