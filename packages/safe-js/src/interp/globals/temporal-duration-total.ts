import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxString } from "../string-coercion.js";
import type { TemporalDurationFields } from "../temporal-duration.js";
import { totalTimeDuration } from "../time-duration-total.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalRelativeTo } from "./temporal-relative-to.js";

export async function totalTemporalDuration(
  fields: TemporalDurationFields, options: SandboxValue, budget: Budget, context?: SandboxCallContext
): Promise<number> {
  if (typeof options !== "string" && (options === null || typeof options !== "object"))
    throw new TypeError("Duration total requires a unit string or options object.");
  let current: SandboxValue;
  let relative: Backend.PlainDate | Backend.ZonedDateTime | undefined;
  const release = retainValues(budget, () => [options, fields, current]);
  try {
    if (typeof options !== "string") {
      current = await sandboxGetProperty(options, "relativeTo", options, budget, context);
      relative = await readTemporalRelativeTo(current, budget, context);
    }
    current = typeof options === "string" ? options : await sandboxGetProperty(options, "unit", options, budget, context);
    if (current === undefined) throw new RangeError("Duration total requires a unit.");
    const text = await sandboxString(current, budget, context);
    const unit = (["year", "month", "week", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"] as const)
      .find(unit => text === unit || text === `${unit}s`);
    if (unit === undefined) throw new RangeError("Invalid Duration total unit.");
    // DifferencePlainDateTimeWithTotal returns zero for equal endpoints before
    // checking date-time limits or constructing a calendar rounding interval.
    if (relative instanceof Backend.PlainDate && Object.values(fields).every(value => value === 0)) return 0;
    if (unit === "year" || unit === "month" || unit === "week" || (unit === "day" && relative instanceof Backend.ZonedDateTime)) {
      if (relative === undefined) throw new RangeError("Calendar totals require relativeTo.");
      return totalCalendarDuration(fields, relative, unit);
    }
    let time = fields;
    if (relative instanceof Backend.ZonedDateTime) {
      const end = relative.add(fields);
      return totalTimeDuration(end.epochNanoseconds - relative.epochNanoseconds, unit);
    }
    if (relative !== undefined) {
      const start = relative.toPlainDateTime();
      time = start.until(start.add(fields), { largestUnit: "second" });
    } else if (fields.years !== 0 || fields.months !== 0 || fields.weeks !== 0)
      throw new RangeError("Calendar durations require relativeTo.");
    return totalTimeDuration(timeDurationNanoseconds(time), unit);
  } finally { release(); }
}

function timeDurationNanoseconds(time: TemporalDurationFields): bigint {
  const seconds = ((BigInt(time.days) * 24n + BigInt(time.hours)) * 60n + BigInt(time.minutes)) * 60n + BigInt(time.seconds);
  return ((seconds * 1000n + BigInt(time.milliseconds)) * 1000n + BigInt(time.microseconds)) * 1000n + BigInt(time.nanoseconds);
}

function totalCalendarDuration(fields: TemporalDurationFields, relative: Backend.PlainDate | Backend.ZonedDateTime, unit: "year" | "month" | "week" | "day"): number {
  const start = relative instanceof Backend.ZonedDateTime ? relative : relative.toPlainDateTime();
  const end = start.add(fields);
  // Both endpoints have the same kind; the backend's overloads do not express
  // that relationship for a union of plain and zoned date-times.
  const difference = start instanceof Backend.ZonedDateTime
    ? start.until(end as Backend.ZonedDateTime, { largestUnit: unit })
    : start.until(end as Backend.PlainDateTime, { largestUnit: unit });
  const field = `${unit}s` as "years" | "months" | "weeks" | "days";
  let whole = difference[field];
  const sign = Math.sign(Object.values(fields).find(value => value !== 0) ?? 0) || 1;
  const position = (value: Backend.ZonedDateTime | Backend.PlainDateTime): bigint =>
    value instanceof Backend.ZonedDateTime ? value.epochNanoseconds
      : timeDurationNanoseconds((start as Backend.PlainDateTime).until(value, { largestUnit: "second" }));
  const target = position(end);
  let lower = position(start.add({ [field]: whole }));
  let upper = position(start.add({ [field]: whole + sign }));
  if (sign > 0 ? target > upper : target < upper) {
    whole += sign;
    lower = upper;
    upper = position(start.add({ [field]: whole + sign }));
  }
  const interval = upper > lower ? upper - lower : lower - upper;
  // Round the complete rational only once. Converting either the remainder
  // or the interval to Number first loses nanoseconds in year-sized spans.
  return totalTimeDuration(BigInt(whole) * interval + target - lower, interval);
}
