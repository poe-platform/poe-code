import type { Budget } from "./budget.js";
import { boundFunctionStates } from "./bound-function-state.js";
import { guestProxyStates, requireActiveGuestProxy } from "./guest-proxy.js";
import type { SandboxValue } from "./values.js";

const functionRealms = new WeakMap<object, Budget>();
const realmPrototypes = new WeakMap<Budget, Map<string, object>>();

export function registerFunctionRealm(value: object, budget: Budget): void {
  if (!functionRealms.has(value)) functionRealms.set(value, budget);
}

export function registerRealmPrototype(budget: Budget, name: string, prototype: object): void {
  let prototypes = realmPrototypes.get(budget);
  if (prototypes === undefined) realmPrototypes.set(budget, prototypes = new Map());
  if (!prototypes.has(name)) prototypes.set(name, prototype);
}

// Realm identity is internal: neither mutable global bindings nor the visible
// function prototype chain can identify it. Weak budget keys preserve defaults
// for live exported closures without keeping completed runs alive globally.
export function getFunctionRealmPrototype<T extends object | null | undefined>(
  target: SandboxValue, name: string, fallback: T
): T {
  const visited = new WeakSet<object>();
  while (typeof target === "object" && target !== null) {
    if (visited.has(target)) throw new TypeError("Cyclic function realm target.");
    visited.add(target);
    const realm = functionRealms.get(target);
    if (realm !== undefined) return (realmPrototypes.get(realm)?.get(name) ?? fallback) as T;
    const bound = boundFunctionStates.get(target);
    if (bound !== undefined) { target = bound.target; continue; }
    if (guestProxyStates.has(target)) { target = requireActiveGuestProxy(target).target; continue; }
    break;
  }
  return fallback;
}
