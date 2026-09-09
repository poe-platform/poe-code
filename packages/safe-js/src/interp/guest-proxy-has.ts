import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";
import { getSandboxPrototype } from "./object-model.js";
import { isNumericTypedArray, isTypedArrayIndex } from "./typed-array.js";
import { assertSandboxDataDepth } from "../graph-depth.js";

export function sandboxHasProperty(
  value: SandboxValue, key: PropertyKey, budget: Budget, context?: SandboxCallContext
): boolean | Promise<boolean> {
  objectProperties(value);
  let current = value as object, depth = 0;
  for (;;) {
    if (guestProxyStates.has(current)) {
      budget.visitNode();
      return withGuestProxyTrap(current, "has", budget, context, async ({ target, handler, trap }) => {
        if (trap === undefined) return sandboxHasProperty(target, key, budget, context);
        const result = Boolean(await invokeBuiltinClosure(trap, [target, key as SandboxValue], budget, context, handler));
        if (result) return true;
        const descriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
        if (descriptor !== undefined && (!descriptor.configurable || !await sandboxIsExtensible(target, budget, context)))
          throw new TypeError("Proxy cannot hide a protected target property.");
        return false;
      });
    }
    if (Object.getOwnPropertyDescriptor(objectProperties(current as SandboxValue), key) !== undefined) return true;
    // Integer-indexed objects do not consult prototypes for canonical numeric keys.
    if (isNumericTypedArray(current) && typeof key !== "symbol" && isTypedArrayIndex(String(key))) return false;
    const prototype = getSandboxPrototype(current, budget);
    if (prototype === null) return false;
    budget.visitNode();
    assertSandboxDataDepth(++depth);
    current = prototype;
  }
}
