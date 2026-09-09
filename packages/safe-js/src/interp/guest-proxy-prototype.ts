import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";
import { getSandboxPrototype, setSandboxPrototype } from "./object-model.js";

export function sandboxGetPrototypeOf(value: SandboxValue, budget: Budget, context?: SandboxCallContext): SandboxValue | Promise<SandboxValue> {
  objectProperties(value);
  if (!guestProxyStates.has(value as object)) return getSandboxPrototype(value as object, budget) as SandboxValue;
  budget.visitNode();
  return withGuestProxyTrap(value as object, "getPrototypeOf", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxGetPrototypeOf(target, budget, context);
    const result = await invokeBuiltinClosure(trap, [target], budget, context, handler);
    if (result !== null && typeof result !== "object") throw new TypeError("Proxy prototype must be an object or null.");
    if (!await sandboxIsExtensible(target, budget, context) && result !== await sandboxGetPrototypeOf(target, budget, context))
      throw new TypeError("Proxy prototype does not match its non-extensible target.");
    return result;
  });
}

export function sandboxSetPrototypeOf(value: SandboxValue, prototype: SandboxValue, budget: Budget, context?: SandboxCallContext): boolean | Promise<boolean> {
  objectProperties(value, true);
  if (prototype !== null) objectProperties(prototype);
  if (!guestProxyStates.has(value as object)) return setSandboxPrototype(value as object, prototype as object | null, budget, false);
  budget.visitNode();
  return withGuestProxyTrap(value as object, "setPrototypeOf", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxSetPrototypeOf(target, prototype, budget, context);
    const result = Boolean(await invokeBuiltinClosure(trap, [target, prototype], budget, context, handler));
    if (!result) return false;
    if (!await sandboxIsExtensible(target, budget, context) && prototype !== await sandboxGetPrototypeOf(target, budget, context))
      throw new TypeError("Proxy cannot change its non-extensible target's prototype.");
    return true;
  });
}
