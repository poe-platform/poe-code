import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], fresh = false) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input), fresh ? "fresh" : "canonical");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(value, "expandtabs", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, value, keywords, call };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("expands bytes to tab stops with default, integer and boolean sizes", () => {
  const { call, v } = fixture([65, 9, 66, 9]);
  expect(bytes(call())).toEqual([65, ...Array<number>(7).fill(32), 66, ...Array<number>(7).fill(32)]);
  expect(bytes(call([v.integer(3n)]))).toEqual([65, 32, 32, 66, 32, 32]);
  expect(bytes(call([v.true]))).toEqual([65, 32, 66, 32]);
});

it("resets columns only at CR and LF and counts all other bytes once", () => {
  for (const boundary of [10, 13, 11, 12, 28, 133, 255]) {
    const { call, v } = fixture([65, boundary, 9]);
    expect(bytes(call([v.integer(4n)]))).toEqual([65, boundary, ...Array<number>(boundary === 10 || boundary === 13 ? 4 : 2).fill(32)]);
  }
});

it("removes tabs for nonpositive sizes", () => {
  const { call, v } = fixture([65, 9, 9, 66, 13, 9]);
  for (const n of [0n, -1n, -2147483648n]) expect(bytes(call([v.integer(n)]))).toEqual([65, 66, 13]);
});

it("creates fresh nonempty outputs even without tabs and canonical empty outputs", () => {
  for (const input of [[65], [65, 66]]) {
    const { call, value } = fixture(input), result = call();
    expect(bytes(result)).toEqual(input); expect(result).not.toBe(value);
  }
  const empty = fixture([], true);
  expect(empty.call()).toBe(empty.v.bytes(new Uint8Array()));
  const tabs = fixture([9]);
  expect(tabs.call([tabs.v.false])).toBe(tabs.v.bytes(new Uint8Array()));
  const single = fixture([65, 9]);
  expect(single.call([single.v.false])).not.toBe(single.v.bytes(Uint8Array.of(65)));
});

it("validates C-int bounds and types even for empty input", () => {
  const { call, v } = fixture([]);
  for (const n of [2147483648n, -2147483649n, 1n << 100n]) expect(() => call([v.integer(n)])).toThrow("Python int too large to convert to C int");
  expect(() => call([v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  expect(() => call([v.float(1)])).toThrow("'float' object cannot be interpreted as an integer");
});

it("accepts tabsize by keyword and validates call shape", () => {
  const { call, v, keywords } = fixture([9]);
  keywords.items.set(v.string("tabsize"), v.integer(2n));
  expect(bytes(call())).toEqual([32, 32]);
  expect(() => call([v.true])).toThrow("expandtabs() takes at most 1 argument (2 given)");
  keywords.items.set(v.string("bad"), v.true);
  expect(() => call()).toThrow("expandtabs() takes at most 1 keyword argument (2 given)");
  keywords.items.clear(); keywords.items.set(v.string("bad"), v.true);
  expect(() => call()).toThrow("expandtabs() got an unexpected keyword argument 'bad'");
});

it("rejects oversized output before allocation and meters long scans", () => {
  const tabs = fixture([9]);
  expect(() => tabs.call([tabs.v.integer(2147483647n)])).toThrow(ExecutionLimitError);
  const plain = fixture(Array<number>(2000).fill(65));
  expect(() => plain.call([], new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});

it("allocates only the final byte buffer and keeps exported buffers independent", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
  const input = ImmutableBytes.copyOf(Uint8Array.of(65, 9, 255), setup);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 5 });
  const result = input.expandTabs(4, meter);
  expect([...result]).toEqual([65, 32, 32, 32, 255]);
  expect(meter.usage.allocatedBytes).toBe(5);
  const exported = result.toUint8Array(setup); exported.fill(0);
  expect([...result]).toEqual([65, 32, 32, 32, 255]);
  expect([...input]).toEqual([65, 9, 255]);
});

it("meters space filling after sizing and rejects unrepresentable lengths", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
  const input = ImmutableBytes.copyOf(Uint8Array.of(9), setup);
  const meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 100 });
  expect(() => input.expandTabs(100, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(100);
  expect(() => input.expandTabs(.5, setup)).toThrow("tab size must be a safe integer");
  expect(() => input.expandTabs(0x100000000, setup)).toThrow(ExecutionLimitError);
});
