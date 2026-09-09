import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (value: number, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(v.float(value), "hex", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    const result = method.value.invoke(args, keywords, meter);
    if (result.kind !== "str") throw new Error("expected str");
    return String.fromCodePoint(...result.value);
  };
  return { v, keywords, call };
}

it("formats normal binary64 values with thirteen fractional hexadecimal digits", () => {
  const { call } = fixture();
  expect(call(1)).toBe("0x1.0000000000000p+0");
  expect(call(.1)).toBe("0x1.999999999999ap-4");
  expect(call(-1.5)).toBe("-0x1.8000000000000p+0");
  expect(call(Number.MAX_VALUE)).toBe("0x1.fffffffffffffp+1023");
});

it("preserves signed zero and uses the fixed subnormal exponent", () => {
  const { call } = fixture();
  expect(call(0)).toBe("0x0.0p+0"); expect(call(-0)).toBe("-0x0.0p+0");
  expect(call(Number.MIN_VALUE)).toBe("0x0.0000000000001p-1022");
  expect(call(-Number.MIN_VALUE)).toBe("-0x0.0000000000001p-1022");
  expect(call(2 ** -1022)).toBe("0x1.0000000000000p-1022");
});

it("formats non-finite values with Python spellings", () => {
  const { call } = fixture();
  expect(call(NaN)).toBe("nan"); expect(call(-NaN)).toBe("nan");
  expect(call(Infinity)).toBe("inf"); expect(call(-Infinity)).toBe("-inf");
});

it("rejects all positional and keyword arguments", () => {
  const { call, v, keywords } = fixture();
  expect(() => call(NaN, [v.none])).toThrow("float.hex() takes no arguments (1 given)");
  keywords.items.set(v.string("bad"), v.none);
  expect(() => call(0)).toThrow("float.hex() takes no keyword arguments");
});
