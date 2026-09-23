import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("keeps conservative record snapshots private from later native Array push hooks", () => {
  const payload = { text: "x".repeat(1000) };
  const owner = { payload };
  const expected = measureSandboxData([owner]);
  const push = Array.prototype.push;
  let exposed = 0;
  let actual = -1;
  let rejected = false;
  Array.prototype.push = function (...items: unknown[]) {
    if (items.some((item) => item === payload)) {
      exposed++;
      return this.length;
    }
    return Reflect.apply(push, this, items);
  };
  try {
    actual = measureSandboxData([owner]);
    try {
      reconcileCompiledValues(new Budget({ dataSize: 500 }), [owner]);
    } catch (error) {
      rejected = (error as { budget?: string }).budget === "dataSize";
    }
  } finally {
    Array.prototype.push = push;
  }
  expect(actual).toBe(expected);
  expect(rejected).toBe(true);
  expect(exposed).toBe(0);
});

it("preserves aliases, cycles and fresh mutable descendants in conservative records", () => {
  const child = { text: "old" };
  const owner: Record<string, unknown> = { first: child, second: child };
  owner.self = owner;
  const before = measureSandboxData([owner]);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([owner]) - before).toBe(1000);
  delete owner.second;
  expect(measureSandboxData([owner])).toBe(before + 993);
});

it("does not expose private record slots to later inherited native index setters", () => {
  const payload = { text: "x".repeat(1000) };
  const owner = { payload };
  const expected = measureSandboxData([owner]);
  const define = Object.defineProperty;
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  let actual = -1;
  define(Array.prototype, "0", {
    configurable: true,
    set(value: unknown) {
      if (value === payload) exposed++;
      define(this, "0", {
        value: value === payload ? undefined : value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });
  try {
    actual = measureSandboxData([owner]);
  } finally {
    if (original === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else define(Array.prototype, "0", original);
  }
  expect(actual).toBe(expected);
  expect(exposed).toBe(0);
});

it("captures later record data before a retained callback mutates it", () => {
  const child = { text: "old" };
  let mutate = false;
  const owner: Record<string, unknown> = {};
  owner.callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (mutate) {
        mutate = false;
        owner.child = { text: "x".repeat(1003) };
      }
      return [];
    }
  });
  owner.child = child;
  const before = measureSandboxData([owner]);
  mutate = true;
  expect(measureSandboxData([owner])).toBe(before);
  expect(measureSandboxData([owner]) - before).toBe(1000);
});
