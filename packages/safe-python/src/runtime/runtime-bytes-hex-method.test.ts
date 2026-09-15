import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[]) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(value, "hex", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    const result = method.value.invoke(args, keywords, budget);
    if (result.kind !== "str") throw new Error("expected str");
    return String.fromCodePoint(...result.value);
  };
  return { v, keywords, call };
}

it("formats every byte as two lowercase hexadecimal digits", () => {
  const input = Array.from({ length: 256 }, (_, i) => i);
  expect(fixture(input).call()).toBe(input.map(i => i.toString(16).padStart(2, "0")).join(""));
  expect(fixture([]).call()).toBe("");
});

it("groups from the right for positive sizes and from the left for negative sizes", () => {
  const { call, v } = fixture([1, 2, 3, 4, 5]), sep = v.string("-");
  expect(call([sep])).toBe("01-02-03-04-05");
  expect(call([sep, v.integer(2n)])).toBe("01-0203-0405");
  expect(call([sep, v.integer(-2n)])).toBe("0102-0304-05");
  for (const n of [0n, 6n, -6n, -2147483648n]) expect(call([sep, v.integer(n)])).toBe("0102030405");
  expect(call([v.bytes(Uint8Array.of(0)), v.true])).toBe("01\0" + "02\0" + "03\0" + "04\0" + "05");
});

it("accepts sep and bytes_per_sep keywords with positional duplication checks", () => {
  const { call, v, keywords } = fixture([1, 2, 3]);
  keywords.items.set(v.string("bytes_per_sep"), v.integer(2n));
  expect(call()).toBe("010203");
  keywords.items.set(v.string("sep"), v.string("-"));
  expect(call()).toBe("01-0203");
  keywords.items.clear(); keywords.items.set(v.string("sep"), v.string("-"));
  expect(() => call([v.string("x")])).toThrow("argument for hex() given by name ('sep') and position (1)");
  expect(() => call([v.string("x"), v.true])).toThrow("hex() takes at most 2 arguments (3 given)");
  keywords.items.clear(); keywords.items.set(v.string("bad"), v.none);
  expect(() => call()).toThrow("hex() got an unexpected keyword argument 'bad'");
});

it("checks group integer conversion before separator validation even for empty input", () => {
  const { call, v } = fixture([]);
  expect(() => call([v.none, v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  for (const n of [2147483648n, -2147483649n]) expect(() => call([v.none, v.integer(n)])).toThrow("Python int too large to convert to C int");
});

it("checks separator length before requiring str/bytes and ASCII", () => {
  const { call, v } = fixture([]);
  expect(() => call([v.none])).toThrow("object of type 'NoneType' has no len()");
  for (const sep of [v.string(""), v.string("ab"), v.list([]), v.list([v.true, v.false])]) expect(() => call([sep])).toThrow("sep must be length 1.");
  expect(() => call([v.list([v.true])])).toThrow("sep must be str or bytes.");
  for (const sep of [v.string("é"), v.string("😀"), v.bytes(Uint8Array.of(255))]) expect(() => call([sep])).toThrow("sep must be ASCII.");
});

it("builds one exact code-point buffer without mutating the byte source", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 }), source = ImmutableBytes.copyOf(Uint8Array.of(0, 255), setup);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 20 });
  const result = CodePointString.fromBytesHex(source, 45, 1, meter);
  expect([...result]).toEqual([48, 48, 45, 102, 102]); expect(meter.usage.allocatedBytes).toBe(20);
  expect([...source]).toEqual([0, 255]);
});

it("checks output allocation and work during formatting", () => {
  const { call } = fixture(Array<number>(2000).fill(255));
  expect(() => call([], new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
  expect(() => call([], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
});
