import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { sandboxGetProperty } from "./guest-proxy-get.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { setSandboxPrototype } from "./object-model.js";
import { accessorAdapter } from "./accessors.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "./values.js";

const context: SandboxCallContext = { stack: [], thisValue: undefined,
  getProperty: (value, key) => Reflect.get(value as object, key),
  invokeClosure: async (closure, args, thisValue) => closure.call(args, { ...context, thisValue }) };

it.each([
  { name: "virtual value", descriptor: undefined, result: 3 },
  { name: "same frozen value", descriptor: { value: 1 }, result: 1 },
  { name: "changed frozen value", descriptor: { value: 1 }, result: 2 },
  { name: "NaN identity", descriptor: { value: NaN }, result: NaN },
  { name: "signed zero", descriptor: { value: -0 }, result: 0 },
  { name: "writable fixed property", descriptor: { value: 1, writable: true }, result: 2 },
  { name: "configurable property", descriptor: { value: 1, configurable: true }, result: 2 },
  { name: "getterless undefined", descriptor: { get: undefined }, result: undefined },
  { name: "getterless lie", descriptor: { get: undefined }, result: 2 }
])("matches native get invariants: $name", async ({ descriptor, result }) => {
  const target = {};
  if (descriptor !== undefined) Object.defineProperty(target, "x", descriptor);
  let expected: SandboxValue, failure = false;
  try { expected = Reflect.get(new Proxy(target, { get: () => result }), "x"); }
  catch (error) { expect(error).toBeInstanceOf(TypeError); failure = true; }
  const budget = new Budget(), receiver = {}, calls: unknown[] = [];
  const handler = { get: createSandboxClosure({ guest: true, call: ([value, key, actualReceiver], ctx) => {
    calls.push([value === target, key, actualReceiver === receiver, ctx?.thisValue === handler]); return result;
  } }) };
  const pending = (createReflectGlobal(budget).get as SandboxClosure).call([createGuestProxy(target, handler), "x", receiver], context);
  if (failure) await expect(pending).rejects.toThrow(TypeError);
  else await expect(pending).resolves.toBe(expected);
  expect(calls).toEqual([[true, "x", true, true]]);
});

it.each([undefined, null, 9, {}])("forwards explicit receiver %s through nested proxies to inherited accessors", async receiver => {
  const budget = new Budget(), target = {}, prototype = {}, key = Symbol("x");
  const getter = createSandboxClosure({ guest: true, call: (_args, ctx) => ctx?.thisValue });
  Object.defineProperty(prototype, key, { get: accessorAdapter(getter, "get") });
  setSandboxPrototype(target, prototype, budget);
  const proxy = createGuestProxy(createGuestProxy(target, {}), {});
  expect(await (createReflectGlobal(budget).get as SandboxClosure).call([proxy, key, receiver], context)).toBe(receiver);
});

it("preserves the initial receiver when an ordinary prototype chain reaches a proxy", async () => {
  const budget = new Budget(), child = {};
  const proxy = createGuestProxy({}, { get: createSandboxClosure({ guest: true, call: ([_target, _key, receiver]) => receiver }) });
  setSandboxPrototype(child, proxy, budget);
  expect(await (createReflectGlobal(budget).get as SandboxClosure).call([child, "x"], context)).toBe(child);
});

it("rejects revoked get operations", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect((createReflectGlobal(budget).get as SandboxClosure).call([proxy, "x"], context)).rejects.toThrow(TypeError);
});

it("bounds nested proxy get fallback", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target: SandboxObject = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  await expect((createReflectGlobal(budget).get as SandboxClosure).call([target, "x"], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("retains the receiver during trap lookup and the result during invariant queries", async () => {
  const budget = new Budget(), receiver = { payload: "receiver" }, result = { payload: "result" };
  const target = createGuestProxy({}, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => {
    expect([...budget.retainedValues()]).toContain(result);
    return undefined;
  } }) });
  const handler = { get: createSandboxClosure({ guest: true, call: () => result }) };
  const proxy = createGuestProxy(target, handler);
  const lookupContext: SandboxCallContext = { ...context, getProperty: async (value, key) => {
    if (value === handler) expect([...budget.retainedValues()]).toContain(receiver);
    return context.getProperty!(value, key);
  } };
  expect(await sandboxGetProperty(proxy, "x", receiver, budget, lookupContext)).toBe(result);
  expect([...budget.retainedValues()]).toEqual([]);
});
