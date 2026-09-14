import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each([0, 1024])("bounds retained lazy codec recovery adapters with %i bytes", limit => {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  let initialized = 0, callbacks = 0;
  const registry = new RuntimeCodecRegistry(values, meter, () => {initialized++;});
  const context: BuiltinInvocationContext = {
    call() {callbacks++; throw new Error("construction must not invoke a handler");}
  };
  budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: limit});
  const retained: RuntimeCodecRecovery[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      retained.push(new RuntimeCodecRecovery(registry, "not-registered", values.none, context));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  if (limit === 0) expect(retained).toHaveLength(0);
  else expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(100);
  for (const adapter of retained) {
    expect(adapter.registry).toBe(registry);
    expect(adapter.source).toBe(values.none);
    expect(adapter.context).toBe(context);
  }
  let retry: unknown;
  try {new RuntimeCodecRecovery(registry, "not-registered", values.none, context);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(initialized).toBe(0);
  expect(callbacks).toBe(0);
});

it("observes cancellation before retaining codec recovery state", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const context: BuiltinInvocationContext = {call() {throw new Error("unexpected callback");}};
  controller.abort();
  expect(() => new RuntimeCodecRecovery(registry, "strict", values.none, context)).toThrow(expect.objectContaining({reason: "cancelled"}));
});
