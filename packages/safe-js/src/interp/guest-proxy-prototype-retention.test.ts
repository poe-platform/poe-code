import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy } from "./guest-proxy.js";
import { sandboxGetPrototypeOf } from "./guest-proxy-prototype.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxObject } from "./values.js";

it.each([false, true])("retains a returned prototype during target checks (throw=%s)", async fail => {
  const budget = new Budget(), prototype = { x: 1 }, marker = new Error("invariant failure");
  const target = createGuestProxy({}, {
    isExtensible: createSandboxClosure({ guest: true, call: () => {
      expect([...budget.retainedValues()]).toContain(prototype);
      if (fail) throw marker;
      return true;
    } })
  });
  const proxy = createGuestProxy(target, {
    getPrototypeOf: createSandboxClosure({ guest: true, call: () => prototype })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  if (fail) await expect(sandboxGetPrototypeOf(proxy, budget, context)).rejects.toBe(marker);
  else expect(await sandboxGetPrototypeOf(proxy, budget, context)).toBe(prototype);
  expect([...budget.retainedValues()]).toEqual([]);
});
