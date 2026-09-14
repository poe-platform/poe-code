import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {RuntimeValues} from "./runtime-values.js";

it.each(["return", "throw"] as const)("observes buffer-name service cancellation on %s", outcome => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  let calls = 0;
  const ordinary = new Error("name service failed");
  const buffers = createRuntimeNativeBuffers(meter, {
    acquireSimple() {throw new Error("unexpected acquisition");},
    typeName() {
      calls++;
      controller.abort();
      if (outcome === "throw") throw ordinary;
      return "Exporter";
    }
  });
  let failure: unknown;
  try {buffers.typeName!(values.none);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "cancelled"});
  let retry: unknown;
  try {buffers.typeName!(values.none);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(calls).toBe(1);
});

it.each([false, true])("rejects cancelled buffer-name access before services (extension=%s)", extended => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  let calls = 0;
  const buffers = createRuntimeNativeBuffers(meter, extended ? {
    acquireSimple() {throw new Error("unexpected acquisition");},
    typeName() {calls++; return "Exporter";}
  } : undefined);
  controller.abort();
  expect(() => buffers.typeName!(values.none)).toThrow(expect.objectContaining({reason: "cancelled"}));
  expect(calls).toBe(0);
});

it.each([false, true])("preserves buffer-name failure identity (fatal=%s)", fatal => {
  let terminated = false;
  const meter = {checkpoint() {if (terminated) throw new Error("checkpoint after fatal failure");}};
  const values = new RuntimeValues(meter);
  const failure = fatal ? new ExecutionLimitError("allocation") : new Error("name service failed");
  const buffers = createRuntimeNativeBuffers(meter, {
    acquireSimple() {throw new Error("unexpected acquisition");},
    typeName() {terminated = fatal; throw failure;}
  });
  let actual: unknown;
  try {buffers.typeName!(values.none);} catch (error) {actual = error;}
  expect(actual).toBe(failure);
});
