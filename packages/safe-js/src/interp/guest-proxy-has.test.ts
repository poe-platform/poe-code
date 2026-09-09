import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure } from "./values.js";

const context: SandboxCallContext = { stack: [], thisValue: undefined,
  getProperty: (value, key) => Reflect.get(value as object, key) };

it.each([
  { name: "virtual property", present: false, configurable: true, extensible: true, result: true },
  { name: "hidden configurable", present: true, configurable: true, extensible: true, result: false },
  { name: "hidden frozen", present: true, configurable: false, extensible: true, result: false },
  { name: "hidden non-extensible", present: true, configurable: true, extensible: false, result: false },
  { name: "invented non-extensible", present: false, configurable: true, extensible: false, result: true },
  { name: "truthy", present: false, configurable: true, extensible: true, result: "yes" },
  { name: "falsy", present: true, configurable: true, extensible: true, result: 0 }
])("matches native has invariants: $name", async ({ present, configurable, extensible, result }) => {
  const target = {};
  if (present) Object.defineProperty(target, "x", { value: 1, configurable });
  if (!extensible) Object.preventExtensions(target);
  let expected = false, failure = false;
  try { expected = Reflect.has(new Proxy(target, { has: () => Boolean(result) }), "x"); }
  catch (error) { expect(error).toBeInstanceOf(TypeError); failure = true; }
  const budget = new Budget(), calls: unknown[] = [];
  const handler = { has: createSandboxClosure({ guest: true, call: ([value, key], ctx) => {
    calls.push([value === target, key, ctx?.thisValue === handler]); return result;
  } }) };
  const pending = (createReflectGlobal(budget).has as SandboxClosure).call([createGuestProxy(target, handler), "x"], context);
  if (failure) await expect(pending).rejects.toThrow(TypeError);
  else await expect(pending).resolves.toBe(expected);
  expect(calls).toEqual([[true, "x", true]]);
});

it("forwards through nested proxies and ordinary prototype links", async () => {
  const budget = new Budget(), key = Symbol("x"), inherited = { [key]: 1 }, target = {}, child = {};
  setSandboxPrototype(target, inherited, budget);
  setSandboxPrototype(child, createGuestProxy(createGuestProxy(target, {}), {}), budget);
  expect(await (createReflectGlobal(budget).has as SandboxClosure).call([child, key], context)).toBe(true);
});

it("does not inspect target descriptors for truthy has results", async () => {
  const budget = new Budget();
  const target = createGuestProxy({}, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => { throw new Error("unexpected descriptor read"); } }) });
  const proxy = createGuestProxy(target, { has: createSandboxClosure({ guest: true, call: () => true }) });
  expect(await (createReflectGlobal(budget).has as SandboxClosure).call([proxy, "x"], context)).toBe(true);
});

it("rejects revoked has operations", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect((createReflectGlobal(budget).has as SandboxClosure).call([proxy, "x"], context)).rejects.toThrow(TypeError);
});

it("bounds nested proxy fallback", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  await expect((createReflectGlobal(budget).has as SandboxClosure).call([target, "x"], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("does not invoke ordinary accessors while checking existence", async () => {
  const budget = new Budget(), target = {};
  Object.defineProperty(target, "x", { get: () => { throw new Error("getter executed"); } });
  expect(await (createReflectGlobal(budget).has as SandboxClosure).call([createGuestProxy(target, {}), "x"], context)).toBe(true);
});

it("stops invalid typed-array index lookup before a proxy prototype", async () => {
  const budget = new Budget(), target = new Uint8Array(0);
  setSandboxPrototype(target, createGuestProxy({}, { has: createSandboxClosure({ guest: true, call: () => true }) }), budget);
  const has = createReflectGlobal(budget).has as SandboxClosure;
  expect(await has.call([target, "0"], context)).toBe(false);
  expect(await has.call([target, "named"], context)).toBe(true);
});
