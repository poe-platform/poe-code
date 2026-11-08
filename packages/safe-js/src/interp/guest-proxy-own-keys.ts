import type { Budget } from "./budget.js";
import { ownSandboxSymbolKeys, type SandboxCallContext, type SandboxValue } from "./values.js";
import { guestProxyStates, withGuestProxyTrap } from "./guest-proxy.js";
import { sandboxIsExtensible } from "./guest-proxy-extensibility.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { objectProperties } from "./globals/object-array.js";
import { sandboxNumber } from "./string-coercion.js";
import { retainValues } from "./resources.js";

export function sandboxOwnKeys(
  value: SandboxValue, budget: Budget, context?: SandboxCallContext
): Array<string | symbol> | Promise<Array<string | symbol>> {
  const properties = objectProperties(value);
  if (!guestProxyStates.has(value as object))
    return [...Object.getOwnPropertyNames(properties), ...ownSandboxSymbolKeys(value)];
  budget.visitNode();
  return withGuestProxyTrap(value as object, "ownKeys", budget, context, async ({ target, handler, trap }) => {
    if (trap === undefined) return sandboxOwnKeys(target, budget, context);
    const result = await invokeBuiltinClosure(trap, [target], budget, context, handler);
    if (result === null || typeof result !== "object") throw new TypeError("Proxy ownKeys must return an object.");
    const keys: Array<string | symbol> = [], protectedKeys: Array<string | symbol> = [];
    let targetKeys: Array<string | symbol> | undefined, lengthValue: SandboxValue;
    const release = retainValues(budget, () => [result, keys, targetKeys, protectedKeys, lengthValue]);
    try {
      lengthValue = await context!.getProperty!(result, "length");
      const number = await sandboxNumber(lengthValue, budget, context);
      const length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
      budget.allocateArrayLength(length);
      for (let index = 0; index < length; index += 1) {
        budget.visitNode();
        const key = await context!.getProperty!(result, String(index));
        if (typeof key !== "string" && typeof key !== "symbol") throw new TypeError("Proxy ownKeys entries must be strings or symbols.");
        keys.push(key);
      }
      const unique = new Set(keys);
      if (unique.size !== keys.length) throw new TypeError("Proxy ownKeys cannot contain duplicate keys.");
      const extensible = await sandboxIsExtensible(target, budget, context);
      targetKeys = await sandboxOwnKeys(target, budget, context);
      for (const key of targetKeys) {
        budget.visitNode();
        const descriptor = await sandboxGetOwnPropertyDescriptor(target, key, budget, context);
        if (descriptor !== undefined && !descriptor.configurable) protectedKeys.push(key);
      }
      for (const key of extensible ? protectedKeys : targetKeys) {
        budget.visitNode();
        if (!unique.has(key)) throw new TypeError("Proxy ownKeys omitted a protected target key.");
      }
      if (!extensible && unique.size !== targetKeys.length)
        throw new TypeError("Proxy ownKeys added keys to a non-extensible target.");
      return keys;
    } finally {
      release();
    }
  });
}
