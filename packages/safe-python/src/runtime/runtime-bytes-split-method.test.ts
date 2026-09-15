import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], name: "split" | "rsplit" = "split", fresh = false) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input), fresh ? "fresh" : "canonical");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(value, name, v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    const result = method.value.invoke(args, keywords, budget);
    if (result.kind !== "list") throw new Error("expected list");
    return result.items.snapshot();
  };
  const b = (...input: number[]) => v.bytes(Uint8Array.from(input));
  return { v, value, keywords, call, b };
}
function parts(values: readonly RuntimeValue[]) {
  return values.map(value => {
    if (value.kind !== "bytes") throw new Error("expected bytes");
    return [...value.value];
  });
}

it("splits nonoverlapping separators from the selected side", () => {
  const forward = fixture([65, 65, 65, 65, 65]), reverse = fixture([65, 65, 65, 65, 65], "rsplit");
  expect(parts(forward.call([forward.b(65, 65)]))).toEqual([[], [], [65]]);
  expect(parts(reverse.call([reverse.b(65, 65)]))).toEqual([[65], [], []]);
  expect(parts(forward.call([forward.b(65, 65), forward.v.true]))).toEqual([[], [65, 65, 65]]);
  expect(parts(reverse.call([reverse.b(65, 65), reverse.v.true]))).toEqual([[65, 65, 65], []]);
});

it("uses only six ASCII whitespace bytes and omits empty whitespace pieces", () => {
  for (const name of ["split", "rsplit"] as const) {
    const { call } = fixture([9, 10, 11, 12, 13, 32, 65, 133, 28, 255, 32, 66, 9], name);
    expect(parts(call())).toEqual([[65, 133, 28, 255], [66]]);
    expect(parts(fixture([], name).call())).toEqual([]);
    expect(parts(fixture([9, 32, 13], name).call())).toEqual([]);
  }
});

it("preserves the unprocessed whitespace remainder at the limit", () => {
  const input = [32, 65, 32, 66, 32, 67, 32];
  const forward = fixture(input), reverse = fixture(input, "rsplit");
  expect(parts(forward.call([forward.v.none, forward.v.false]))).toEqual([[65, 32, 66, 32, 67, 32]]);
  expect(parts(reverse.call([reverse.v.none, reverse.v.false]))).toEqual([[32, 65, 32, 66, 32, 67]]);
  expect(parts(forward.call([forward.v.none, forward.v.true]))).toEqual([[65], [66, 32, 67, 32]]);
  expect(parts(reverse.call([reverse.v.none, reverse.v.true]))).toEqual([[32, 65, 32, 66], [67]]);
});

it("retains unsplit receivers but copies zero-limit whitespace remainders", () => {
  for (const name of ["split", "rsplit"] as const) for (const input of [[], [65], [65, 66]]) {
    const { call, b, v, value } = fixture(input, name, true);
    expect(call([b(255)])[0]).toBe(value);
    expect(call([b(255), v.false])[0]).toBe(value);
    if (input.length === 0) continue;
    expect(call()[0]).toBe(value);
    const copied = call([v.none, v.false])[0];
    expect(copied).not.toBe(value);
    if (input.length === 1) expect(copied).toBe(b(65));
  }
});

it("canonicalizes empty and single-byte partial results", () => {
  const { call, b } = fixture([65, 0, 0]);
  expect(call([b(0)])).toEqual([b(65), b(), b()]);
  const result = call([b(0)]);
  expect(result[0]).toBe(b(65)); expect(result[1]).toBe(result[2]);
});

it("accepts sep/maxsplit keywords and detects duplicate and unknown arguments", () => {
  for (const name of ["split", "rsplit"] as const) {
    const { call, keywords, b, v } = fixture([65, 0, 66], name);
    keywords.items.set(v.string("sep"), b(0)); keywords.items.set(v.string("maxsplit"), v.true);
    expect(parts(call())).toEqual([[65], [66]]);
    keywords.items.clear(); keywords.items.set(v.string("sep"), b(0));
    expect(() => call([b(0)])).toThrow(`argument for ${name}() given by name ('sep') and position (1)`);
    keywords.items.clear(); keywords.items.set(v.string("bad"), v.none);
    expect(() => call()).toThrow(`${name}() got an unexpected keyword argument 'bad'`);
    expect(() => call([b(), v.true])).toThrow(`${name}() takes at most 2 arguments (3 given)`);
  }
});

it("validates maxsplit before separator and rejects empty separators at zero limit", () => {
  const { call, b, v } = fixture([]);
  expect(() => call([v.true, v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  expect(() => call([v.true])).toThrow("a bytes-like object is required, not 'bool'");
  expect(() => call([b(), v.false])).toThrow("empty separator");
  expect(() => call([b(65), v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
});

it("meters both whitespace and repetitive explicit separator scans", () => {
  for (const name of ["split", "rsplit"] as const) {
    const { call, b } = fixture(Array<number>(2000).fill(65), name);
    for (const args of [[], [b(65, 65, 65, 66)]]) expect(() => call(args, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  }
});
