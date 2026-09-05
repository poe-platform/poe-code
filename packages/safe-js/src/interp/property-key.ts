import type { Budget } from "./budget.js";
import { sandboxString } from "./string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

export async function toPropertyKey(
  value: SandboxValue,
  budget: Budget,
  context: SandboxCallContext
): Promise<string> {
  // An existing string key is not a newly produced string allocation.
  if (typeof value === "string") return value;
  return sandboxString(value, budget, context);
}
