import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["empty", "mutated"] as const)("admits %s search-path failures after interpreter callbacks", mode => {
  const budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(budget);
  const consumeRemaining = () => budget.checkpoint(0, 1000000 - budget.usage.allocatedBytes);
  let calls = 0;
  const registry = new RuntimeCodecRegistry(values, budget, mode === "empty" ? consumeRemaining : undefined);
  const first = values.builtinFunction({name: "first", invoke: () => values.none});
  const second = values.builtinFunction({name: "second", invoke: () => values.none});
  const context: BuiltinInvocationContext = {
    isCallable: () => true,
    call() {
      calls++;
      registry.unregister(second);
      consumeRemaining();
      return values.none;
    }
  };
  if (mode === "mutated") {
    registry.register(first, context);
    registry.register(second, context);
  }
  // The empty spelling requires no normalization storage, so rejection itself
  // must admit the exception after initialization has used the remaining bytes.
  const invoke = () => registry.lookup("", context);
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(calls).toBe(mode === "empty" ? 0 : 1);
});
