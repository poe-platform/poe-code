import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";
import { getSandboxPrototype } from "./object-model.js";
import { readPropertyDescriptor } from "./accessors.js";
import { retainValues } from "./resources.js";
import { isNumericTypedArray, isTypedArrayIndex } from "./typed-array.js";
import { assertSandboxDataDepth } from "../graph-depth.js";

export function sandboxGetProperty(
  value: SandboxValue, key: PropertyKey, receiver: SandboxValue, budget: Budget, context?: SandboxCallContext
): SandboxValue | Promise<SandboxValue> {
  objectProperties(value);
  let current = value as object, depth = 0;
  for (;;) {
    if (guestProxyStates.has(current)) {
      budget.visitNode();
      let result: SandboxValue;
      const release = retainValues(budget, () => [receiver, result]);
      return withGuestProxyTrap(current, "get", budget, context, async ({ target, handler, trap }) => {
        if (trap === undefined) return sandboxGetProperty(target, key, receiver, budget, context);
        result = await invokeBuiltinClosure(trap, [target, key as SandboxValue, receiver], budget, context, handler);
        const descriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
        if (descriptor !== undefined && !descriptor.configurable) {
          if ("value" in descriptor && !descriptor.writable && !Object.is(result, descriptor.value))
            throw new TypeError("Proxy cannot change a frozen target property's value.");
          if (!("value" in descriptor) && descriptor.get === undefined && result !== undefined)
            throw new TypeError("Proxy cannot supply a value for a protected getterless property.");
        }
        return result;
      }).finally(release);
    }
    const descriptor = Object.getOwnPropertyDescriptor(objectProperties(current as SandboxValue), key);
    if (descriptor !== undefined) return readPropertyDescriptor(descriptor, receiver, context);
    if (isNumericTypedArray(current) && typeof key !== "symbol" && isTypedArrayIndex(String(key))) return undefined;
    const prototype = getSandboxPrototype(current, budget);
    if (prototype === null) return undefined;
    budget.visitNode();
    assertSandboxDataDepth(++depth);
    current = prototype;
  }
}
