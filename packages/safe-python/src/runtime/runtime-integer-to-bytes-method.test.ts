import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(receiver, "to_bytes", v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, keywords, call };
}
function bytes(value: RuntimeValue) {
  if (value.kind !== "bytes") throw new Error("expected bytes");
  return [...value.value];
}
it("defaults to one unsigned big-endian byte and handles bool receivers", () => {
  const { call, v } = fixture();
  expect(bytes(call(v.integer(255)))).toEqual([255]); expect(bytes(call(v.true))).toEqual([1]); expect(bytes(call(v.false))).toEqual([0]);
  expect(() => call(v.integer(256))).toThrow("int too big to convert");
});
it("writes both byte orders with zero padding", () => {
  const { call, v } = fixture();
  expect(bytes(call(v.integer(0x123456n), [v.integer(5), v.string("big")]))).toEqual([0, 0, 18, 52, 86]);
  expect(bytes(call(v.integer(0x123456n), [v.integer(5), v.string("little")]))).toEqual([86, 52, 18, 0, 0]);
});
it("encodes two's complement and validates signed boundaries", () => {
  const { call, v, keywords } = fixture(); keywords.items.set(v.string("signed"), v.true);
  expect(bytes(call(v.integer(-128)))).toEqual([128]); expect(bytes(call(v.integer(-1)))).toEqual([255]);
  expect(bytes(call(v.integer(-256), [v.integer(3), v.string("little")]))).toEqual([0, 255, 255]);
  expect(bytes(call(v.integer(-32768), [v.integer(2)]))).toEqual([128, 0]);
  for (const n of [-129, 128, 255]) expect(() => call(v.integer(n))).toThrow("int too big to convert");
});
it("permits only zero in zero bytes and keeps nonempty results fresh", () => {
  const { call, v, keywords } = fixture();
  expect(call(v.integer(0), [v.integer(0)])).toBe(v.bytes(new Uint8Array()));
  expect(call(v.integer(1))).not.toBe(v.bytes(Uint8Array.of(1)));
  expect(() => call(v.integer(-1))).toThrow("can't convert negative int to unsigned");
  keywords.items.set(v.string("signed"), v.true);
  expect(() => call(v.integer(-1), [v.integer(0)])).toThrow("int too big to convert");
});
it("accepts named arguments and enforces keyword-only signed", () => {
  const { call, v, keywords } = fixture();
  keywords.items.set(v.string("length"), v.integer(2)); keywords.items.set(v.string("byteorder"), v.string("little"));
  expect(bytes(call(v.integer(256)))).toEqual([0, 1]);
  keywords.items.clear(); keywords.items.set(v.string("length"), v.true);
  expect(() => call(v.true, [v.true])).toThrow("argument for to_bytes() given by name ('length') and position (1)");
  keywords.items.clear();
  expect(() => call(v.true, [v.true, v.string("big"), v.true])).toThrow("to_bytes() takes at most 2 positional arguments (3 given)");
});
it("preserves conversion and validation precedence", () => {
  const { call, v, keywords } = fixture();
  expect(() => call(v.true, [v.none, v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  expect(() => call(v.true, [v.integer(-1), v.none])).toThrow("to_bytes() argument 'byteorder' must be str, not None");
  expect(() => call(v.true, [v.integer(-1), v.string("bad")])).toThrow("byteorder must be either 'little' or 'big'");
  expect(() => call(v.true, [v.integer(-1)])).toThrow("length argument must be non-negative");
  keywords.items.set(v.string("signed"), v.notImplemented);
  expect(() => call(v.true, [v.integer(-1), v.string("bad")])).toThrow("NotImplemented should not be used in a boolean context");
});
it("bounds allocation and checks byte-writing work", () => {
  const { call, v } = fixture();
  expect(() => call(v.true, [v.integer(1n << 32n)])).toThrow(ExecutionLimitError);
  expect(() => call(v.true, [v.integer(2000)], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
});
