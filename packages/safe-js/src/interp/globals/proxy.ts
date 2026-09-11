import type { Budget } from "../budget.js";
import { createGuestProxy, createGuestProxyRevoker } from "../guest-proxy.js";
import { createIntrinsicObject, materializeFunctionProperties, registerIntrinsicFunction } from "../object-model.js";
import { createSandboxClosure } from "../values.js";

export function createProxyGlobal(budget: Budget) {
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "Proxy", length: 2,
    call: () => { throw new TypeError("Proxy requires new."); },
    construct: ([target, handler]) => createGuestProxy(target, handler)
  });
  const revocable = createSandboxClosure({
    guest: true, sandbox: true, name: "revocable", length: 2,
    call: ([target, handler]) => {
      const proxy = createGuestProxy(target, handler);
      const revoke = createGuestProxyRevoker(proxy);
      return { proxy, revoke };
    }
  });
  // Proxy is constructible but, unlike ordinary functions, has no prototype property.
  const properties = createIntrinsicObject();
  Object.defineProperties(properties, {
    length: { value: constructor.length, configurable: true },
    name: { value: constructor.name, configurable: true },
    revocable: { value: revocable, writable: true, configurable: true }
  });
  materializeFunctionProperties(constructor, properties);
  registerIntrinsicFunction(budget, constructor);
  registerIntrinsicFunction(budget, revocable);
  return constructor;
}
