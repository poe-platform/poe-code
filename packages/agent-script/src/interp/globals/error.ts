import type { Budget } from "../budget.js";
import { createSubsetErrorValue } from "../exceptions.js";
import { createSandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export type ErrorGlobals = Record<"Error" | "TypeError", ReturnType<typeof createSandboxClosure>>;

export function createErrorGlobals(options: { budget: Budget }): ErrorGlobals {
  return {
    Error: createSandboxClosure({
      call: ([message], context) => createSubsetError("Error", message, context?.stack ?? [], options.budget),
      name: "Error"
    }),
    TypeError: createSandboxClosure({
      call: ([message], context) => createSubsetError("TypeError", message, context?.stack ?? [], options.budget),
      name: "TypeError"
    })
  };
}

function createSubsetError(
  name: "Error" | "TypeError",
  message: SandboxValue,
  stackFrames: readonly string[],
  budget: Budget
): SandboxObject {
  return createSubsetErrorValue(name, message, stackFrames, budget);
}
