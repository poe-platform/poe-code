import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import type { TemporalPlainTimeFields } from "../temporal-plain-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalStringOptions } from "./temporal-string-options.js";

export async function formatTemporalPlainTime(fields: TemporalPlainTimeFields, options: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string> {
  const release = retainValues(budget, () => [fields, options]);
  try {
    const normalized = await readTemporalStringOptions(options, budget, context);
    return budget.allocateString(Backend.PlainTime.from(fields).toString(normalized));
  } finally { release(); }
}
