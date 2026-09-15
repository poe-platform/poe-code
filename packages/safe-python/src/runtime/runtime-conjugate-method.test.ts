import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(receiver, "conjugate", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, keywords, call };
}

it("retains exact int and float receivers including non-finite values", () => {
  const { call, v } = fixture();
  for (const receiver of [v.integer(1n << 10000n), v.integer(-1n), v.float(-0), v.float(.5), v.float(NaN), v.float(Infinity)]) expect(call(receiver)).toBe(receiver);
});

it("returns ordinary ints for boolean receivers", () => {
  const { call, v } = fixture();
  expect(call(v.true)).toEqual(v.integer(1)); expect(call(v.false)).toEqual(v.integer(0));
});

it("preserves the real component and negates the imaginary component in a fresh complex", () => {
  const { call, v } = fixture();
  for (const real of [0, -0, 1, -1, Infinity, -Infinity, NaN]) for (const imaginary of [0, -0, 2, -2, Infinity, -Infinity, NaN]) {
    const receiver = v.complex(real, imaginary), result = call(receiver);
    expect(result.kind).toBe("complex"); expect(result).not.toBe(receiver);
    if (result.kind !== "complex") throw new Error("expected complex");
    expect(Object.is(result.real, real)).toBe(true); expect(Object.is(result.imaginary, -imaginary)).toBe(true);
  }
});

it("validates arguments before returning or constructing values", () => {
  const { call, v, keywords } = fixture();
  for (const receiver of [v.true, v.integer(1), v.float(1), v.complex(1, 2)]) expect(() => call(receiver, [v.none])).toThrow(`${receiver.kind === "bool" ? "int" : receiver.kind}.conjugate() takes no arguments (1 given)`);
  keywords.items.set(v.string("bad"), v.none);
  for (const receiver of [v.false, v.float(1), v.complex(1, 2)]) expect(() => call(receiver)).toThrow(`${receiver.kind === "bool" ? "int" : receiver.kind}.conjugate() takes no keyword arguments`);
});
