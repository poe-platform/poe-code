import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { sandboxSetPrototypeOf } from "./guest-proxy-prototype.js";
import { getSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxObject } from "./values.js";

it.each([false, true])("retains requested prototype during trap lookup (throw=%s)", async fail => {
  const budget = new Budget(), prototype = { x: 1 }, marker = new Error("lookup failure");
  const handler = { setPrototypeOf: createSandboxClosure({ guest: true, call: () => true }) };
  const proxy = createGuestProxy({}, handler);
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: (value, key) => {
    if (value === handler && key === "setPrototypeOf") {
      expect([...budget.retainedValues()]).toContain(prototype);
      if (fail) throw marker;
    }
    return (value as SandboxObject)[key];
  } };
  if (fail) await expect(sandboxSetPrototypeOf(proxy, prototype, budget, context)).rejects.toBe(marker);
  else expect(await sandboxSetPrototypeOf(proxy, prototype, budget, context)).toBe(true);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("releases requested prototype after fallback", async () => {
  const budget = new Budget(), target = {}, prototype = {};
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: () => {
    expect([...budget.retainedValues()]).toContain(prototype);
    return undefined;
  } };
  expect(await sandboxSetPrototypeOf(createGuestProxy(target, {}), prototype, budget, context)).toBe(true);
  expect(getSandboxPrototype(target, budget)).toBe(prototype);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("releases requested prototype when the proxy is revoked", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect(sandboxSetPrototypeOf(proxy, {}, budget)).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});
