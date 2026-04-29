import type { Budget } from "../budget.js";
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
  const errorMessage = budget.allocateString(message === undefined ? "" : String(message));
  const header = errorMessage === "" ? name : `${name}: ${errorMessage}`;
  const stack = budget.allocateString([header, ...[...stackFrames].reverse()].join("\n"));

  return {
    name: budget.allocateString(name),
    message: errorMessage,
    stack
  };
}
