import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties, propertyDescriptor } from "./globals/object-array.js";
import { retainedAccessorClosures } from "./accessors.js";
import { retainValues } from "./resources.js";

export function sandboxGetOwnPropertyDescriptor(
  value: SandboxValue, key: PropertyKey, budget: Budget, context?: SandboxCallContext
): PropertyDescriptor | undefined | Promise<PropertyDescriptor | undefined> {
  const properties = objectProperties(value);
  if (!guestProxyStates.has(value as object)) return Object.getOwnPropertyDescriptor(properties, key);
  budget.visitNode();
  return withGuestProxyTrap(value as object, "getOwnPropertyDescriptor", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxGetOwnPropertyDescriptor(target, key, budget, context);
    const result = await invokeBuiltinClosure(trap, [target, key as SandboxValue], budget, context, handler);
    if (result !== undefined && (result === null || typeof result !== "object"))
      throw new TypeError("Proxy descriptor must be an object or undefined.");
    let targetDescriptor: PropertyDescriptor | undefined;
    const release = retainValues(budget, () => [result, targetDescriptor?.value,
      ...targetDescriptor === undefined ? [] : retainedAccessorClosures(targetDescriptor)]);
    try {
      targetDescriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
      if (result === undefined) {
        if (targetDescriptor === undefined) return undefined;
        if (!targetDescriptor.configurable || !await sandboxIsExtensible(target, budget, context))
          throw new TypeError("Proxy cannot hide a protected target property.");
        return undefined;
      }
      const extensible = await sandboxIsExtensible(target, budget, context);
      const descriptor = await propertyDescriptor(result, budget, context);
      // Native descriptor operations on private scratch records implement completion
      // and compatibility without reading target values or invoking accessors.
      const complete = Object.getOwnPropertyDescriptor(Object.defineProperty(Object.create(null), key, descriptor), key)!;
      const scratch = Object.create(null);
      if (targetDescriptor !== undefined) Object.defineProperty(scratch, key, targetDescriptor);
      if (!extensible) Object.preventExtensions(scratch);
      if (!Reflect.defineProperty(scratch, key, complete))
        throw new TypeError("Proxy descriptor is incompatible with its target.");
      if (!complete.configurable && (targetDescriptor === undefined || targetDescriptor.configurable ||
          ("writable" in complete && !complete.writable && targetDescriptor.writable)))
        throw new TypeError("Proxy cannot report a target property as newly frozen.");
      return complete;
    } finally {
      release();
    }
  });
}
