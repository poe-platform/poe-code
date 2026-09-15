import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["encode", "decode"] as const)("admits %s result diagnostics after callback allocation", operation => {
  for (const shape of ["none", "list", "empty", "short", "long"]) {
    const budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(budget), registry = new RuntimeCodecRegistry(values, budget);
    const result = shape === "none" ? values.none : shape === "list" ? values.list([values.none, values.none])
      : values.tuple(Array.from({length: shape === "empty" ? 0 : shape === "short" ? 1 : 3}, () => values.none));
    const callback = values.builtinFunction({name: "callback", invoke: () => result});
    const codec = values.tuple([callback, callback, values.none, values.none]);
    let calls = 0;
    const context: BuiltinInvocationContext = {
      isCallable: () => true,
      call(callee) {
        if (callee !== callback) return codec;
        calls++;
        budget.checkpoint(0, 1000000 - budget.usage.allocatedBytes);
        return result;
      }
    };
    registry.register(values.builtinFunction({name: "search", invoke: () => codec}), context);
    let failure: unknown;
    try {registry.transform(operation, values.none, "result-contract", undefined, context);} catch (error) {failure = error;}
    expect(failure, shape).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {registry.transform(operation, values.none, "result-contract", undefined, context);} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(1);
  }
});

it.each(["encode", "decode"] as const)("preserves %s result errors and does not cache malformed results", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const callback = values.builtinFunction({name: "callback", invoke: () => values.none});
  const codec = values.tuple([callback, callback, values.none, values.none]);
  const replacement = values.string("result"), valid = values.tuple([replacement, values.none]);
  let calls = 0;
  const context: BuiltinInvocationContext = {
    isCallable: () => true,
    call(callee) {if (callee !== callback) return codec; return ++calls === 1 ? values.none : valid;}
  };
  registry.register(values.builtinFunction({name: "search", invoke: () => codec}), context);
  expect(() => registry.transform(operation, values.none, "result-contract", undefined, context)).toThrow(
    new PythonRuntimeError("TypeError", operation === "encode" ? "encoder must return a tuple (object, integer)" : "decoder must return a tuple (object,integer)"));
  expect(registry.transform(operation, values.none, "result-contract", undefined, context)).toBe(replacement);
  expect(calls).toBe(2);
});

it.each(["encode", "decode"] as const)("keeps %s callback cancellation terminal on return and failure", operation => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
    const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
    const callback = values.builtinFunction({name: "callback", invoke: () => values.none});
    const codec = values.tuple([callback, callback, values.none, values.none]);
    const guestFailure = new PythonRuntimeError("ValueError", "guest callback failed");
    let calls = 0;
    const context: BuiltinInvocationContext = {
      isCallable: () => true,
      call(callee) {
        if (callee !== callback) return codec;
        calls++;
        controller.abort();
        if (throws) throw guestFailure;
        return values.none;
      }
    };
    registry.register(values.builtinFunction({name: "search", invoke: () => codec}), context);
    expect(() => registry.transform(operation, values.none, "result-contract", undefined, context)).toThrow(expect.objectContaining({reason: "cancelled"}));
    expect(() => registry.transform(operation, values.none, "result-contract", undefined, context)).toThrow(ExecutionLimitError);
    expect(calls).toBe(1);
  }
});
