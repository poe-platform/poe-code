import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["search", "error"] as const)("admits the %s registration rejection before creating a guest exception", kind => {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  let initializations = 0, checks = 0;
  const registry = new RuntimeCodecRegistry(values, meter, () => {initializations++;});
  const context: BuiltinInvocationContext = {
    isStopIteration: () => false,
    call: () => {throw new Error("registration must not invoke the rejected object");},
    isCallable() {
      checks++;
      budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0});
      return false;
    }
  };
  const register = () => kind === "search"
    ? registry.register(values.none, context)
    : registry.registerError("custom", values.none, context);
  let failure: unknown;
  try {register();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {register();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(checks).toBe(1);
  expect(initializations).toBe(0);
});
