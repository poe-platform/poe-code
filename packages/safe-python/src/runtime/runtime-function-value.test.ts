import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { createFunctionState } from "./function-state.js";
import { compileProgram } from "./program-compilation.js";
import { analyzeModule } from "../analysis.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { invokeFunction } from "./function-invocation.js";
import { CallStack } from "./call-stack.js";
import { createRuntimeExpressionContext } from "./runtime-expression-context.js";
import { createRuntimeStatementContext } from "./runtime-statement-context.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const program = compileProgram<RuntimeValue>(analyzeModule("def f(a, b=2):\n return a + b + offset\n"), { stripDocstring: false }, v, meter);
  const code = program.functions.values().next().value!;
  const globals = new Map<string, RuntimeValue>([["offset", v.integer(10)]]), builtins = new Map<string, RuntimeValue>();
  const state = createFunctionState(code, new Map([["b", v.integer(2)]]), { globals, builtins, none: v.none }, meter);
  return { meter, v, state, globals };
}

describe("concrete runtime function records", () => {
  it("wraps captured function state without executing its body or copying environments", () => {
    const { meter, v, state, globals } = fixture(), before = meter.usage, fn = v.function(state);
    expect(fn.kind).toBe("function"); expect(fn.value).toBe(state); expect(fn.value.globals).toBe(globals);
    expect(Object.isFrozen(fn)).toBe(true); expect(meter.usage.allocatedBytes - before.allocatedBytes).toBe(32);
  });
  it("preserves mutable function metadata behind an immutable value wrapper", () => {
    const { v, state } = fixture(), fn = v.function(state);
    state.name = v.string("renamed"); state.attributes.set("custom", v.true);
    expect(fn.value.name).toBe(state.name); expect(fn.value.attributes.get("custom")).toBe(v.true);
  });
  it("is truthy and compares by identity without traversing captured state", () => {
    const { meter, v, state } = fixture(), first = v.function(state), second = v.function(state);
    expect(runtimeTruth(first, meter)).toBe(true);
    expect(runtimeComparison("==", first, first, v, meter)).toBe(v.true);
    expect(runtimeComparison("==", first, second, v, meter)).toBe(v.false);
    expect(() => runtimeComparison("<", first, second, v, meter)).toThrow("'<' not supported between instances of 'function' and 'function'");
  });
  it("rejects iteration and declines arithmetic rather than inspecting host fields", () => {
    const { meter, v, state } = fixture(), fn = v.function(state);
    expect(() => runtimeIterate(fn, v, meter)).toThrow("'function' object is not iterable");
    expect(runtimeBinary("+", fn, v.integer(1), v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("*", v.integer(2), fn, v, meter)).toBe(v.notImplemented);
  });
  it("runs the captured compiled body through concrete expression and statement contexts", () => {
    const { meter, v, state, globals } = fixture(), fn = v.function(state), calls = new CallStack<object>(100, meter);
    const unused = (): never => { throw new Error("unused object hook"); };
    const invoke = () => invokeFunction(fn.value.code, {
      name: "f", positional: [v.integer(3)], keywords: new Map(), defaults: fn.value.defaults
    }, {
      ...fn.value, none: v.none, calls, tuple: items => v.tuple(items), dictionary: unused,
      body(frame) {
        const expressions = createRuntimeExpressionContext(v, {
          load: frame.load.bind(frame), store: frame.store.bind(frame), attribute: unused,
          beginCall: unused, beginSet: unused, beginDictionary: unused, warn: unused
        }, meter);
        return createRuntimeStatementContext(expressions, {
          deleteName: frame.delete.bind(frame), setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused
        }, v, meter);
      }
    }, meter);
    expect(invoke()).toEqual(v.integer(15)); expect(calls.depth).toBe(0);
    globals.set("offset", v.integer(20)); expect(invoke()).toEqual(v.integer(25)); expect(calls.depth).toBe(0);
  });
});
