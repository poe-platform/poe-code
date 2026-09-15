import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, name: "bit_length" | "bit_count", args: RuntimeValue[] = [], budget = meter) => {
    const method = runtimeNativeAttribute(receiver, name, v, budget);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, budget);
  };
  return { v, keywords, call };
}

it("reports zero and boolean bit metrics as integers", () => {
  const { call, v } = fixture();
  for (const name of ["bit_length", "bit_count"] as const) {
    for (const receiver of [v.false, v.integer(0n)]) expect(call(receiver, name)).toEqual(v.integer(0n));
    for (const receiver of [v.true, v.integer(1n)]) expect(call(receiver, name)).toEqual(v.integer(1n));
  }
});

it("uses absolute magnitudes for negatives across nibble boundaries", () => {
  const { call, v } = fixture();
  for (let n = 1; n < 1024; n++) {
    const binary = n.toString(2), count = [...binary].filter(c => c === "1").length;
    for (const sign of [1n, -1n]) {
      const receiver = v.integer(BigInt(n) * sign);
      expect(call(receiver, "bit_length")).toEqual(v.integer(binary.length));
      expect(call(receiver, "bit_count")).toEqual(v.integer(count));
    }
  }
});

it("counts sparse and dense arbitrary-precision magnitudes", () => {
  const { call, v } = fixture(), power = 1n << 10000n;
  for (const sign of [1n, -1n]) {
    expect(call(v.integer(sign * power), "bit_length")).toEqual(v.integer(10001n));
    expect(call(v.integer(sign * power), "bit_count")).toEqual(v.integer(1n));
    expect(call(v.integer(sign * (power - 1n)), "bit_length")).toEqual(v.integer(10000n));
    expect(call(v.integer(sign * (power - 1n)), "bit_count")).toEqual(v.integer(10000n));
  }
});

it("rejects arguments using int diagnostics even on bool receivers", () => {
  const { call, v, keywords } = fixture();
  for (const name of ["bit_length", "bit_count"] as const) expect(() => call(v.true, name, [v.none])).toThrow(`int.${name}() takes no arguments (1 given)`);
  keywords.items.set(v.string("bad"), v.none);
  for (const name of ["bit_length", "bit_count"] as const) expect(() => call(v.false, name)).toThrow(`int.${name}() takes no keyword arguments`);
});

it("meters the digit scan and accounts for temporary hexadecimal storage", () => {
  const { call, v } = fixture(), receiver = v.integer((1n << 10000n) - 1n);
  expect(() => call(receiver, "bit_count", [], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
  expect(() => call(receiver, "bit_length", [], new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
