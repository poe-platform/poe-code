import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { retainValues } from "../resources.js";
import { createSandboxTemporalPlainTime, temporalPlainTimeFieldNames, type TemporalPlainTimeFields } from "../temporal-plain-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalRoundingOptions } from "./temporal-rounding-options.js";

export async function roundTemporalPlainTime(fields: TemporalPlainTimeFields, options: SandboxValue, budget: Budget, context?: SandboxCallContext) {
  const release = retainValues(budget, () => [fields, options]);
  try {
    const normalized = await readTemporalRoundingOptions(options,
      ["hour", "minute", "second", "millisecond", "microsecond", "nanosecond"], budget, context);
    const result = Backend.PlainTime.from(fields).round(normalized);
    return createSandboxTemporalPlainTime(Object.fromEntries(temporalPlainTimeFieldNames.map(name => [name, result[name]])));
  } finally { release(); }
}
