import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import { temporalDurationFieldNames } from "../temporal-duration.js";
import { createSandboxTemporalPlainDateTime, hostTemporalPlainDateTimeFields, type TemporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalDuration } from "./temporal-duration-input.js";

export async function addTemporalPlainDateTime(fields: TemporalPlainDateTimeFields, input: SandboxValue, options: SandboxValue,
  operation: "add" | "subtract", budget: Budget, context?: SandboxCallContext) {
  let durationFields: Record<string, number> | undefined;
  let current: SandboxValue;
  const release = retainValues(budget, () => [fields, input, options, durationFields, current]);
  try {
    const duration = await readTemporalDuration(input, budget, context);
    durationFields = Object.fromEntries(temporalDurationFieldNames.map(name => [name, duration[name]]));
    if (options !== undefined && (options === null || typeof options !== "object"))
      throw new TypeError("PlainDateTime arithmetic options must be an object.");
    current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
    const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
    if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
    const value = new Backend.PlainDateTime(fields.isoYear, fields.isoMonth, fields.isoDay,
      fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond, fields.calendar);
    const result = value[operation](durationFields, { overflow });
    return createSandboxTemporalPlainDateTime(hostTemporalPlainDateTimeFields(result)!);
  } finally { release(); }
}
