import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { getSandboxPrototype, setSandboxPrototype } from "./object-model.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";

const context: SandboxCallContext = { stack: [], thisValue: undefined,
  getProperty: (value, key) => (value as SandboxObject)[key] };

it.each(["Object", "Reflect"])("%s forwards prototype operations to the target", async api => {
  const budget = new Budget(), target = {}, first = {}, next = {};
  setSandboxPrototype(target, first, budget);
  const proxy = createGuestProxy(target, {});
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  expect(await (methods.getPrototypeOf as SandboxClosure).call([proxy], context)).toBe(first);
  expect(await (methods.setPrototypeOf as SandboxClosure).call([proxy, next], context)).toBe(api === "Object" ? proxy : true);
  expect(getSandboxPrototype(target, budget)).toBe(next);
});

it.each(["Object", "Reflect"])("%s uses a getPrototypeOf trap", async api => {
  const budget = new Budget(), target = {}, prototype = {}, calls: unknown[] = [];
  const handler = { getPrototypeOf: createSandboxClosure({ guest: true, call: ([value], ctx) => {
    calls.push([value === target, ctx?.thisValue === handler]); return prototype;
  } }) };
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  expect(await (methods.getPrototypeOf as SandboxClosure).call([createGuestProxy(target, handler)], context)).toBe(prototype);
  expect(calls).toEqual([[true, true]]);
});

it.each(["Object", "Reflect"])("%s rejects primitive getPrototypeOf results", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => 3 }) });
  await expect(Promise.resolve().then(() => (methods.getPrototypeOf as SandboxClosure).call([proxy], context))).rejects.toThrow(TypeError);
});

it.each(["Object", "Reflect"])("%s rejects a lying getPrototypeOf on a non-extensible target", async api => {
  const budget = new Budget(), target = {}, original = {};
  setSandboxPrototype(target, original, budget); Object.preventExtensions(target);
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy(target, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => null }) });
  await expect(Promise.resolve().then(() => (methods.getPrototypeOf as SandboxClosure).call([proxy], context))).rejects.toThrow(TypeError);
});

it.each(["Object", "Reflect"])("%s honors a refused setPrototypeOf trap", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy({}, { setPrototypeOf: createSandboxClosure({ guest: true, call: () => false }) });
  const result = Promise.resolve().then(() => (methods.setPrototypeOf as SandboxClosure).call([proxy, {}], context));
  if (api === "Object") await expect(result).rejects.toThrow(TypeError);
  else await expect(result).resolves.toBe(false);
});

it.each(["Object", "Reflect"])("%s rejects setPrototypeOf lies on a non-extensible target", async api => {
  const budget = new Budget(), target = {};
  setSandboxPrototype(target, null, budget); Object.preventExtensions(target);
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy(target, { setPrototypeOf: createSandboxClosure({ guest: true, call: () => true }) });
  await expect(Promise.resolve().then(() => (methods.setPrototypeOf as SandboxClosure).call([proxy, {}], context))).rejects.toThrow(TypeError);
});

it.each(["getPrototypeOf", "setPrototypeOf"])("rejects revoked %s operations", async method => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const closure = createReflectGlobal(budget)[method] as SandboxClosure;
  await expect(Promise.resolve().then(() => closure.call([proxy, null], context))).rejects.toThrow(TypeError);
});

it.each(["Object", "Reflect"])("%s accepts matching prototypes on non-extensible targets", async api => {
  const budget = new Budget(), target = {}, prototype = {};
  setSandboxPrototype(target, prototype, budget); Object.preventExtensions(target);
  const handler = {
    getPrototypeOf: createSandboxClosure({ guest: true, call: () => prototype }),
    setPrototypeOf: createSandboxClosure({ guest: true, call: ([value, next], ctx) => {
      expect(value).toBe(target); expect(next).toBe(prototype); expect(ctx?.thisValue).toBe(handler);
      return "truthy";
    } })
  };
  const proxy = createGuestProxy(target, handler);
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  expect(await (methods.getPrototypeOf as SandboxClosure).call([proxy], context)).toBe(prototype);
  expect(await (methods.setPrototypeOf as SandboxClosure).call([proxy, prototype], context)).toBe(api === "Object" ? proxy : true);
});

it("does not query target invariants after a refused setPrototypeOf", async () => {
  const budget = new Budget();
  const target = createGuestProxy({}, { isExtensible: createSandboxClosure({ guest: true, call: () => {
    throw new Error("must not query target");
  } }) });
  const proxy = createGuestProxy(target, { setPrototypeOf: createSandboxClosure({ guest: true, call: () => false }) });
  expect(await (createReflectGlobal(budget).setPrototypeOf as SandboxClosure).call([proxy, null], context)).toBe(false);
});

it.each(["getPrototypeOf", "setPrototypeOf"])("bounds nested fallback work for %s", async method => {
  const budget = new Budget({ maxSteps: 8 });
  let value: SandboxObject = {};
  for (let i = 0; i < 32; i += 1) value = createGuestProxy(value, {});
  const closure = createReflectGlobal(budget)[method] as SandboxClosure;
  await expect(Promise.resolve().then(() => closure.call([value, null], context))).rejects.toMatchObject({
    code: "budgetExceeded", budget: "steps"
  });
});

it.each(["Object", "Reflect"])("preserves synchronous ordinary prototype mutation through %s", async api => {
  const budget = new Budget(), target = {}, prototype = {};
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const result = (methods.setPrototypeOf as SandboxClosure).call([target, prototype], context);
  expect(getSandboxPrototype(target, budget)).toBe(prototype);
  expect(await result).toBe(api === "Object" ? target : true);
});
