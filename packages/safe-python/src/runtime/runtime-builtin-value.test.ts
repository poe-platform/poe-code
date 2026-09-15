import { describe, expect, it } from "vitest";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeBinary } from "./runtime-binary.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { v, meter };
}

describe("explicit builtin function capabilities", () => {
  it("wraps trusted capability state without invoking or copying it", () => {
    const { v } = fixture(); let called = false;
    const capability = { name: "native", invoke() { called = true; return v.none; } }, value = v.builtinFunction(capability);
    expect(value.kind).toBe("builtin_function_or_method"); expect(value.value).toBe(capability); expect(Object.isFrozen(value)).toBe(true); expect(called).toBe(false);
  });
  it("uses truth and identity comparison without invoking the capability", () => {
    const { v, meter } = fixture(), capability = { name: "native", invoke(): never { throw new Error("must not invoke"); } };
    const a = v.builtinFunction(capability), b = v.builtinFunction(capability);
    expect(runtimeTruth(a, meter)).toBe(true); expect(runtimeComparison("==", a, a, v, meter)).toBe(v.true); expect(runtimeComparison("==", a, b, v, meter)).toBe(v.false);
    expect(runtimeBinary("+", a, v.integer(1), v, meter)).toBe(v.notImplemented);
  });
  it("hashes with the execution identity policy and rejects iteration", () => {
    const { v, meter } = fixture(), value = v.builtinFunction({ name: "native", invoke: () => v.none });
    expect(runtimeHash(value, { none: v.none, identity: () => 101n, string: () => 0n, bytes: () => 0n }, meter)).toBe(101n);
    expect(() => runtimeIterate(value, v, meter)).toThrow("'builtin_function_or_method' object is not iterable");
  });
});
