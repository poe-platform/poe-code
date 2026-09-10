import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function callStringRange(
  value: string,
  method: "slice" | "substring",
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  const release = retainValues(budget, () => [value, ...args]);
  try {
    const start = await sandboxNumber(args[0], budget, context);
    const end = args[1] === undefined ? undefined : await sandboxNumber(args[1], budget, context);
    return budget.allocateString(value[method](start, end));
  } finally {
    release();
  }
}
