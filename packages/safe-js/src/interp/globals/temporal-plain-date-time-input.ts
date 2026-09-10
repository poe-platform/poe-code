import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { objectToPrimitive, sandboxNumber, sandboxString } from "../string-coercion.js";
import { validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { createSandboxTemporalPlainDateTime, hostTemporalPlainDateTimeFields, isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields, type SandboxTemporalPlainDateTime, type TemporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalCalendarWithISODefault } from "./temporal-calendar-identifier.js";
import { isSandboxTemporalPlainTime } from "../temporal-plain-time.js";
import { isSandboxTemporalPlainMonthDay } from "../temporal-plain-month-day.js";
import { isSandboxTemporalPlainYearMonth } from "../temporal-plain-year-month.js";
import { isSandboxTemporalPlainDate, temporalPlainDateFields } from "../temporal-plain-date.js";
import { isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";

export async function readTemporalPlainDateTime(input: SandboxValue, options: SandboxValue, budget: Budget, context?: SandboxCallContext, baseFields?: TemporalPlainDateTimeFields): Promise<SandboxTemporalPlainDateTime> {
  const normalized: Record<string, string | number> = Object.create(null);
  let fields: TemporalPlainDateTimeFields | undefined;
  let current: SandboxValue;
  const release = retainValues(budget, () => [input, options, normalized, fields, current, baseFields]);
  try {
    if (baseFields !== undefined) {
      if (isSandboxTemporalPlainYearMonth(input) || isSandboxTemporalPlainMonthDay(input) || input === null || typeof input !== "object" || isSandboxTemporalPlainDateTime(input) || isSandboxTemporalPlainTime(input) || isSandboxTemporalPlainDate(input) || isSandboxTemporalZonedDateTime(input))
        throw new TypeError("PlainDateTime with requires a partial date-time object.");
      // Instant and Duration are valid partial objects if they carry relevant fields.
      for (const name of ["calendar", "timeZone"]) {
        current = await sandboxGetProperty(input, name, input, budget, context);
        if (current !== undefined) throw new TypeError("Partial date-time objects cannot specify calendar or timeZone.");
      }
    }
    if (isSandboxTemporalPlainDateTime(input)) fields = temporalPlainDateTimeFields(input);
    else if (isSandboxTemporalZonedDateTime(input)) {
      const zoned = temporalZonedDateTimeFields(input);
      fields = hostTemporalPlainDateTimeFields(new Backend.ZonedDateTime(zoned.epochNanoseconds, zoned.timeZone, zoned.calendar).toPlainDateTime())!;
    }
    else if (isSandboxTemporalPlainDate(input)) fields = {
      ...temporalPlainDateFields(input), hour: 0, minute: 0, second: 0,
      millisecond: 0, microsecond: 0, nanosecond: 0
    };
    else if (typeof input === "string") {
      budget.visitNode(input.length);
      validateTemporalStringOffsets(input);
      let source = input;
      let originalYear: number | undefined;
      const digits = input.slice(1, 7);
      if ((input[0] === "+" || input[0] === "-") && digits.length === 6 &&
          [...digits].every(char => char >= "0" && char <= "9") && input.slice(0, 7) !== "-000000") {
        originalYear = Number(input.slice(0, 7));
        // ISO leap-day validity repeats every 400 years. Parse expanded years
        // in an equivalent in-range cycle, then restore the original ISO year.
        // This separates grammar/calendar errors from the range check that must
        // follow guest option reads. Calendar annotations do not change ISO input.
        const representative = 2000 + ((originalYear % 400) + 400) % 400;
        source = budget.allocateString(`+${String(representative).padStart(6, "0")}${input.slice(7)}`);
      }
      const parsed = hostTemporalPlainDateTimeFields(Backend.PlainDateTime.from(source))!;
      fields = originalYear === undefined ? parsed : { ...parsed, isoYear: originalYear };
    } else {
      if (input === null || typeof input !== "object") throw new TypeError("PlainDateTime input must be a string or object.");
      const calendarId = baseFields?.calendar ?? await readTemporalCalendarWithISODefault(input, budget, context);
      const calendar = new Backend.PlainDate(2000, 1, 1, calendarId);
      if (baseFields === undefined) normalized.calendar = calendar.calendarId;
      const keys = ["day", ...(calendar.era === undefined ? [] : ["era", "eraYear"]), "hour", "microsecond", "millisecond", "minute", "month", "monthCode", "nanosecond", "second", "year"];
      for (const key of keys) {
        current = await sandboxGetProperty(input, key, input, budget, context);
        if (current === undefined) continue;
        if (key === "era") normalized[key] = await sandboxString(current, budget, context);
        else if (key === "monthCode") {
          if (current !== null && typeof current === "object") current = await objectToPrimitive(current, budget, context, new Set(), "string");
          if (typeof current !== "string") throw new TypeError("monthCode must be a string.");
          budget.visitNode(current.length);
          const digits = current.slice(1, 3);
          if ((current.length !== 3 && !(current.length === 4 && current[3] === "L")) || current[0] !== "M" ||
              [...digits].some(char => char < "0" || char > "9") || (digits === "00" && current.length === 3))
            throw new RangeError("Invalid month code.");
          normalized[key] = current;
        } else {
          const number = Math.trunc(await sandboxNumber(current, budget, context));
          if (!Number.isFinite(number) || ((key === "day" || key === "month") && number <= 0))
            throw new RangeError(`Invalid PlainDateTime ${key}.`);
          normalized[key] = number === 0 ? 0 : number;
        }
      }
      if (baseFields !== undefined && Object.keys(normalized).length === 0)
        throw new TypeError("PlainDateTime with requires at least one date or time field.");
    }
    if (options !== undefined && (options === null || typeof options !== "object")) throw new TypeError("PlainDateTime options must be an object.");
    current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
    const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
    if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
    // Keep absent required fields absent so backend validation retains its order.
    if (fields === undefined) {
      const result = baseFields === undefined
        ? Backend.PlainDateTime.from(normalized as Backend.DateTimeLikeObject & Record<string, string | number>, { overflow })
        : new Backend.PlainDateTime(baseFields.isoYear, baseFields.isoMonth, baseFields.isoDay,
          baseFields.hour, baseFields.minute, baseFields.second, baseFields.millisecond, baseFields.microsecond,
          baseFields.nanosecond, baseFields.calendar).with(normalized, { overflow });
      fields = hostTemporalPlainDateTimeFields(result)!;
    }
    return createSandboxTemporalPlainDateTime(fields);
  } finally { release(); }
}
