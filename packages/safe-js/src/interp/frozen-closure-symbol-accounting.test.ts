import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("keeps owned frozen closure symbols charged when later host enumeration hooks hide them", () => {
  const key = Symbol("payload");
  const child = { text: "x".repeat(1000) };
  const closure = createSandboxClosure({
    call: () => undefined,
    properties: (value) => {
      Object.defineProperty(value, key, { value: child });
      return {};
    }
  });
  const before = measureSandboxData([closure]);
  const original = Object.getOwnPropertySymbols;
  let after = -1;
  Object.getOwnPropertySymbols = (value) => (value === closure ? [] : original(value));
  try {
    after = measureSandboxData([closure]);
  } finally {
    Object.getOwnPropertySymbols = original;
  }
  expect(before).toBeGreaterThan(1000);
  expect(after).toBe(before);
  const budget = new Budget({ dataSize: 500 });
  const release = budget.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
  } finally {
    release();
  }
});

it("keeps foreign frozen symbol enumeration on the fresh path", () => {
  const key = Symbol("payload");
  const object = Object.freeze({ [key]: "abc" });
  const before = measureSandboxData([object]);
  const original = Object.getOwnPropertySymbols;
  let calls = 0;
  Object.getOwnPropertySymbols = (value) => {
    if (value === object) calls++;
    return original(value);
  };
  let first = -1,
    second = -1;
  try {
    first = measureSandboxData([object]);
    second = measureSandboxData([object]);
  } finally {
    Object.getOwnPropertySymbols = original;
  }
  expect(calls).toBe(2);
  expect(first).toBe(before);
  expect(second).toBe(before);
});

it("keeps descendants below immutable closure symbol keys live", () => {
  const key = Symbol("payload");
  const child = { text: "old" };
  const closure = createSandboxClosure({
    call: () => undefined,
    properties: (value) => {
      Object.defineProperty(value, key, { value: child });
      return {};
    }
  });
  const before = measureSandboxData([closure]);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([closure])).toBe(before + 1000);
});

it("observes guest function property symbols added after closure construction", () => {
  const closure = createSandboxClosure({ call: () => undefined, properties: {} });
  const before = measureSandboxData([closure]);
  const key = Symbol("payload");
  Object.defineProperty(closure.properties!, key, { value: "x".repeat(1000), configurable: true });
  expect(measureSandboxData([closure])).toBe(before + 1 + 1 + "payload".length + 1000);
  Reflect.deleteProperty(closure.properties!, key);
  expect(measureSandboxData([closure])).toBe(before);
});

it("pins SDK closure finalization before recording immutable symbol keys", () => {
  const original = Object.freeze;
  let closure: ReturnType<typeof createSandboxClosure> | undefined;
  Object.freeze = ((value: unknown) => value) as typeof Object.freeze;
  try {
    closure = createSandboxClosure({ call: () => undefined });
  } finally {
    Object.freeze = original;
  }
  expect(Object.isFrozen(closure)).toBe(true);
  expect(Reflect.defineProperty(closure!, Symbol("late"), { value: "untracked" })).toBe(false);
});

it("does not pass immutable SDK key lists through later native array iterator hooks", () => {
  const key = Symbol("payload");
  const closure = createSandboxClosure({
    call: () => undefined,
    properties: (value) => {
      Object.defineProperty(value, key, { value: "x".repeat(1000) });
      return {};
    }
  });
  const before = measureSandboxData([closure]);
  const original = Array.prototype[Symbol.iterator];
  let after = -1;
  Array.prototype[Symbol.iterator] = function () {
    return original.call(Object.isFrozen(this) && this.includes(key) ? [] : this);
  };
  try {
    after = measureSandboxData([closure]);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  expect(before).toBeGreaterThan(1000);
  expect(after).toBe(before);
});
