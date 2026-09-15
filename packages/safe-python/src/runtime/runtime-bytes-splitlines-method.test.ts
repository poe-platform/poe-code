import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], fresh = false) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input), fresh ? "fresh" : "canonical");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(value, "splitlines", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, value, keywords, call };
}
function lines(value: RuntimeValue): number[][] {
  if (value.kind !== "list") throw new Error("expected list");
  return value.items.snapshot().map(item => {
    if (item.kind !== "bytes") throw new Error("expected bytes");
    return [...item.value];
  });
}

it("recognizes only CR, LF and paired CRLF boundaries", () => {
  const { call, v } = fixture([65, 13, 10, 66, 13, 67, 10]);
  expect(lines(call())).toEqual([[65], [66], [67]]);
  expect(lines(call([v.true]))).toEqual([[65, 13, 10], [66, 13], [67, 10]]);
  const other = [11, 12, 28, 29, 30, 133, 255];
  expect(lines(fixture([65, ...other, 66]).call())).toEqual([[65, ...other, 66]]);
});

it("preserves interior empty lines without appending a trailing empty line", () => {
  expect(lines(fixture([]).call())).toEqual([]);
  expect(lines(fixture([13, 10, 10, 13]).call())).toEqual([[], [], []]);
  expect(lines(fixture([65, 10, 10, 66]).call())).toEqual([[65], [], [66]]);
});

it("uses truth conversion for keepends even for empty input", () => {
  const { call, v } = fixture([65, 10]);
  for (const flag of [v.none, v.false, v.float(0), v.list([])]) expect(lines(call([flag]))).toEqual([[65]]);
  for (const flag of [v.true, v.float(.5), v.integer(1n << 100n), v.list([v.none])]) expect(lines(call([flag]))).toEqual([[65, 10]]);
  const empty = fixture([]); expect(() => empty.call([empty.v.notImplemented])).toThrow("NotImplemented should not be used in a boolean context");
});

it("retains unsplit fresh receivers and returns canonical sliced bytes", () => {
  const unchanged = fixture([65], true), result = unchanged.call();
  if (result.kind !== "list") throw new Error("expected list");
  expect(result.items.get(0n)).toBe(unchanged.value);
  const { call, v, value } = fixture([65, 10]), split = call(), kept = call([v.true]);
  if (split.kind !== "list" || kept.kind !== "list") throw new Error("expected lists");
  expect(split.items.get(0n)).toBe(v.bytes(Uint8Array.of(65))); expect(kept.items.get(0n)).toBe(value);
});

it("accepts keepends by keyword and validates call shape", () => {
  const { call, v, keywords } = fixture([65, 10]);
  keywords.items.set(v.string("keepends"), v.true);
  expect(lines(call())).toEqual([[65, 10]]);
  expect(() => call([v.true])).toThrow("splitlines() takes at most 1 argument (2 given)");
  keywords.items.clear(); keywords.items.set(v.string("other"), v.none);
  expect(() => call()).toThrow("splitlines() got an unexpected keyword argument 'other'");
  keywords.items.set(v.string("keepends"), v.true);
  expect(() => call()).toThrow("splitlines() takes at most 1 keyword argument (2 given)");
});

it("checks the scan budget inside long lines", () => {
  const { call } = fixture(Array<number>(2000).fill(65));
  expect(() => call([], new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});
