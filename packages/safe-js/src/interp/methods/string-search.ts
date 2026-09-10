import { types } from "node:util";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { isSandboxRegex, type SandboxCallContext, type SandboxValue } from "../values.js";

export async function callStringSearch(
  value: string,
  method: "startsWith" | "endsWith" | "includes",
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<boolean> {
  const search = args[0];
  let text: string | undefined;
  const release = retainValues(budget, () => [value, ...args, text]);
  try {
    if (types.isRegExp(search)) throw new TypeError("String search does not accept unbranded host RegExp values.");
    if (search !== null && typeof search === "object") {
      const match = context?.getProperty !== undefined
        ? await context.getProperty(search, Symbol.match)
        : await sandboxGetProperty(search, Symbol.match, search, budget, context);
      if (match === undefined ? isSandboxRegex(search) : Boolean(match))
        throw new TypeError("String search does not accept a RegExp.");
    }
    text = await sandboxString(search, budget, context);
    const position = args[1] === undefined ? undefined : await sandboxNumber(args[1], budget, context);
    return value[method](text, position);
  } finally {
    release();
  }
}
