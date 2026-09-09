import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], name: "center" | "ljust" | "rjust" | "zfill", fresh = false) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input), fresh ? "fresh" : "canonical");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[], budget = meter) => {
    const method = runtimeNativeAttribute(value, name, v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, value, keywords, call };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("pads left, right and center with single arbitrary bytes", () => {
  for (const [name, expected] of [["ljust", [65, 255, 255, 255]], ["rjust", [255, 255, 255, 65]], ["center", [255, 65, 255, 255]]] as const) {
    const { call, v } = fixture([65], name);
    expect(bytes(call([v.integer(4n), v.bytes(Uint8Array.of(255))]))).toEqual(expected);
    expect(bytes(call([v.integer(4n)]))).toEqual(expected.map(b => b === 255 ? 32 : b));
  }
  const { call, v } = fixture([65, 66], "center");
  expect(bytes(call([v.integer(5n)]))).toEqual([32, 32, 65, 66, 32]);
});

it("places zfill zeros after an initial ASCII sign only", () => {
  for (const input of [[43, 49], [45, 49], [49, 45], [255, 49], [], [43]]) {
    const { call, v } = fixture(input, "zfill");
    const zeros = Array<number>(4 - input.length).fill(48);
    expect(bytes(call([v.integer(4n)]))).toEqual(input[0] === 43 || input[0] === 45 ? [input[0], ...zeros, ...input.slice(1)] : [...zeros, ...input]);
  }
});

it("retains unchanged fresh receivers and makes padded one-byte outputs fresh", () => {
  for (const name of ["center", "ljust", "rjust", "zfill"] as const) {
    for (const input of [[], [65], [65, 66]]) {
      const { call, v, value } = fixture(input, name, true);
      expect(call([v.integer(BigInt(input.length))])).toBe(value);
      expect(call([v.integer(-1n)])).toBe(value);
    }
    const { call, v } = fixture([], name);
    const result = call([v.true]);
    expect(bytes(result)).toEqual([name === "zfill" ? 48 : 32]);
    expect(result).not.toBe(v.bytes(Uint8Array.of(name === "zfill" ? 48 : 32)));
  }
});

it("validates fill type and size even when no padding is needed", () => {
  for (const name of ["center", "ljust", "rjust"] as const) {
    const { call, v } = fixture([65], name);
    expect(() => call([v.false, v.string("x")])).toThrow(`${name}() argument 2 must be a byte string of length 1, not str`);
    expect(() => call([v.false, v.none])).toThrow(new PythonRuntimeError("TypeError", `${name}() argument 2 must be a byte string of length 1, not None`));
    for (const fill of [[], [65, 66]]) expect(() => call([v.false, v.bytes(Uint8Array.from(fill))])).toThrow(`${name}(): argument 2 must be a byte string of length 1, not a bytes object of length ${fill.length}`);
    expect(() => call([v.none, v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  }
});

it("checks positional call shape, rejects keywords and enforces ssize bounds", () => {
  for (const name of ["center", "ljust", "rjust", "zfill"] as const) {
    const { call, v, keywords } = fixture([], name);
    expect(() => call([])).toThrow(name === "zfill" ? "bytes.zfill() takes exactly one argument (0 given)" : `${name} expected at least 1 argument, got 0`);
    expect(() => call([v.true, v.true, v.true])).toThrow(name === "zfill" ? "bytes.zfill() takes exactly one argument (3 given)" : `${name} expected at most 2 arguments, got 3`);
    expect(() => call([v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
    keywords.items.set(v.string("width"), v.true);
    expect(() => call([])).toThrow(`bytes.${name}() takes no keyword arguments`);
  }
});

it("checks allocation before padding and work budgets during output filling", () => {
  const { call, v } = fixture([65], "rjust");
  expect(() => call([v.integer(1n << 32n)])).toThrow(ExecutionLimitError);
  const small = fixture([65], "center");
  expect(() => small.call([small.v.integer(1000n)], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});

it("charges one exact output buffer and leaves input and exports independent", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
  const source = ImmutableBytes.copyOf(Uint8Array.of(45, 255), setup);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 5 });
  const result = source.pad(5n, "sign", 48, meter);
  expect([...result]).toEqual([45, 48, 48, 48, 255]);
  expect(meter.usage.allocatedBytes).toBe(5);
  result.toUint8Array(setup).fill(0);
  expect([...result]).toEqual([45, 48, 48, 48, 255]);
  expect([...source]).toEqual([45, 255]);
  const unchanged = new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 });
  expect(source.pad(2n, "center", 0, unchanged)).toBe(source);
  for (const fill of [-1, 256, .5, NaN]) expect(() => source.pad(0n, "left", fill, setup)).toThrow("padding requires a valid byte");
});
