import { expect, it } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { createIntrinsicArray, createIntrinsicObject } from "./object-model.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["object", "array"] as const)("keeps the %s backing private from inherited native get traps", kind => {
  const tracked = kind === "object" ? createIntrinsicObject({ payload: "small" })
    : createIntrinsicArray(["small"]);
  const key = kind === "object" ? "payload" : "0";
  const before = measureSandboxData([tracked]);
  const leaked: object[] = [];
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "get");
  let value: unknown;
  Object.defineProperty(Object.prototype, "get", {
    configurable: true,
    value(target: Record<string, unknown>, property: PropertyKey, receiver: object) {
      leaked.push(target);
      target[key] = "x".repeat(1005);
      return Reflect.get(target, property, receiver);
    }
  });
  try { value = Reflect.get(tracked, key); }
  finally {
    if (inherited === undefined) Reflect.deleteProperty(Object.prototype, "get");
    else Object.defineProperty(Object.prototype, "get", inherited);
  }
  expect(leaked).toHaveLength(0);
  expect(value).toBe("small");
  expect(measureSandboxData([tracked])).toBe(before);
  Reflect.set(tracked, key, "x".repeat(1005));
  expect(measureSandboxData([tracked])).toBe(before + 1000);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: before + 500 }), [tracked]))
    .toThrow(SandboxError);
});

it.each(["has", "getOwnPropertyDescriptor", "ownKeys"] as const)(
  "keeps the backing private from an inherited %s trap",
  operation => {
    const tracked = createIntrinsicObject({ payload: "small" });
    const before = measureSandboxData([tracked]);
    const leaked: object[] = [];
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, operation);
    Object.defineProperty(Object.prototype, operation, {
      configurable: true,
      value(target: object, key: PropertyKey) {
        leaked.push(target);
        if (operation === "has") return Reflect.has(target, key);
        if (operation === "getOwnPropertyDescriptor") return Reflect.getOwnPropertyDescriptor(target, key);
        return Reflect.ownKeys(target);
      }
    });
    try {
      if (operation === "has") Reflect.has(tracked, "payload");
      else if (operation === "getOwnPropertyDescriptor") Reflect.getOwnPropertyDescriptor(tracked, "payload");
      else Reflect.ownKeys(tracked);
    } finally {
      if (inherited === undefined) Reflect.deleteProperty(Object.prototype, operation);
      else Object.defineProperty(Object.prototype, operation, inherited);
    }
    expect(leaked).toHaveLength(0);
    expect(measureSandboxData([tracked])).toBe(before);
  }
);

it.each([
  { kind: "object", trap: "get" }, { kind: "object", trap: "set" },
  { kind: "array", trap: "get" }, { kind: "array", trap: "set" }
])("keeps tracked $kind writes valid with an inherited $trap hook", ({ kind, trap }) => {
  const tracked = kind === "object" ? createIntrinsicObject({ payload: "small" })
    : createIntrinsicArray(["small"]);
  const key = kind === "object" ? "payload" : "0";
  const before = measureSandboxData([tracked]);
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, trap);
  let calls = 0;
  let failure: unknown;
  Object.defineProperty(Object.prototype, trap, {
    __proto__: null,
    configurable: true,
    value() { calls++; throw new Error("Inherited trap must not run."); }
  });
  try { Reflect.set(tracked, key, "x".repeat(1005)); }
  catch (error) { failure = error; }
  finally {
    if (inherited === undefined) Reflect.deleteProperty(Object.prototype, trap);
    else Object.defineProperty(Object.prototype, trap, inherited);
  }
  expect(failure).toBeUndefined();
  expect(calls).toBe(0);
  expect(measureSandboxData([tracked])).toBe(before + 1000);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: before + 500 }), [tracked]))
    .toThrow(SandboxError);
});
