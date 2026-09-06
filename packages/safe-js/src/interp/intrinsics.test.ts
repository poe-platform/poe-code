import { describe, expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { accessorClosure } from "./accessors.js";
import { materializeFunctionProperties, releaseObjectPrototype } from "./object-model.js";
import { getIntrinsicIdentity, resolveIntrinsicIdentity } from "./intrinsics.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject } from "./values.js";

describe("realm intrinsic identities", () => {
  it.each(["Object", "Number", "String", "Boolean", "BigInt", "RegExp"] as const)("resolves %s and its prototype in a fresh realm", name => {
    const firstBudget = new Budget();
    const secondBudget = new Budget();
    const first = createBuiltinBindings({ budget: firstBudget });
    const second = createBuiltinBindings({ budget: secondBudget });
    for (const [before, after] of [
      [first[name], second[name]],
      [materializeFunctionProperties(first[name]).prototype, materializeFunctionProperties(second[name]).prototype]
    ]) {
      const id = getIntrinsicIdentity(before as object);
      expect(id).toBeTypeOf("string");
      expect(before === after).toBe(false);
      expect(resolveIntrinsicIdentity(firstBudget, id!) === before).toBe(true);
      expect(resolveIntrinsicIdentity(secondBudget, id!) === after).toBe(true);
    }
  });

  it("identifies static methods, symbol methods and accessor closures without invoking them", () => {
    const budget = new Budget();
    const globals = createBuiltinBindings({ budget });
    const number = materializeFunctionProperties(globals.Number);
    const regex = materializeFunctionProperties(globals.RegExp);
    const prototype = regex.prototype as SandboxObject;
    const values = [number.isNaN, prototype[Symbol.match],
      accessorClosure(Object.getOwnPropertyDescriptor(regex, Symbol.species)?.get),
      accessorClosure(Object.getOwnPropertyDescriptor(prototype, "source")?.get)];
    for (const value of values) {
      expect(value).toBeDefined();
      const id = getIntrinsicIdentity(value as object);
      expect(id).toBeTypeOf("string");
      expect(resolveIntrinsicIdentity(budget, id!)).toBe(value);
    }
    expect(new Set(values.map(value => getIntrinsicIdentity(value as object))).size).toBe(values.length);
  });

  it("keeps identities stable after renaming, replacement and deletion", () => {
    const budget = new Budget();
    const globals = createBuiltinBindings({ budget });
    const properties = materializeFunctionProperties(globals.Number);
    const method = properties.isNaN as SandboxClosure;
    const id = getIntrinsicIdentity(method)!;
    Object.defineProperty(materializeFunctionProperties(method), "name", { value: "changed" });
    delete properties.isNaN;
    expect(getIntrinsicIdentity(method)).toBe(id);
    expect(resolveIntrinsicIdentity(budget, id)).toBe(method);
  });

  it("rejects unregistered references and does not trust function names", () => {
    const budget = new Budget();
    createBuiltinBindings({ budget });
    expect(getIntrinsicIdentity(createSandboxClosure({ name: "Number", call: () => 3 }))).toBeUndefined();
    expect(() => resolveIntrinsicIdentity(budget, "__proto__")).toThrow("Unknown intrinsic identity");
    expect(() => resolveIntrinsicIdentity(budget, "process.exit")).toThrow("Unknown intrinsic identity");
    expect(() => resolveIntrinsicIdentity(new Budget(), '["Number"]')).toThrow("Unknown intrinsic identity");
  });

  it("registers every object-valued builtin binding and its public methods", () => {
    const budget = new Budget();
    const globals = createBuiltinBindings({ budget });
    for (const value of Object.values(globals)) {
      if (value === null || typeof value !== "object") continue;
      const id = getIntrinsicIdentity(value);
      expect(id).toBeTypeOf("string");
      expect(resolveIntrinsicIdentity(budget, id!) === value).toBe(true);
    }
    for (const owner of [globals.JSON, globals.Math, globals.console]) {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(owner))) {
        if (descriptor.value === null || typeof descriptor.value !== "object") continue;
        const id = getIntrinsicIdentity(descriptor.value);
        expect(id).toBeTypeOf("string");
        expect(resolveIntrinsicIdentity(budget, id!) === descriptor.value).toBe(true);
      }
    }
  });

  it("resolves non-constructor builtin methods to the fresh realm, not the previous sink", async () => {
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = createBuiltinBindings({ budget: new Budget(), sink: { log: (...args) => { firstMessages.push(args); }, error: () => undefined } });
    const budget = new Budget();
    const second = createBuiltinBindings({ budget, sink: { log: (...args) => { secondMessages.push(args); }, error: () => undefined } });
    const id = getIntrinsicIdentity(first.console.log as object)!;
    const restored = resolveIntrinsicIdentity(budget, id) as SandboxClosure;
    expect(restored === second.console.log).toBe(true);
    await restored.call(["fresh"]);
    expect(firstMessages).toEqual([]);
    expect(secondMessages).toEqual([["fresh"]]);
    expect(getIntrinsicIdentity(restored.call)).toBeUndefined();
  });

  it("releases realm resolution while preserving captured identity for completed dumps", () => {
    const budget = new Budget();
    const globals = createBuiltinBindings({ budget });
    const id = getIntrinsicIdentity(globals.Number)!;
    releaseObjectPrototype(budget);
    expect(getIntrinsicIdentity(globals.Number)).toBe(id);
    expect(() => resolveIntrinsicIdentity(budget, id)).toThrow("Unknown intrinsic identity");
  });
});
