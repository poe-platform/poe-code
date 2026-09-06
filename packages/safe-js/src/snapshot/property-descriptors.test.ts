import { describe, expect, it } from "vitest";
import { accessorAdapter, accessorClosure } from "../interp/accessors.js";
import { createSandboxClosure } from "../interp/values.js";
import { serializePropertyDescriptors, restorePropertyDescriptors } from "./property-descriptors.js";

describe("portable own property descriptors", () => {
  it("preserves data attributes, symbol keys, aliases, cycles and extensibility", () => {
    const source = Object.create(null);
    const target = Object.create(null);
    const key = Symbol("key");
    const restoredKey = Symbol("key");
    const shared = { value: 3 };
    const restoredShared = { value: 3 };
    Object.defineProperties(source, {
      hidden: { value: shared, writable: false, enumerable: false, configurable: true },
      alias: { value: shared, writable: true, enumerable: true, configurable: false },
      self: { value: source, writable: true, enumerable: true, configurable: true },
      [key]: { value: 3n, writable: false, enumerable: false, configurable: true }
    });
    Object.preventExtensions(source);
    const data = serializePropertyDescriptors(source, value => value);
    restorePropertyDescriptors(target, data, value => value === source ? target : value === shared ? restoredShared : value === key ? restoredKey : value);
    expect(target.self === target).toBe(true);
    expect(target.hidden === target.alias).toBe(true);
    expect(target.alias === restoredShared).toBe(true);
    expect(Object.getOwnPropertyDescriptor(target, "hidden")).toEqual({ value: restoredShared, writable: false, enumerable: false, configurable: true });
    expect(target[restoredKey]).toBe(3n);
    expect(Object.isExtensible(target)).toBe(false);
  });

  it("round-trips accessor closure identity without invoking the getter", () => {
    let calls = 0;
    const getter = createSandboxClosure({ guest: true, call: () => { calls++; return 3; } });
    const setter = createSandboxClosure({ guest: true, call: () => undefined });
    const source = Object.create(null);
    Object.defineProperty(source, "value", { get: accessorAdapter(getter, "get"), set: accessorAdapter(setter, "set"), enumerable: true, configurable: true });
    const target = Object.create(null);
    restorePropertyDescriptors(target, serializePropertyDescriptors(source, value => value), value => value);
    const descriptor = Object.getOwnPropertyDescriptor(target, "value")!;
    expect(accessorClosure(descriptor.get)).toBe(getter);
    expect(accessorClosure(descriptor.set)).toBe(setter);
    expect(calls).toBe(0);
  });

  it("does not serialize a native getter as a guest accessor", () => {
    let calls = 0;
    const source = Object.defineProperty({}, "value", { get() { calls++; return 3; } });
    expect(() => serializePropertyDescriptors(source, value => value)).toThrow("Native accessors");
    expect(calls).toBe(0);
  });

  it("preserves deletion and re-insertion order around a nonconfigurable builtin property", () => {
    const make = () => Object.defineProperties({}, {
      length: { value: 1, configurable: true }, name: { value: "builtin", configurable: true },
      prototype: { value: null }, extra: { value: 3, configurable: true }
    });
    const source = make();
    const target = make();
    Reflect.deleteProperty(source, "name");
    Reflect.deleteProperty(source, "extra");
    Object.defineProperty(source, "name", { value: "changed", configurable: true });
    restorePropertyDescriptors(target, serializePropertyDescriptors(source, value => value), value => value);
    expect(Reflect.ownKeys(target)).toEqual(Reflect.ownKeys(source));
    expect(Object.getOwnPropertyDescriptors(target)).toEqual(Object.getOwnPropertyDescriptors(source));
  });

  it.each([
    { properties: [["x", { kind: "data", value: 3, writable: true, enumerable: true }]], extensible: true },
    { properties: [["x", { kind: "accessor", get: 3, set: undefined, enumerable: true, configurable: true }]], extensible: true },
    { properties: [[3, { kind: "data", value: 3, writable: true, enumerable: true, configurable: true }]], extensible: true },
    { properties: [], extensible: "yes" }
  ])("rejects malformed descriptors without mutating the target", data => {
    const target = { original: 3 };
    expect(() => restorePropertyDescriptors(target, data, value => value)).toThrow();
    expect(target).toEqual({ original: 3 });
  });

  it("rejects duplicate decoded keys before mutation", () => {
    const descriptor = { kind: "data", value: 3, writable: true, enumerable: true, configurable: true };
    const data = { properties: [["a", descriptor], ["b", descriptor]], extensible: true };
    const target = { original: 3 };
    expect(() => restorePropertyDescriptors(target, data, value => value === "b" ? "a" : value)).toThrow("Duplicate property key");
    expect(target).toEqual({ original: 3 });
  });
});
