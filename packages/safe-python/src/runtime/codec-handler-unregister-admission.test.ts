import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues} from "./runtime-values.js";
import {standardCodecErrorDocumentation} from "./runtime-codec-errors.js";

it.each(Object.keys(standardCodecErrorDocumentation))("admits protected-handler removal rejection for %s", name => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 96 - name.length * 2);
  let failure: unknown;
  try {registry.unregisterError(name);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {registry.unregisterError(name);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([false, true])("does not charge rejection storage for an unprotected name (registered=%s)", registered => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const name = "removable";
  const before = meter.usage.allocatedBytes;
  expect(registry.unregisterError(name)).toBe(false);
  const removalBytes = meter.usage.allocatedBytes - before;
  if (registered) registry.registerError(name, registry.lookupError("strict"), {call: () => values.none, isCallable: () => true});
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - removalBytes);
  expect(registry.unregisterError(name)).toBe(registered);
});

it.each(Object.keys(standardCodecErrorDocumentation))("preserves the replacement handler when protected removal fails for %s", name => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const replacement = values.builtinFunction({name: "replacement", invoke: () => values.none});
  registry.registerError(name, replacement, {call: () => values.none, isCallable: () => true});
  expect(() => registry.unregisterError(name)).toThrow(`cannot un-register built-in error handler '${name}'`);
  expect(registry.lookupError(name)).toBe(replacement);
});
