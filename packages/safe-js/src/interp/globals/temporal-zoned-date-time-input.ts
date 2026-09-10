import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { objectToPrimitive, sandboxNumber, sandboxString } from "../string-coercion.js";
import { validateTemporalOffset, validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { parseTemporalTimeZoneString } from "../temporal-time-zone-string.js";
import { createSandboxTemporalZonedDateTime, hostTemporalZonedDateTimeFields, isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields, type TemporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalCalendarWithISODefault } from "./temporal-calendar-identifier.js";
import { isSandboxTemporalPlainDate } from "../temporal-plain-date.js";
import { isSandboxTemporalPlainDateTime } from "../temporal-plain-date-time.js";
import { isSandboxTemporalPlainTime } from "../temporal-plain-time.js";
import { isSandboxTemporalPlainMonthDay } from "../temporal-plain-month-day.js";
import { isSandboxTemporalPlainYearMonth } from "../temporal-plain-year-month.js";

export async function readTemporalZonedDateTime(input: SandboxValue, options: SandboxValue, budget: Budget, context?: SandboxCallContext, baseFields?: TemporalZonedDateTimeFields) {
  const normalized: Record<string, string | number> = Object.create(null);
  const settings: Record<string, string> = Object.create(null);
  let fields: TemporalZonedDateTimeFields | undefined;
  let current: SandboxValue;
  const release = retainValues(budget, () => [input, options, normalized, settings, fields, current, baseFields]);
  try {
    if (baseFields !== undefined) {
      if (isSandboxTemporalPlainYearMonth(input) || isSandboxTemporalPlainMonthDay(input) || input === null || typeof input !== "object" || isSandboxTemporalZonedDateTime(input) ||
          isSandboxTemporalPlainDate(input) || isSandboxTemporalPlainDateTime(input) || isSandboxTemporalPlainTime(input))
        throw new TypeError("ZonedDateTime with requires a partial object.");
      for (const key of ["calendar", "timeZone"]) {
        current = await sandboxGetProperty(input, key, input, budget, context);
        if (current !== undefined) throw new TypeError("Partial zoned objects cannot specify calendar or timeZone.");
      }
    }
    if (isSandboxTemporalZonedDateTime(input)) fields = temporalZonedDateTimeFields(input);
    else if (typeof input === "string") {
      budget.visitNode(input.length);
      validateTemporalStringOffsets(input);
      let source = input;
      const signed = input[0] === "+" || input[0] === "-";
      const width = signed ? 7 : 4;
      const digits = input.slice(signed ? 1 : 0, width);
      if (digits.length === (signed ? 6 : 4) && [...digits].every(char => char >= "0" && char <= "9") && input.slice(0, 7) !== "-000000") {
        const year = Number(input.slice(0, width));
        const representative = 2000 + ((year % 400) + 400) % 400;
        source = budget.allocateString(`${String(representative)}${input.slice(width)}`);
      }
      // Validate grammar/identifiers first, without rejecting a representable
      // grammar date for epoch limits or an offset policy chosen by options.
      Backend.ZonedDateTime.from(source, { offset: "ignore", disambiguation: "compatible" });
    } else {
      if (input === null || typeof input !== "object") throw new TypeError("ZonedDateTime input must be a string or object.");
      const calendar = baseFields?.calendar ?? await readTemporalCalendarWithISODefault(input, budget, context);
      if (baseFields === undefined) normalized.calendar = calendar;
      const hasEra = new Backend.PlainDate(2000, 1, 1, calendar).era !== undefined;
      for (const key of ["day", ...(hasEra ? ["era", "eraYear"] : []), "hour", "microsecond", "millisecond", "minute", "month", "monthCode", "nanosecond", "offset", "second", ...(baseFields === undefined ? ["timeZone"] : []), "year"]) {
        current = await sandboxGetProperty(input, key, input, budget, context);
        if (current === undefined) {
          if (key === "timeZone") throw new TypeError("ZonedDateTime requires timeZone.");
          continue;
        }
        if (key === "timeZone") {
          if (isSandboxTemporalZonedDateTime(current)) normalized[key] = temporalZonedDateTimeFields(current).timeZone;
          else {
            if (typeof current !== "string") throw new TypeError("Time zone must be a string or ZonedDateTime.");
            budget.visitNode(current.length);
            normalized[key] = budget.allocateString(new Backend.ZonedDateTime(0n, parseTemporalTimeZoneString(current)).timeZoneId);
          }
        } else if (key === "era") normalized[key] = await sandboxString(current, budget, context);
        else if (key === "monthCode" || key === "offset") {
          if (current !== null && typeof current === "object") current = await objectToPrimitive(current, budget, context, new Set(), "string");
          if (typeof current !== "string") throw new TypeError(`${key} must be a string.`);
          budget.visitNode(current.length);
          if (key === "offset") validateTemporalOffset(current);
          else {
            const digits = current.slice(1, 3);
            if ((current.length !== 3 && !(current.length === 4 && current[3] === "L")) || current[0] !== "M" ||
                [...digits].some(char => char < "0" || char > "9") || (digits === "00" && current.length === 3))
              throw new RangeError("Invalid month code.");
          }
          normalized[key] = current;
        } else {
          const number = Math.trunc(await sandboxNumber(current, budget, context));
          if (!Number.isFinite(number) || ((key === "day" || key === "month") && number <= 0)) throw new RangeError(`Invalid ZonedDateTime ${key}.`);
          normalized[key] = number === 0 ? 0 : number;
        }
      }
      if (baseFields !== undefined && Object.keys(normalized).length === 0) throw new TypeError("Partial zoned input requires at least one field.");
    }
    if (options !== undefined && (options === null || typeof options !== "object")) throw new TypeError("ZonedDateTime options must be an object.");
    for (const [key, fallback, allowed] of [
      ["disambiguation", "compatible", ["compatible", "earlier", "later", "reject"]],
      ["offset", baseFields === undefined ? "reject" : "prefer", ["prefer", "use", "ignore", "reject"]],
      ["overflow", "constrain", ["constrain", "reject"]]
    ] as const) {
      current = options === undefined ? undefined : await sandboxGetProperty(options, key, options, budget, context);
      const value = current === undefined ? fallback : await sandboxString(current, budget, context);
      if (!(allowed as readonly string[]).includes(value)) throw new RangeError(`Invalid Temporal ${key}.`);
      settings[key] = value;
    }
    if (fields === undefined) {
      // Missing date fields stay missing for backend validation after options.
      const result = baseFields === undefined
        ? Backend.ZonedDateTime.from(typeof input === "string" ? input : normalized as Backend.ZonedDateTimeLikeObject & Record<string, string | number>, settings)
        : new Backend.ZonedDateTime(baseFields.epochNanoseconds, baseFields.timeZone, baseFields.calendar).with(normalized, settings);
      fields = hostTemporalZonedDateTimeFields(result)!;
    }
    return createSandboxTemporalZonedDateTime(fields);
  } finally { release(); }
}
