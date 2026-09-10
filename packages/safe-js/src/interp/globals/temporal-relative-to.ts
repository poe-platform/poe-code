import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { validateTemporalOffset, validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import { isSandboxTemporalPlainDate, temporalPlainDateFields } from "../temporal-plain-date.js";
import { isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { objectToPrimitive, sandboxNumber, sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalCalendarIdentifier } from "./temporal-calendar-identifier.js";

export async function readTemporalRelativeTo(value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<Backend.PlainDate | Backend.ZonedDateTime | undefined> {
  if (value === undefined) return undefined;
  if (isSandboxTemporalZonedDateTime(value)) {
    const fields = temporalZonedDateTimeFields(value);
    return new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
  }
  if (isSandboxTemporalPlainDateTime(value) || isSandboxTemporalPlainDate(value)) {
    const fields = isSandboxTemporalPlainDateTime(value) ? temporalPlainDateTimeFields(value) : temporalPlainDateFields(value);
    return new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar);
  }
  let current: SandboxValue = value;
  const normalized: Record<string, string | number> = Object.create(null);
  let relative: Backend.PlainDate | Backend.ZonedDateTime;
  const release = retainValues(budget, () => [value, current, normalized]);
  try {
    let input: string | Backend.ZonedDateTimeLikeObject;
    if (typeof current === "string") {
      budget.visitNode(current.length);
      validateTemporalStringOffsets(current);
      input = current;
    } else {
      if (current === null || typeof current !== "object") throw new TypeError("Invalid relativeTo value.");
      const bag = current;
      const releaseBag = retainValues(budget, () => [bag]);
      try {
        current = await sandboxGetProperty(bag, "calendar", bag, budget, context);
        const calendarId = readTemporalCalendarIdentifier(current === undefined ? "iso8601" : current, budget);
        const calendar = new Backend.PlainDate(2000, 1, 1, calendarId);
        normalized.calendar = calendar.calendarId;
        const keys = ["day", ...(calendar.era === undefined ? [] : ["era", "eraYear"]), "hour", "microsecond", "millisecond", "minute", "month", "monthCode", "nanosecond", "offset", "second", "timeZone", "year"];
        for (const key of keys) {
          current = await sandboxGetProperty(bag, key, bag, budget, context);
          if (current === undefined) continue;
          if (key === "era") normalized[key] = await sandboxString(current, budget, context);
          else if (key === "monthCode" || key === "timeZone" || key === "offset") {
            if (key === "timeZone" && isSandboxTemporalZonedDateTime(current))
              current = temporalZonedDateTimeFields(current).timeZone;
            if (key !== "timeZone" && current !== null && typeof current === "object")
              current = await objectToPrimitive(current, budget, context, new Set(), "string");
            if (typeof current !== "string") throw new TypeError(`${key} must be a string.`);
            budget.visitNode(current.length);
            if (key === "monthCode") {
              const digits = current.slice(1, 3);
              if ((current.length !== 3 && !(current.length === 4 && current[3] === "L")) || current[0] !== "M"
                || [...digits].some(char => char < "0" || char > "9") || (digits === "00" && current.length === 3))
                throw new RangeError("Invalid month code.");
            } else if (key === "timeZone") {
              current = budget.allocateString(new Backend.ZonedDateTime(0n, parseTemporalTimeZoneString(current)).timeZoneId);
            } else validateTemporalOffset(current);
            normalized[key] = current;
          } else {
            const number = Math.trunc(await sandboxNumber(current, budget, context));
            if (!Number.isFinite(number) || ((key === "day" || key === "month") && number <= 0))
              throw new RangeError(`Invalid relativeTo ${key}.`);
            normalized[key] = number === 0 ? 0 : number;
          }
        }
        // The backend performs required-field validation next; keep missing
        // fields missing instead of synthesizing values to satisfy its types.
        input = normalized as Backend.ZonedDateTimeLikeObject & Record<string, string | number>;
      } finally { releaseBag(); }
    }
    // Validate the complete relative input before the caller reads further guest options.
    // All properties here are normalized primitives, never guest accessors.
    new Backend.Duration().total({ relativeTo: input, unit: "nanosecond" });
    if (typeof input === "string") {
      try { relative = Backend.ZonedDateTime.from(input); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
        relative = Backend.PlainDate.from(input);
      }
    } else relative = input.timeZone === undefined ? Backend.PlainDate.from(input) : Backend.ZonedDateTime.from(input);
    return relative;
  } finally { release(); }
}
