import type { SandboxValue } from "./values.js";
import { wellKnownSymbols } from "./symbols.js";
import { symbolRegistries } from "./symbol-registry.js";
import type { Budget } from "./budget.js";

export function canHoldWeakTarget(value: SandboxValue, budget: Budget): value is Extract<SandboxValue, object | symbol> {
  if (value !== null && typeof value === "object") return true;
  if (typeof value !== "symbol") return false;
  if (Object.values(wellKnownSymbols).includes(value)) return true;
  if (Symbol.keyFor(value) !== undefined) return false;
  for (const registered of symbolRegistries.get(budget)?.entries.values() ?? []) {
    budget.visitNode();
    if (registered === value) return false;
  }
  return true;
}

// Keep the target outside the ordinary property graph: traversing a WeakRef
// must not turn its weak edge into a permanent data root.
export const weakReferenceStates = new WeakMap<object, { deref(): Extract<SandboxValue, object | symbol> | undefined }>();

export function createWeakReferenceState(target: Extract<SandboxValue, object | symbol>): { deref(): Extract<SandboxValue, object | symbol> | undefined } {
  // These symbols are permanently reachable from the intrinsic catalogue.
  // Node's disposal symbols may be registered host symbols, so native WeakRef
  // cannot represent them even though they are valid guest well-known targets.
  if (typeof target === "symbol" && Object.values(wellKnownSymbols).includes(target))
    return { deref: () => target };
  return Reflect.construct(WeakRef, [target]) as { deref(): Extract<SandboxValue, object | symbol> | undefined };
}
