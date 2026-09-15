import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(meter: ExecutionMeter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 })) {
  const v = new RuntimeValues(meter), receiver = v.integer(0);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[], target: RuntimeValue = receiver) => {
    const method = runtimeNativeAttribute(target, "from_bytes", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, keywords, call };
}
it("decodes bytes in both orders with optional signed interpretation", () => {
  const { call, v, keywords } = fixture(), source = v.bytes(Uint8Array.of(255, 0));
  expect(call([source])).toEqual(v.integer(65280));
  expect(call([source, v.string("little")])).toEqual(v.integer(255));
  keywords.items.set(v.string("signed"), v.true);
  expect(call([source])).toEqual(v.integer(-256));
});
it("consumes integer and bool iterables and constructs bool for bool class receivers", () => {
  const { call, v } = fixture();
  for (const source of [v.list([v.true, v.false]), v.tuple([v.integer(1), v.integer(0)])]) expect(call([source])).toEqual(v.integer(256));
  expect(call([v.list([])], v.true)).toBe(v.false);
  expect(call([v.bytes(Uint8Array.of(2))], v.false)).toBe(v.true);
});
it("validates each element immediately without consuming or closing the remainder", () => {
  const { call, v } = fixture(); let calls = 0, closed = false;
  const source = v.iterator({ next() { calls++; if (calls === 1) return { done: false, value: v.integer(256) }; throw new Error("later failure"); }, return() { closed = true; return { done: true, value: v.none }; } });
  expect(() => call([source])).toThrow("bytes must be in range(0, 256)"); expect(calls).toBe(1); expect(closed).toBe(false);
  expect(() => call([v.list([v.float(1)])])).toThrow("'float' object cannot be interpreted as an integer");
});
it("preserves iterator errors and post-next cancellation", () => {
  const f = fixture(), failure = new Error("iterator failed");
  expect(() => f.call([f.v.iterator({ next() { throw failure; } })])).toThrow(failure);
  let cancelled = false;
  const { call, v } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
  const source = v.iterator({ next() { cancelled = true; return { done: false, value: v.none }; } });
  expect(() => call([source])).toThrow(ExecutionLimitError);
});
it("distinguishes non-convertible inputs and validates byte order before iteration", () => {
  const { call, v, keywords } = fixture();
  for (const [value, type] of [[v.none, "NoneType"], [v.integer(3), "int"], [v.string("00"), "str"]] as const) expect(() => call([value])).toThrow(`cannot convert '${type}' object to bytes`);
  expect(() => call([v.none, v.none])).toThrow("from_bytes() argument 'byteorder' must be str, not None");
  expect(() => call([v.none, v.string("bad")])).toThrow("byteorder must be either 'little' or 'big'");
  keywords.items.set(v.string("signed"), v.notImplemented);
  expect(() => call([v.none, v.string("bad")])).toThrow("NotImplemented should not be used in a boolean context");
});
it("accepts named bytes and rejects missing, duplicate and excess arguments", () => {
  const { call, v, keywords } = fixture();
  expect(() => call([])).toThrow("from_bytes() missing required argument 'bytes' (pos 1)");
  keywords.items.set(v.string("bytes"), v.bytes(Uint8Array.of(1)));
  expect(call([])).toEqual(v.integer(1));
  expect(() => call([v.none])).toThrow("argument for from_bytes() given by name ('bytes') and position (1)");
  keywords.items.clear();
  expect(() => call([v.none, v.none, v.none])).toThrow("from_bytes() takes at most 2 positional arguments (3 given)");
});
it("copies validated number arrays into immutable storage without wrapping bad values", () => {
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 }), input = [0, 255];
  const result = ImmutableBytes.copyOf(input, meter); input[0] = 1;
  expect([...result]).toEqual([0, 255]);
  for (const byte of [-1, 256, .5, NaN]) expect(() => ImmutableBytes.copyOf([byte], meter)).toThrow("byte value must be an integer in range 0..255");
});
