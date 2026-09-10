import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function callStringPadding(
  value: string,
  method: "padStart" | "padEnd",
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  let filler: string | undefined;
  const release = retainValues(budget, () => [value, ...args, filler]);
  try {
    const length = await sandboxNumber(args[0], budget, context);
    if (Number.isNaN(length) || Math.trunc(length) <= value.length)
      return budget.allocateString(value);
    filler = args[1] === undefined ? undefined : await sandboxString(args[1], budget, context);
    return budget.allocateString(value[method](length, filler));
  } finally {
    release();
  }
}
