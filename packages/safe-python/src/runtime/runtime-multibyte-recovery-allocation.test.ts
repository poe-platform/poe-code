import {expect, it, vi} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeMultibyteRecovery} from "./runtime-multibyte-recovery.js";
import {RuntimeValues} from "./runtime-values.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonDecodeError} from "./decode-error.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import type {BuiltinInvocationContext, RuntimeValue} from "./runtime-values.js";

it.each(["encode", "decode"] as const)("admits the %s recovery record after a guest callback returns", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const types = new RuntimeTypeRegistry(values, {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b}, meter);
  const exceptions = new RuntimeExceptionExecution(types, values, meter);
  const source = values.string("\ud800");
  const fault = operation === "encode"
    ? new PythonEncodeError("hz", source.value, 0, 1, "illegal multibyte sequence")
    : new PythonDecodeError("hz", Uint8Array.of(255), 0, 1, "illegal multibyte sequence", meter);
  const prepared = exceptions.prepare(fault, {unraised: true});
  const result = values.tuple([values.string(""), values.integer(-1)]);
  const empty = new Uint8Array();
  let calls = 0;
  const context: BuiltinInvocationContext = {
    isCallable: () => true,
    prepareException: () => prepared,
    call() {
      calls++;
      meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
      return result;
    }
  };
  registry.registerError("custom", values.cell({}), context);
  const recovery = new RuntimeMultibyteRecovery(registry, source, context);
  const run = () => fault instanceof PythonEncodeError
    ? recovery.recover(fault, "custom", () => empty)
    : recovery.recover(fault, "custom");
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(calls).toBe(1);
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(calls).toBe(1);
});

it("admits a replace recovery record after the replacement encoder returns", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const source = values.string("\ud800"), replacement = Uint8Array.of(63);
  const fault = new PythonEncodeError("hz", source.value, 0, 1, "illegal multibyte sequence");
  const call = vi.fn(() => values.none);
  const recovery = new RuntimeMultibyteRecovery(registry, source, {call});
  let encoders = 0;
  const run = () => recovery.recover(fault, "replace", text => {
    expect([...text]).toEqual([63]);
    encoders++;
    meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
    return replacement;
  });
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(encoders).toBe(1);
  expect(call).not.toHaveBeenCalled();
});

it("bounds retained ignore results from one multibyte encoding operation", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const source = values.string("\ud800");
  const fault = new PythonEncodeError("hz", source.value, 0, 1, "illegal multibyte sequence");
  const call = vi.fn(() => values.none);
  const recovery = new RuntimeMultibyteRecovery(registry, source, {call});
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 1024);
  const retained: ReturnType<RuntimeMultibyteRecovery["recover"]>[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) retained.push(recovery.recover(fault, "ignore", () => {
      throw Error("ignore must not encode a replacement");
    }));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(100);
  for (const result of retained) {
    expect(result.replacement).toEqual(new Uint8Array());
    expect(result.position).toBe(1n);
  }
  expect(new Set(retained).size).toBe(retained.length);
  expect(new Set(retained.map(result => result.replacement)).size).toBe(retained.length);
  let retry: unknown;
  try {recovery.recover(fault, "ignore", () => new Uint8Array());} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(call).not.toHaveBeenCalled();
});

it("bounds retained multibyte recovery operations before their first codec fault", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 1024);
  const call = vi.fn(() => values.none), operations: RuntimeMultibyteRecovery[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      operations.push(new RuntimeMultibyteRecovery(registry, values.none, {call}));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.length).toBeLessThan(100);
  let retry: unknown;
  try {new RuntimeMultibyteRecovery(registry, values.none, {call});} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(call).not.toHaveBeenCalled();
});

it("does not create multibyte recovery state after cancellation", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const call = vi.fn(() => values.none);
  controller.abort();
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let caught: unknown;
    try {new RuntimeMultibyteRecovery(registry, values.none, {call});} catch (error) {caught = error;}
    expect(caught).toBeInstanceOf(ExecutionLimitError);
    expect(caught).toMatchObject({reason: "cancelled"});
    if (failure === undefined) failure = caught;
    else expect(caught).toBe(failure);
  }
  expect(call).not.toHaveBeenCalled();
});
