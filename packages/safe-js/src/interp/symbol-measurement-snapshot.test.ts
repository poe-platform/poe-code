import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["record", "closure"] as const)("charges %s symbol payloads", (kind) => {
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
  expect(measureSandboxData([owner])).toBe(kind === "record" ? 1016 : 1017);
});

it.each(
  (["record", "closure"] as const).flatMap((kind) =>
    ["push", "snapshot-iterator", "entry-iterator", "index-setter"].map((hook) => ({ kind, hook }))
  )
)("does not expose $kind symbol descriptors to native $hook hooks", ({ kind, hook }) => {
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
  const originalIndex = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let exposed = 0;
  let actual = -1;
  const rejected: boolean[] = [];
  try {
    if (hook === "push")
      Array.prototype.push = function (...items: unknown[]) {
        const entry = items[0] as [symbol, PropertyDescriptor] | undefined;
        if (entry?.[0] === key && entry[1]?.value === payload) {
          exposed++;
          entry[1].value = undefined;
        }
        return Reflect.apply(push, this, items);
      };
    else if (hook === "index-setter")
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(entry: [symbol, PropertyDescriptor]) {
          if (entry?.[0] === key && entry[1]?.value === payload) {
            exposed++;
            entry[1].value = undefined;
          }
          Object.defineProperty(this, "0", {
            value: entry,
            writable: true,
            configurable: true,
            enumerable: true
          });
        }
      });
    else
      Array.prototype[Symbol.iterator] = function () {
        const entry = hook === "snapshot-iterator" ? this[0] : this;
        if (entry?.[0] === key && entry[1]?.value === payload) {
          exposed++;
          entry[1].value = undefined;
        }
        return iterator.call(this);
      };
    actual = measureSandboxData([owner]);
    for (const held of [false, true]) {
      const budget = new Budget({ dataSize: 500 });
      const release = held ? budget.deferReconciliation() : undefined;
      let exceeds = false;
      try {
        reconcileCompiledValues(budget, [owner]);
      } catch (error) {
        exceeds = (error as { budget?: string }).budget === "dataSize";
      } finally {
        release?.();
      }
      rejected.push(exceeds);
    }
  } finally {
    Array.prototype.push = push;
    Array.prototype[Symbol.iterator] = iterator;
    if (originalIndex === undefined) Reflect.deleteProperty(Array.prototype, "0");
    else Object.defineProperty(Array.prototype, "0", originalIndex);
  }
  expect({ actual, exposed, rejected }).toEqual({
    actual: kind === "record" ? 1016 : 1017,
    exposed: 0,
    rejected: [true, true]
  });
});

it("captures later symbol descriptors before earlier retained callbacks mutate them", () => {
  const first = Symbol("first");
  const later = Symbol("later");
  const payload = { text: "x".repeat(1000) };
  const owner: Record<symbol, unknown> = {};
  owner[first] = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      owner[later] = undefined;
      return [];
    }
  });
  owner[later] = payload;
  expect(measureSandboxData([owner])).toBe(1022);
  expect(owner[later]).toBeUndefined();
});

it("preserves foreign symbol enumeration iterators and their failures", () => {
  const key = Symbol("payload");
  const owner = { [key]: { text: "x".repeat(1000) } };
  const keys: symbol[] = [];
  keys[Symbol.iterator] = function* () {
    yield key;
    return undefined;
  };
  const original = Object.getOwnPropertySymbols;
  const failure = new Error("symbol iterator failed");
  let actual = -1;
  try {
    Object.getOwnPropertySymbols = (value) => (value === owner ? keys : original(value));
    actual = measureSandboxData([owner]);
    keys[Symbol.iterator] = () => {
      throw failure;
    };
    expect(() => measureSandboxData([owner])).toThrow(failure);
  } finally {
    Object.getOwnPropertySymbols = original;
  }
  expect(actual).toBe(1016);
});
