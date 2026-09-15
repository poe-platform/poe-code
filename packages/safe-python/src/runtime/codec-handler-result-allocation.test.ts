import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["encode", "decode"] as const)("bounds retained validated %s recovery records", operation => {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const registry = new RuntimeCodecRegistry(values, meter);
  const replacement = values.string("R");
  const pair = values.tuple([replacement, values.integer(-1)]);
  const handler = values.builtinFunction({name: "recover", invoke: () => pair});
  let calls = 0;
  const context: BuiltinInvocationContext = {
    call() {calls++; return pair;}, isStopIteration: () => false,
  };
  budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const results: ReturnType<RuntimeCodecRegistry["handleError"]>[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      results.push(registry.handleError(handler, values.none, operation, 2, context));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(results.length).toBeGreaterThan(0);
  expect(results.length).toBeLessThan(100);
  for (const result of results) {
    expect(result.replacement).toBe(replacement);
    expect(result.position).toBe(1);
  }
  const callsBeforeRetry = calls;
  let retry: unknown;
  try {registry.handleError(handler, values.none, operation, 2, context);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(calls).toBe(callsBeforeRetry);
});
