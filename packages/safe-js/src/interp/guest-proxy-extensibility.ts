import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";

export function sandboxIsExtensible(value: SandboxValue, budget: Budget, context?: SandboxCallContext): boolean | Promise<boolean> {
  if (typeof value !== "object" || value === null || !guestProxyStates.has(value))
    return Object.isExtensible(objectProperties(value));
  budget.visitNode();
  return withGuestProxyTrap(value, "isExtensible", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxIsExtensible(target, budget, context);
    const result = Boolean(await invokeBuiltinClosure(trap, [target], budget, context, handler));
    if (result !== await sandboxIsExtensible(target, budget, context))
      throw new TypeError("Proxy isExtensible result does not match its target.");
    return result;
  });
}

export function sandboxPreventExtensions(value: SandboxValue, budget: Budget, context?: SandboxCallContext): boolean | Promise<boolean> {
  if (typeof value !== "object" || value === null || !guestProxyStates.has(value))
    return Reflect.preventExtensions(objectProperties(value, true));
  budget.visitNode();
  return withGuestProxyTrap(value, "preventExtensions", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxPreventExtensions(target, budget, context);
    const result = Boolean(await invokeBuiltinClosure(trap, [target], budget, context, handler));
    if (result && await sandboxIsExtensible(target, budget, context))
      throw new TypeError("Proxy preventExtensions succeeded on an extensible target.");
    return result;
  });
}
