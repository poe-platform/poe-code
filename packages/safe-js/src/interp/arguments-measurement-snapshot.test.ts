import { expect, it } from "vitest";
import { createSandboxArguments } from "./arguments.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("keeps retained argument snapshots private from later Array push hooks", () => {
  const payload = { text: "x".repeat(1000) };
  const args = createSandboxArguments([]);
  args.payload = payload;
  const expected = measureSandboxData([args]);
  const push = Array.prototype.push;
  let exposed = 0;
  let measured = -1;
  let rejected = false;
  Array.prototype.push = function (...items: unknown[]) {
    for (const item of items) {
      if (
        item === payload ||
        (Array.isArray(item) &&
          item.some(
            (value) => value === payload || (Array.isArray(value) && value.includes(payload))
          ))
      ) {
        exposed++;
        return this.length;
      }
    }
    return Reflect.apply(push, this, items);
  };
  try {
    measured = measureSandboxData([args]);
    try {
      reconcileCompiledValues(new Budget({ dataSize: 500 }), [args]);
    } catch (error) {
      rejected = (error as { budget?: string }).budget === "dataSize";
    }
  } finally {
    Array.prototype.push = push;
  }
  expect(measured).toBe(expected);
  expect(rejected).toBe(true);
  expect(exposed).toBe(0);
});

it("remeasures aliased mutable argument descendants on each fresh scan", () => {
  const child = { text: "old" };
  const args = createSandboxArguments([child, child]);
  args.self = args;
  const before = measureSandboxData([args]);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([args])).toBe(before + 1000);
  Reflect.deleteProperty(args, "0");
  expect(measureSandboxData([args])).toBe(before + 998);
});

it("does not expose argument snapshots through inherited index setters", () => {
  const payload = { text: "x".repeat(1000) };
  const args = createSandboxArguments([payload]);
  const expected = measureSandboxData([args]);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = false;
  let measured = -1;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    set(value: unknown) {
      // Native snapshot writes must never hand a private vector to this hook.
      if (
        value === payload ||
        (Array.isArray(value) &&
          value[0] === "0" &&
          Array.isArray(value[1]) &&
          value[1][0] === payload)
      )
        exposed = true;
      Object.defineProperty(this, "0", {
        value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });
  try {
    measured = measureSandboxData([args]);
  } finally {
    if (original === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else Object.defineProperty(Array.prototype, "0", original);
  }
  expect(measured).toBe(expected);
  expect(exposed).toBe(false);
});

it("captures argument strings before earlier callbacks mutate later properties", () => {
  const args = createSandboxArguments([]);
  let mutate = false;
  args.first = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (mutate) args.later = "x".repeat(1003);
      return [];
    }
  });
  args.later = "old";
  const before = measureSandboxData([args]);
  mutate = true;
  expect(measureSandboxData([args])).toBe(before);
  expect(measureSandboxData([args])).toBe(before + 1000);
});
