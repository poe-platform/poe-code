import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createIntrinsicObject, materializeFunctionProperties, registerIntrinsicFunction } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

function fixture() {
  const closure = createSandboxClosure({ guest: true, sandbox: true, name: "example", call: () => undefined });
  const properties = createIntrinsicObject({ payload: "x".repeat(1000) });
  materializeFunctionProperties(closure, properties);
  registerIntrinsicFunction(new Budget(), closure);
  return { closure, properties };
}

it("does not accept inherited descriptor caches or revisions as owned accounting state", () => {
  const { closure } = fixture();
  const previousDescriptors = Object.getOwnPropertyDescriptor(Object.prototype, "measuredDescriptors");
  const previousRevision = Object.getOwnPropertyDescriptor(Object.prototype, "measuredRevision");
  let measured;
  let failure;
  try {
    Object.defineProperty(Object.prototype, "measuredDescriptors", { configurable: true, value: [] });
    Object.defineProperty(Object.prototype, "measuredRevision", { configurable: true, value: 0 });
    measured = measureSandboxData([closure]);
    try { reconcileCompiledValues(new Budget({ dataSize: 500 }), [closure]); }
    catch (error) { failure = error; }
  } finally {
    if (previousDescriptors === undefined) Reflect.deleteProperty(Object.prototype, "measuredDescriptors");
    else Object.defineProperty(Object.prototype, "measuredDescriptors", previousDescriptors);
    if (previousRevision === undefined) Reflect.deleteProperty(Object.prototype, "measuredRevision");
    else Object.defineProperty(Object.prototype, "measuredRevision", previousRevision);
  }
  expect(measured).toBe(1009);
  expect(failure).toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
});

it.each(["measuredDescriptors", "measuredRevision"])(
  "does not expose private descriptor-cache state through an inherited %s setter",
  key => {
    const { closure, properties } = fixture();
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    const exposed: unknown[] = [];
    let first;
    let second;
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        set(value: unknown) { exposed.push(this, value); }
      });
      first = measureSandboxData([closure]);
      properties.payload = "y".repeat(2000);
      second = measureSandboxData([closure]);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, previous);
    }
    expect(first).toBe(1009);
    expect(second).toBe(2009);
    expect(exposed).toHaveLength(0);
  }
);
