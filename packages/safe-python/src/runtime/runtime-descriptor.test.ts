import { describe, expect, it } from "vitest";
import { getRuntimeFunctionDescriptor, resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState } from "./function-state.js";
import { analyzeModule } from "../analysis.js";
import { readInstanceAttribute, writeInstanceAttribute } from "./instance-attributes.js";
import { readClassAttribute } from "./class-attributes.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule("def f(self):\n return self\n"), { stripDocstring: false }, v, meter);
  const state = createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter);
  return { v, meter, fn: v.function(state) };
}

describe("concrete function descriptors", () => {
  it("returns the original function for class access and binds instance access", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]);
    expect(getRuntimeFunctionDescriptor(fn, null, v.integer(1), v, meter)).toBe(fn);
    expect(getRuntimeFunctionDescriptor(fn, v.none, v.integer(1), v, meter)).toBe(fn);
    const method = getRuntimeFunctionDescriptor(fn, instance, v.none, v, meter);
    if (method.kind !== "method") throw new Error("method expected");
    expect(method.value.function).toBe(fn); expect(method.value.instance).toBe(instance);
    expect(() => getRuntimeFunctionDescriptor(fn, null, v.none, v, meter)).toThrow("__get__(None, None) is invalid");
  });
  it("keeps functions non-data descriptors and allows instance shadowing", () => {
    const { v, meter, fn } = fixture(), instance = v.list([]), owner = v.integer(1);
    const attribute = resolveRuntimeClassAttribute(fn, { slots() { throw new Error("must use exact function slot"); } }, v, meter);
    expect(readInstanceAttribute(instance, owner, attribute, () => ({ value: v.false }), meter)?.value).toBe(v.false);
    const method = readInstanceAttribute(instance, owner, attribute, () => undefined, meter)?.value;
    expect(method?.kind).toBe("method");
    let stored: RuntimeValue | undefined;
    writeInstanceAttribute(instance, attribute, v.true, value => { stored = value; }, meter); expect(stored).toBe(v.true);
  });
  it("ignores a function instance's __get__ attribute when resolving descriptor slots", () => {
    const { v, meter, fn } = fixture(); fn.value.attributes.set("__get__", v.false);
    const attribute = resolveRuntimeClassAttribute(fn, { slots: () => undefined }, v, meter);
    expect(readClassAttribute(v.integer(1), v.integer(2), undefined, () => attribute, meter)?.value).toBe(fn);
  });
  it("retains other type-resolved descriptor slots and their method owner", () => {
    const { v, meter } = fixture(), instance = v.list([]);
    const slots = { value: v.true, get() { return this.value; }, set() {} };
    const attribute = resolveRuntimeClassAttribute(v.false, { slots: () => slots }, v, meter);
    expect(attribute.slots).toBe(slots);
    expect(readInstanceAttribute(instance, v.integer(1), attribute, () => { throw new Error("data descriptor wins"); }, meter)?.value).toBe(v.true);
  });
});
