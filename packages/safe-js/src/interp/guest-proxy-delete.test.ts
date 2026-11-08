import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";

const context: SandboxCallContext = { stack: [], thisValue: undefined,
  getProperty: (value, key) => (value as SandboxObject)[key] };

it.each([
  { name: "absent", present: false, configurable: true, extensible: true, result: true },
  { name: "configurable", present: true, configurable: true, extensible: true, result: true },
  { name: "frozen", present: true, configurable: false, extensible: true, result: true },
  { name: "non-extensible", present: true, configurable: true, extensible: false, result: true },
  { name: "absent on sealed target", present: false, configurable: true, extensible: false, result: true },
  { name: "refused frozen", present: true, configurable: false, extensible: false, result: false },
  { name: "falsy result", present: true, configurable: true, extensible: true, result: 0 },
  { name: "truthy result", present: true, configurable: true, extensible: true, result: "yes" }
])("matches native deletion invariants: $name", async ({ present, configurable, extensible, result }) => {
  const target = {};
  if (present) Object.defineProperty(target, "x", { value: 1, configurable });
  if (!extensible) Object.preventExtensions(target);
  let expected = false, failure = false;
  try { expected = Reflect.deleteProperty(new Proxy(target, { deleteProperty: () => Boolean(result) }), "x"); }
  catch (error) { expect(error).toBeInstanceOf(TypeError); failure = true; }
  const budget = new Budget(), calls: unknown[] = [];
  const handler = { deleteProperty: createSandboxClosure({ guest: true, call: ([value, key], ctx) => {
    calls.push([value === target, key, ctx?.thisValue === handler]); return result;
  } }) };
  const pending = (createReflectGlobal(budget).deleteProperty as SandboxClosure).call([createGuestProxy(target, handler), "x"], context);
  if (failure) await expect(pending).rejects.toThrow(TypeError);
  else await expect(pending).resolves.toBe(expected);
  expect(calls).toEqual([[true, "x", true]]);
  expect(Object.hasOwn(target, "x")).toBe(present);
});

it("forwards nested symbol deletion to the target", async () => {
  const budget = new Budget(), key = Symbol("x"), target = { [key]: 1 };
  expect(await (createReflectGlobal(budget).deleteProperty as SandboxClosure).call([createGuestProxy(createGuestProxy(target, {}), {}), key], context)).toBe(true);
  expect(Object.hasOwn(target, key)).toBe(false);
});

it("allows a trap to actually remove a non-extensible target property", async () => {
  const budget = new Budget(), target = Object.preventExtensions({ x: 1 });
  const proxy = createGuestProxy(target, { deleteProperty: createSandboxClosure({ guest: true, call: () => Reflect.deleteProperty(target, "x") }) });
  expect(await (createReflectGlobal(budget).deleteProperty as SandboxClosure).call([proxy, "x"], context)).toBe(true);
  expect(Object.hasOwn(target, "x")).toBe(false);
});

it("does not inspect target invariants after a false trap result", async () => {
  const budget = new Budget();
  const target = createGuestProxy({}, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => { throw new Error("unexpected descriptor read"); } }) });
  const proxy = createGuestProxy(target, { deleteProperty: createSandboxClosure({ guest: true, call: () => false }) });
  expect(await (createReflectGlobal(budget).deleteProperty as SandboxClosure).call([proxy, "x"], context)).toBe(false);
});

it("rejects revoked deletion", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect((createReflectGlobal(budget).deleteProperty as SandboxClosure).call([proxy, "x"], context)).rejects.toThrow(TypeError);
});

it("bounds nested deletion fallback", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target: SandboxObject = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  await expect((createReflectGlobal(budget).deleteProperty as SandboxClosure).call([target, "x"], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});
