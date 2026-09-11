import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";

const context: SandboxCallContext = {
  stack: [], thisValue: undefined,
  getProperty: (value, key) => (value as SandboxObject)[key]
};

it.each(["Object", "Reflect"])("%s forwards extensibility operations to a proxy target", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const target = {}, proxy = createGuestProxy(target, {});
  expect(await (methods.isExtensible as SandboxClosure).call([proxy], context)).toBe(true);
  expect(await (methods.preventExtensions as SandboxClosure).call([proxy], context)).toBe(api === "Object" ? proxy : true);
  expect(Object.isExtensible(target)).toBe(false);
  expect(await (methods.isExtensible as SandboxClosure).call([proxy], context)).toBe(false);
});

it.each(["Object", "Reflect"])("%s preserves trap handler and target identity", async api => {
  const budget = new Budget(), target = {};
  const seen: unknown[] = [];
  const handler = { isExtensible: createSandboxClosure({ guest: true, call: ([value], callContext) => {
    seen.push([value === target, callContext?.thisValue === handler]);
    return true;
  } }) };
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  expect(await (methods.isExtensible as SandboxClosure).call([createGuestProxy(target, handler)], context)).toBe(true);
  expect(seen).toEqual([[true, true]]);
});

it.each(["Object", "Reflect"])("%s rejects a lying isExtensible trap", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy(Object.preventExtensions({}), {
    isExtensible: createSandboxClosure({ guest: true, call: () => true })
  });
  await expect(Promise.resolve().then(() => (methods.isExtensible as SandboxClosure).call([proxy], context))).rejects.toThrow(TypeError);
});

it.each(["Object", "Reflect"])("%s rejects false success from preventExtensions", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy({}, { preventExtensions: createSandboxClosure({ guest: true, call: () => true }) });
  await expect(Promise.resolve().then(() => (methods.preventExtensions as SandboxClosure).call([proxy], context))).rejects.toThrow(TypeError);
});

it.each(["Object", "Reflect"])("%s handles refused preventExtensions according to its API", async api => {
  const budget = new Budget();
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  const proxy = createGuestProxy({}, { preventExtensions: createSandboxClosure({ guest: true, call: () => false }) });
  const result = Promise.resolve().then(() => (methods.preventExtensions as SandboxClosure).call([proxy], context));
  if (api === "Object") await expect(result).rejects.toThrow(TypeError);
  else await expect(result).resolves.toBe(false);
});

it.each(["isExtensible", "preventExtensions"])("rejects %s after revocation", async method => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const closure = createReflectGlobal(budget)[method] as SandboxClosure;
  await expect(Promise.resolve().then(() => closure.call([proxy], context))).rejects.toThrow(TypeError);
});

it("forwards through nested proxies and accepts a trap that actually prevents extensions", async () => {
  const budget = new Budget(), target = {}, calls: string[] = [];
  const inner = createGuestProxy(target, {
    preventExtensions: createSandboxClosure({ guest: true, call: ([value]) => {
      calls.push("prevent");
      return Reflect.preventExtensions(value as object);
    } }),
    isExtensible: createSandboxClosure({ guest: true, call: ([value]) => {
      calls.push("isExtensible");
      return Object.isExtensible(value);
    } })
  });
  const outer = createGuestProxy(inner, {}), methods = createReflectGlobal(budget);
  expect(await (methods.preventExtensions as SandboxClosure).call([outer], context)).toBe(true);
  expect(await (methods.isExtensible as SandboxClosure).call([outer], context)).toBe(false);
  expect(calls).toEqual(["prevent", "isExtensible"]);
  expect(Object.isExtensible(target)).toBe(false);
});

it("does not inspect target extensibility when the outer prevent trap refuses", async () => {
  const budget = new Budget(), calls: string[] = [];
  const inner = createGuestProxy({}, { isExtensible: createSandboxClosure({ guest: true, call: () => {
    calls.push("target");
    throw new Error("must not inspect");
  } }) });
  const outer = createGuestProxy(inner, { preventExtensions: createSandboxClosure({ guest: true, call: () => false }) });
  expect(await (createReflectGlobal(budget).preventExtensions as SandboxClosure).call([outer], context)).toBe(false);
  expect(calls).toEqual([]);
});

it.each(["isExtensible", "preventExtensions"])("charges nested fallback work for %s", async method => {
  const budget = new Budget({ maxSteps: 8 });
  let value: SandboxObject = {};
  for (let index = 0; index < 32; index += 1) value = createGuestProxy(value, {});
  const closure = createReflectGlobal(budget)[method] as SandboxClosure;
  await expect(Promise.resolve().then(() => closure.call([value], context))).rejects.toMatchObject({
    code: "budgetExceeded", budget: "steps"
  });
});

it.each(["Object", "Reflect"])("preserves synchronous ordinary-object mutations for %s", async api => {
  const budget = new Budget(), target = {};
  const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
  expect(await (methods.isExtensible as SandboxClosure).call([target], context)).toBe(true);
  const result = (methods.preventExtensions as SandboxClosure).call([target], context);
  expect(Object.isExtensible(target)).toBe(false);
  expect(await result).toBe(api === "Object" ? target : true);
});
