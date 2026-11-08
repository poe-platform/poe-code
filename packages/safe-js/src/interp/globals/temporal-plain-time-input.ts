import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { isSandboxTemporalPlainTime, temporalPlainTimeFieldNames, temporalPlainTimeFields, type TemporalPlainTimeFields } from "../temporal-plain-time.js";
import { isSandboxTemporalPlainMonthDay } from "../temporal-plain-month-day.js";
import { isSandboxTemporalPlainYearMonth } from "../temporal-plain-year-month.js";
import { isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import { isSandboxTemporalPlainDate } from "../temporal-plain-date.js";
import { isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function readTemporalPlainTime(input: SandboxValue, options: SandboxValue, budget: Budget, context?: SandboxCallContext, baseFields?: TemporalPlainTimeFields): Promise<TemporalPlainTimeFields> {
  let fields: Record<string, number> = Object.create(null);
  let parsed: Backend.PlainTime | undefined;
  let current: SandboxValue;
  const release = retainValues(budget, () => [input, options, fields, parsed, current, baseFields]);
  try {
    if (baseFields !== undefined) {
      if (isSandboxTemporalPlainYearMonth(input) || isSandboxTemporalPlainMonthDay(input) || input === null || typeof input !== "object" || isSandboxTemporalPlainTime(input) || isSandboxTemporalPlainDateTime(input) || isSandboxTemporalPlainDate(input) || isSandboxTemporalZonedDateTime(input))
        throw new TypeError("PlainTime with requires a partial time object.");
      // Instant and Duration are deliberately not excluded by this operation.
      for (const name of ["calendar", "timeZone"]) {
        current = await sandboxGetProperty(input, name, input, budget, context);
        if (current !== undefined) throw new TypeError("Partial time objects cannot specify calendar or timeZone.");
      }
    }
    if (isSandboxTemporalPlainTime(input)) fields = temporalPlainTimeFields(input);
    else if (isSandboxTemporalZonedDateTime(input)) {
      const zoned = temporalZonedDateTimeFields(input);
      parsed = new Backend.ZonedDateTime(zoned.epochNanoseconds, zoned.timeZone, zoned.calendar).toPlainTime();
    }
    else if (isSandboxTemporalPlainDateTime(input)) {
      const dateTime = temporalPlainDateTimeFields(input);
      fields = Object.fromEntries(temporalPlainTimeFieldNames.map(name => [name, dateTime[name]]));
    }
    else if (typeof input === "string") {
      budget.allocateString(input);
      budget.visitNode(input.length);
      validateTemporalStringOffsets(input, true);
      parsed = Backend.PlainTime.from(input);
    } else {
      if (input === null || typeof input !== "object") throw new TypeError("PlainTime input must be a string or object.");
      for (const name of ["hour", "microsecond", "millisecond", "minute", "nanosecond", "second"] as const) {
        current = await sandboxGetProperty(input, name, input, budget, context);
        if (current === undefined) continue;
        const number = await sandboxNumber(current, budget, context);
        if (!Number.isFinite(number)) throw new RangeError("PlainTime fields must be finite numbers.");
        fields[name] = Math.trunc(number);
      }
      if (Object.keys(fields).length === 0) throw new TypeError("PlainTime input requires at least one time field.");
    }
    if (options !== undefined && (options === null || typeof options !== "object"))
      throw new TypeError("PlainTime options must be an object.");
    current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
    const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
    if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
    const result = parsed ?? Backend.PlainTime.from(baseFields === undefined ? fields : { ...baseFields, ...fields }, { overflow });
    return Object.fromEntries(temporalPlainTimeFieldNames.map(name => [name, result[name]])) as TemporalPlainTimeFields;
  } finally { release(); }
}
