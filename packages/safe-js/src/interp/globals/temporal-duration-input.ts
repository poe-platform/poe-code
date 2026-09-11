import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { isSandboxTemporalDuration, temporalDurationFields } from "../temporal-duration.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function readTemporalDuration(input: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<TemporalBackend.Duration> {
  if (isSandboxTemporalDuration(input)) return TemporalBackend.Duration.from(temporalDurationFields(input));
  if (typeof input === "string") {
    budget.allocateString(input);
    budget.visitNode(input.length);
    return TemporalBackend.Duration.from(input);
  }
  return TemporalBackend.Duration.from(await readTemporalPartialDuration(input, budget, context));
}

export async function readTemporalPartialDuration(input: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<Record<string, number>> {
  if (input === null || typeof input !== "object") throw new TypeError("Partial Duration requires an object.");
  const fields: Record<string,number> = Object.create(null);
  let current: SandboxValue;
  const release = retainValues(budget,()=>[input,current,fields]);
  try {
    for (const name of ["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","weeks","years"] as const) {
      current = await sandboxGetProperty(input,name,input,budget,context);
      if (current === undefined) continue;
      const number = await sandboxNumber(current,budget,context);
      if (!Number.isInteger(number)) throw new RangeError("Duration fields must be finite integers.");
      fields[name] = number;
    }
    if (Object.keys(fields).length === 0) throw new TypeError("Partial Duration requires at least one field.");
    return fields;
  } finally { release(); }
}
