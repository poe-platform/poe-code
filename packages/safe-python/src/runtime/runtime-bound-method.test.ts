import { describe, expect, it } from "vitest";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { createFunctionState } from "./function-state.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeBinary } from "./runtime-binary.js";
import { OrderedKeyMap } from "./ordered-key-map.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const program = compileProgram(analyzeModule("def f(self):\n return self\n"), { stripDocstring: false }, v, meter);
  const state = createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter);
  return { v, meter, fn: v.function(state) };
}

describe("concrete bound Python methods", () => {
  it("merges equivalent method dictionary keys while retaining the first wrapper", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]), first = v.boundMethod(fn, instance);
    const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
    const map = new OrderedKeyMap<typeof first, boolean>({ hash: key => runtimeHash(key, hash, meter), equal: (a, b) => runtimeComparison("==", a, b, v, meter).value }, meter);
    map.set(first, false); map.set(v.boundMethod(fn, instance), true); map.set(v.boundMethod(fn, v.list([])), false);
    expect(map.size).toBe(2); expect(map.snapshot()[0]).toEqual([first, true]); expect(map.snapshot()[0][0]).toBe(first);
  });
  it("retains function and instance references without executing the body", () => {
    const { v, fn } = fixture(), instance = v.list([]), method = v.boundMethod(fn, instance);
    expect(method.kind).toBe("method"); expect(method.value.function).toBe(fn); expect(method.value.instance).toBe(instance);
    expect(Object.isFrozen(method)).toBe(true); expect(Object.isFrozen(method.value)).toBe(true);
    expect(() => v.boundMethod(fn, v.none)).toThrow("instance must not be None");
  });
  it("compares function and instance identities instead of instance equality", () => {
    const { v, meter, fn } = fixture(), a = v.list([]), b = v.list([]), first = v.boundMethod(fn, a);
    expect(runtimeComparison("==", first, v.boundMethod(fn, a), v, meter)).toBe(v.true);
    expect(runtimeComparison("!=", first, v.boundMethod(fn, b), v, meter)).toBe(v.true);
    expect(runtimeComparison("==", first, v.boundMethod(v.function(fn.value), a), v, meter)).toBe(v.false);
  });
  it("hashes unhashable instances by identity, xor the function hash", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]), method = v.boundMethod(fn, instance);
    const context = { none: v.none, identity: (value: unknown) => value === fn ? 101n : value === instance ? 33n : 99n, string: () => 0n, bytes: () => 0n };
    expect(runtimeHash(method, context, meter)).toBe(68n);
    expect(runtimeHash(v.boundMethod(fn, instance), context, meter)).toBe(68n);
    expect(runtimeHash(method, { ...context, identity: value => value === fn ? 3n : -4n }, meter)).toBe(-2n);
  });
  it("is truthy, rejects iteration and declines numeric operations", () => {
    const { v, meter, fn } = fixture(), method = v.boundMethod(fn, v.list([]));
    expect(runtimeTruth(method, meter)).toBe(true);
    expect(() => runtimeIterate(method, v, meter)).toThrow("'method' object is not iterable");
    expect(runtimeBinary("+", method, v.integer(1), v, meter)).toBe(v.notImplemented);
  });
});
