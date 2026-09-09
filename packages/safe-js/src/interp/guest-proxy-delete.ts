import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";

export function sandboxDeleteProperty(
  value: SandboxValue, key: PropertyKey, budget: Budget, context?: SandboxCallContext
): boolean | Promise<boolean> {
  const properties = objectProperties(value, true);
  if (!guestProxyStates.has(value as object)) return Reflect.deleteProperty(properties, key);
  budget.visitNode();
  return withGuestProxyTrap(value as object, "deleteProperty", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxDeleteProperty(target, key, budget, context);
    const result = Boolean(await invokeBuiltinClosure(trap, [target, key as SandboxValue], budget, context, handler));
    if (!result) return false;
    const descriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
    if (descriptor === undefined) return true;
    if (!descriptor.configurable || !await sandboxIsExtensible(target, budget, context))
      throw new TypeError("Proxy cannot report a protected target property as deleted.");
    return true;
  });
}
