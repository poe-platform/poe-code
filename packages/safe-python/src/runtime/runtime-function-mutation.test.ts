import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { createFunctionState } from "./function-state.js";
import { runtimeMutateFunctionAttribute } from "./runtime-function-mutation.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal }), v = new RuntimeValues(meter), program = compileProgram(analyzeModule("def f(): pass\n"), { stripDocstring: false }, v, meter);
  const fn = v.function(createFunctionState(program.functions.values().next().value!, new Map(), { globals: new Map(), builtins: new Map(), none: v.none }, meter));
  return { meter, v, fn };
}

it("preserves the extension boundary for unfinished intrinsic function fields", () => {
  const { meter, v, fn } = fixture(); fn.value.attributes.set("existing", v.true);
  for (const name of ["__class__", "__code__", "__globals__", "__closure__", "__builtins__", "__annotate__", "__type_params__"]) {
    expect(runtimeMutateFunctionAttribute(fn, name, { kind: "set", value: v.false }, v, meter)).toBe(false);
    expect(runtimeMutateFunctionAttribute(fn, name, { kind: "delete" }, v, meter)).toBe(false);
  }
  expect([...fn.value.attributes]).toEqual([["existing", v.true]]);
});

it("retains original name identities after invalid metadata changes", () => {
  const { meter, v, fn } = fixture(), original = fn.value.name, qualified = fn.value.qualifiedName;
  for (const name of ["__name__", "__qualname__"]) {
    expect(() => runtimeMutateFunctionAttribute(fn, name, { kind: "set", value: v.none }, v, meter)).toThrow(`${name} must be set to a string object`);
    expect(() => runtimeMutateFunctionAttribute(fn, name, { kind: "delete" }, v, meter)).toThrow(`${name} must be set to a string object`);
  }
  expect(fn.value.name).toBe(original); expect(fn.value.qualifiedName).toBe(qualified);
});

it("supports arbitrary ordinary attribute names and rejects missing deletion", () => {
  const { meter, v, fn } = fixture();
  for (const name of ["custom", "__isabstractmethod__", "__get__", "", "\u0000"]) {
    expect(runtimeMutateFunctionAttribute(fn, name, { kind: "set", value: v.none }, v, meter)).toBe(true);
    expect(fn.value.attributes.get(name)).toBe(v.none);
    expect(runtimeMutateFunctionAttribute(fn, name, { kind: "delete" }, v, meter)).toBe(true);
    expect(() => runtimeMutateFunctionAttribute(fn, name, { kind: "delete" }, v, meter)).toThrow(`'function' object has no attribute '${name}'`);
  }
});

it("checks cancellation before changing function metadata or ordinary storage", () => {
  const controller = new AbortController(), { meter, v, fn } = fixture(controller.signal), original = fn.value.name;
  controller.abort();
  expect(() => runtimeMutateFunctionAttribute(fn, "__name__", { kind: "set", value: v.none }, v, meter)).toThrow(ExecutionLimitError);
  expect(() => runtimeMutateFunctionAttribute(fn, "custom", { kind: "set", value: v.true }, v, meter)).toThrow(ExecutionLimitError);
  expect(fn.value.name).toBe(original); expect(fn.value.attributes.size).toBe(0);
});
