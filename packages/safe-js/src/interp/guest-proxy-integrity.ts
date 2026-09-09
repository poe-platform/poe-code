import type { Budget } from "./budget.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";
import { sandboxPreventExtensions } from "./guest-proxy-extensibility.js";
import { sandboxOwnKeys } from "./guest-proxy-own-keys.js";
import { sandboxGetOwnPropertyDescriptor } from "./guest-proxy-descriptor.js";
import { defineDataProperty } from "./globals/object-array.js";
import { retainValues } from "./resources.js";

export async function setGuestProxyIntegrity(
  value: SandboxValue, level: "sealed" | "frozen", budget: Budget, context?: SandboxCallContext
): Promise<SandboxValue> {
  let keys: Array<string | symbol> = [];
  const release = retainValues(budget, () => [value, keys]);
  try {
    if (!await sandboxPreventExtensions(value, budget, context))
      throw new TypeError("Proxy refused preventExtensions.");
    keys = await sandboxOwnKeys(value, budget, context);
    for (const key of keys) {
      budget.visitNode();
      const attributes: PropertyDescriptor = { configurable: false };
      if (level === "frozen") {
        const descriptor = await sandboxGetOwnPropertyDescriptor(value, key, budget, context);
        if (descriptor === undefined) continue;
        if ("value" in descriptor) attributes.writable = false;
      }
      await defineDataProperty(value, key, attributes, budget, context);
    }
    return value;
  } finally {
    release();
  }
}
