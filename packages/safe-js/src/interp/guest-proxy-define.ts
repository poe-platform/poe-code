import type { Budget } from "./budget.js";
import { allocateProducedSandboxValue, type SandboxCallContext, type SandboxObject, type SandboxValue } from "./values.js";
import { withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { defineDataProperty } from "./globals/object-array.js";
import { accessorClosure, retainedAccessorClosures } from "./accessors.js";
import { retainValues } from "./resources.js";

export function defineGuestProxyProperty(
  proxy: object, key: PropertyKey, descriptor: PropertyDescriptor, budget: Budget, context?: SandboxCallContext
): Promise<boolean> {
  let outgoing: SandboxObject | undefined, targetDescriptor: PropertyDescriptor | undefined;
  const release = retainValues(budget, () => [descriptor.value, ...retainedAccessorClosures(descriptor), outgoing,
    targetDescriptor?.value, ...targetDescriptor === undefined ? [] : retainedAccessorClosures(targetDescriptor)]);
  return withGuestProxyTrap(proxy, "defineProperty", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return Boolean(await defineDataProperty(target, key, descriptor, budget, context, false));
    outgoing = {};
    // FromPropertyDescriptor preserves absent fields and exposes guest accessors,
    // never the native adapter functions used by internal descriptor records.
    for (const field of ["value", "writable", "get", "set", "enumerable", "configurable"] as const) {
      if (field in descriptor) outgoing[field] = field === "get" || field === "set"
        ? accessorClosure(descriptor[field], budget) : descriptor[field] as SandboxValue;
    }
    allocateProducedSandboxValue(outgoing, budget);
    const result = Boolean(await invokeBuiltinClosure(trap, [target, key as SandboxValue, outgoing], budget, context, handler));
    if (!result) return false;
    targetDescriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
    const extensible = await sandboxIsExtensible(target, budget, context);
    if (targetDescriptor === undefined) {
      if (!extensible || descriptor.configurable === false)
        throw new TypeError("Proxy cannot report an invalid new target property.");
      return true;
    }
    const scratch = Object.create(null);
    Object.defineProperty(scratch, key, targetDescriptor);
    if (!extensible) Object.preventExtensions(scratch);
    if (!Reflect.defineProperty(scratch, key, descriptor) ||
        (descriptor.configurable === false && targetDescriptor.configurable) ||
        ("value" in targetDescriptor && !targetDescriptor.configurable && targetDescriptor.writable && descriptor.writable === false))
      throw new TypeError("Proxy definition is incompatible with its target.");
    return true;
  }).finally(release);
}
