import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { defineDataProperty, objectProperties } from "./globals/object-array.js";
import { getSandboxPrototype } from "./object-model.js";
import { accessorClosure, retainedAccessorClosures } from "./accessors.js";
import { retainValues } from "./resources.js";
import { isSandboxModuleNamespace } from "./module-namespace.js";
import { isNumericTypedArray, isTypedArrayIndex } from "./typed-array.js";
import { setTypedArrayMember } from "./globals/numeric-typed-array.js";
import { assertSandboxDataDepth } from "../graph-depth.js";

export async function sandboxSetProperty(
  target: SandboxValue, key: PropertyKey, value: SandboxValue, receiver: SandboxValue,
  budget: Budget, context?: SandboxCallContext
): Promise<boolean> {
  objectProperties(target, true);
  let descriptor: PropertyDescriptor | undefined;
  const release = retainValues(budget, () => [target, value, receiver, descriptor?.value,
    ...descriptor === undefined ? [] : retainedAccessorClosures(descriptor)]);
  try {
    let depth = 0;
    for (let current = target; current !== null; current = getSandboxPrototype(current as object, budget) as SandboxValue) {
      budget.visitNode();
      assertSandboxDataDepth(depth++);
      if (guestProxyStates.has(current as object)) {
        return await withGuestProxyTrap(current as object, "set", budget, context, async ({ target: proxyTarget, handler, trap }) => {
          if (trap === undefined) return sandboxSetProperty(proxyTarget, key, value, receiver, budget, context);
          const result = Boolean(await invokeBuiltinClosure(trap, [proxyTarget, key as SandboxValue, value, receiver], budget, context, handler));
          if (!result) return false;
          const targetDescriptor = await sandboxGetOwnPropertyDescriptor(proxyTarget, key, budget, context);
          if (targetDescriptor !== undefined && !targetDescriptor.configurable) {
            if ("value" in targetDescriptor && !targetDescriptor.writable && !Object.is(value, targetDescriptor.value))
              throw new TypeError("Proxy cannot change a frozen target property's value.");
            if (!("value" in targetDescriptor) && targetDescriptor.set === undefined)
              throw new TypeError("Proxy cannot write a protected setterless property.");
          }
          return true;
        });
      }
      if (isSandboxModuleNamespace(current)) return false;
      if (isNumericTypedArray(current) && typeof key === "string" && isTypedArrayIndex(key)) {
        if (current === receiver) {
          await setTypedArrayMember(current, key, value, budget, context);
          return true;
        }
        if (Object.getOwnPropertyDescriptor(current, key) === undefined) return true;
      }
      descriptor = Object.getOwnPropertyDescriptor(objectProperties(current), key);
      if (descriptor !== undefined) break;
    }
    if (descriptor !== undefined && !("value" in descriptor)) {
      const setter = accessorClosure(descriptor.set, budget);
      if (setter === undefined) return false;
      await invokeBuiltinClosure(setter, [value], budget, context, receiver);
      return true;
    }
    if (descriptor !== undefined && !descriptor.writable) return false;
    if (receiver === null || typeof receiver !== "object") return false;
    const existing = await sandboxGetOwnPropertyDescriptor(receiver, key, budget, context);
    if (existing !== undefined && (!("value" in existing) || !existing.writable)) return false;
    return Boolean(await defineDataProperty(receiver, key, existing === undefined
      ? { value, writable: true, enumerable: true, configurable: true } : { value }, budget, context, false));
  } finally {
    release();
  }
}
