import {expect, it, vi} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";

it("bounds retained buffer adapters before their first codec acquisition", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1024});
  const acquireSimple = vi.fn(() => undefined);
  const adapters: ReturnType<typeof createRuntimeNativeBuffers>[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      adapters.push(createRuntimeNativeBuffers(meter, {acquireSimple}));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(adapters.length).toBeGreaterThan(0);
  expect(adapters.length).toBeLessThan(100);
  let retry: unknown;
  try {createRuntimeNativeBuffers(meter, {acquireSimple});} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(acquireSimple).not.toHaveBeenCalled();
});

it("does not publish a buffer adapter after cancellation", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const acquireSimple = vi.fn(() => undefined);
  controller.abort();
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let caught: unknown;
    try {createRuntimeNativeBuffers(meter, {acquireSimple});} catch (error) {caught = error;}
    expect(caught).toBeInstanceOf(ExecutionLimitError);
    expect(caught).toMatchObject({reason: "cancelled"});
    if (failure === undefined) failure = caught;
    else expect(caught).toBe(failure);
  }
  expect(acquireSimple).not.toHaveBeenCalled();
});
