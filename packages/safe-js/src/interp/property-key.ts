import type { Budget } from "./budget.js";
import { objectToPrimitive, sandboxString } from "./string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

export function propertyFunctionName(key: PropertyKey): string {
  if (typeof key !== "symbol") return String(key);
  return key.description === undefined ? "" : `[${key.description}]`;
}

export function toPropertyKey(
  value: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): string | symbol | Promise<string | symbol> {
  // An existing string key is not a newly produced string allocation.
  if (typeof value === "string" || typeof value === "symbol") return value;
  if (value !== null && typeof value === "object") {
    return objectToPrimitive(value, budget, context, new Set(), "string").then(primitive =>
      typeof primitive === "symbol" ? primitive : sandboxString(primitive, budget, context)
    );
  }
  return sandboxString(value, budget, context);
}
