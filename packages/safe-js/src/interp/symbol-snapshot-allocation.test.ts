import { expect, it, vi } from "vitest";

// A trusted load-time counter observes snapshot wrapper allocations without
// keeping the private vectors or their contents in mock call records.
const allocations = vi.hoisted(() => {
  const push = Array.prototype.push;
  const apply = Reflect.apply;
  let pairs = 0;
  Array.prototype.push = function (...values) {
    if (Object.getPrototypeOf(this) === null)
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (
          typeof value === "object" &&
          value !== null &&
          Object.hasOwn(value, "key") &&
          Object.hasOwn(value, "descriptor")
        )
          pairs++;
      }
    return apply(push, this, values);
  };
  return {
    reset: () => {
      pairs = 0;
    },
    read: () => pairs,
    restore: () => {
      Array.prototype.push = push;
    }
  };
});

import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

allocations.restore();

it("captures symbol descriptors without allocating per-entry wrapper objects", () => {
  const value = { [Symbol("first")]: "a", [Symbol("later")]: "bb" };
  allocations.reset();
  expect(measureSandboxData([value])).toBe(18);
  expect(allocations.read()).toBe(0);
});

it.each(
  (["record", "closure"] as const).flatMap((kind) =>
    ["push", "iterator", "index"].map((hook) => ({ kind, hook }))
  )
)("keeps $kind flat snapshots private from native $hook hooks", ({ kind, hook }) => {
  const key = Symbol("payload");
  const payload = { text: "x".repeat(1000) };
  const owner =
    kind === "record"
      ? { [key]: payload }
      : createSandboxClosure({
          call: () => undefined,
          properties: (closure) => {
            Object.defineProperty(closure, key, { value: payload });
            return {};
          }
        });
  const push = Array.prototype.push;
  const iterator = Array.prototype[Symbol.iterator];
  const index = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  try {
    if (hook === "push")
      Array.prototype.push = function (...items) {
        if (items[0] === key && items[1]?.value === payload) exposed++;
        return Reflect.apply(push, this, items);
      };
    else if (hook === "iterator")
      Array.prototype[Symbol.iterator] = function () {
        if (this[0] === key && this[1]?.value === payload) exposed++;
        return iterator.call(this);
      };
    else
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(value: unknown) {
          if (value === key) exposed++;
          Object.defineProperty(this, "0", {
            value,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      });
    expect(measureSandboxData([owner])).toBe(kind === "record" ? 1016 : 1017);
    for (const held of [false, true]) {
      const budget = new Budget({ dataSize: 500 });
      const release = held ? budget.deferReconciliation() : undefined;
      try {
        expect(() => reconcileCompiledValues(budget, [owner])).toThrowError(
          expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
        );
      } finally {
        release?.();
      }
    }
    expect(exposed).toBe(0);
  } finally {
    Array.prototype.push = push;
    Array.prototype[Symbol.iterator] = iterator;
    if (index === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else Object.defineProperty(Array.prototype, "0", index);
  }
});
