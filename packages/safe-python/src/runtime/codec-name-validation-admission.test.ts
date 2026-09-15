import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";
import {bindRuntimeCodecArguments} from "./runtime-codec-arguments.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import type {RuntimeValue} from "./runtime-values.js";

const operations = ["lookup", "lookupError", "registerError", "unregisterError", "encode", "decode"] as const;

it.each(operations)("admits the NUL-name exception before %s can return a catchable failure", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  let calls = 0, initializations = 0;
  const registry = new RuntimeCodecRegistry(values, meter, () => {initializations++;});
  const context: BuiltinInvocationContext = {
    call() {calls++; return values.none;},
    isCallable() {calls++; return true;}
  };
  const invoke = () => {
    switch (operation) {
      case "lookup": return registry.lookup("bad\0name", context);
      case "lookupError": return registry.lookupError("bad\0name");
      case "registerError": return registry.registerError("bad\0name", values.none, context);
      case "unregisterError": return registry.unregisterError("bad\0name");
      default: return registry.transform(operation, values.none, "bad\0name", undefined, context);
    }
  };
  // Validation can scan the name, but no exception storage remains available.
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect({calls, initializations}).toEqual({calls: 0, initializations: 0});
});

it.each(["lookup_error", "encode", "decode"] as const)("admits NUL-name exception storage at the %s argument boundary", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const functions = createRuntimeCodecRegistryFunctions(registry);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  const good = [values.string("strict")], bad = [values.string("bad\0xx")];
  const context: BuiltinInvocationContext = {call: () => {throw Error("unexpected callback");}};
  const invoke = (args: readonly RuntimeValue[]) => operation === "lookup_error"
    ? functions.get(operation)!.value.invoke(args, keywords, meter, context)
    : bindRuntimeCodecArguments(operation, args, keywords, values, meter, context);
  const before = meter.usage.allocatedBytes;
  invoke(good);
  const validationAllowance = meter.usage.allocatedBytes - before;
  // Allow the full successful same-length validation, including handler lookup
  // in the public registry binding, but no additional failure allocation.
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - validationAllowance);
  let failure: unknown;
  try {invoke(bad);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke(bad);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});
