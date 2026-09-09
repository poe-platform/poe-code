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
  const call = (args: RuntimeValue[], budget = meter) => {
    const method = runtimeNativeAttribute(b([255]), "fromhex", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, b, keywords, call };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}

it("decodes both cases and both text and byte inputs", () => {
  const { call, b, v } = fixture(), input = Array.from({ length: 256 }, (_, i) => i), text = input.map(i => i.toString(16).padStart(2, "0")).join("");
  expect(bytes(call([v.string(text)]))).toEqual(input);
  expect(bytes(call([v.string(text.toUpperCase())]))).toEqual(input);
  expect(bytes(call([b([...text].map(c => c.charCodeAt(0)))]))).toEqual(input);
});

it("allows only ASCII whitespace between complete pairs", () => {
  const { call, v } = fixture();
  expect(bytes(call([v.string(" \t\n\v\f\r00 \tFF\n")]))).toEqual([0, 255]);
  for (const text of ["0 0", "0\t", "00\x1cff"]) expect(() => call([v.string(text)])).toThrow(`non-hexadecimal number found in fromhex() arg at position ${text.startsWith("00") ? 2 : 1}`);
  for (const text of ["0", "  A", "00 f"]) expect(() => call([v.string(text)])).toThrow("fromhex() arg must contain an even number of hexadecimal digits");
});

it("prechecks non-ASCII text while bytes report the first invalid byte", () => {
  const { call, v, b } = fixture();
  expect(() => call([v.string("zé")])).toThrow("non-hexadecimal number found in fromhex() arg at position 1");
  expect(() => call([b([122, 233])])).toThrow("non-hexadecimal number found in fromhex() arg at position 0");
  for (const point of ["😀", "\ud800", "\u0085"]) expect(() => call([v.string("00 " + point)])).toThrow("non-hexadecimal number found in fromhex() arg at position 3");
});

it("canonicalizes empty and single-byte output but keeps longer outputs fresh", () => {
  const { call, v, b } = fixture();
  expect(call([v.string("00")])).toBe(b([0]));
  expect(call([v.string("0001")])).not.toBe(call([v.string("0001")]));
  expect(call([v.string(" \t")])).toBe(b([]));
  expect(call([b([])])).toBe(b([]));
});

it("requires one positional str or bytes argument", () => {
  const { call, v, keywords } = fixture();
  expect(() => call([])).toThrow("bytes.fromhex() takes exactly one argument (0 given)");
  expect(() => call([v.none, v.none])).toThrow("bytes.fromhex() takes exactly one argument (2 given)");
  expect(() => call([v.none])).toThrow("fromhex() argument must be str or bytes-like, not NoneType");
  expect(() => call([v.list([])])).toThrow("fromhex() argument must be str or bytes-like, not list");
  keywords.items.set(v.string("string"), v.string("00"));
  expect(() => call([])).toThrow("bytes.fromhex() takes no keyword arguments");
});

it("allocates bounded decoder state and one final buffer and keeps exports immutable", () => {
  const setup = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 }), source = ImmutableBytes.copyOf(Uint8Array.of(48, 48, 32, 70, 70), setup);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 130 });
  const result = ImmutableBytes.fromHex(source, meter);
  expect([...result]).toEqual([0, 255]); expect(meter.usage.allocatedBytes).toBe(130);
  result.toUint8Array(setup).fill(1); expect([...result]).toEqual([0, 255]);
  expect([...source]).toEqual([48, 48, 32, 70, 70]);
});

it("checks decoding work and output allocation budgets", () => {
  const { call, v } = fixture(), source = v.string("00".repeat(2000));
  expect(() => call([source], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  expect(() => call([source], new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
