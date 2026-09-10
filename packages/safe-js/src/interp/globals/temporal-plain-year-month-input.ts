import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { objectToPrimitive, sandboxNumber, sandboxString } from "../string-coercion.js";
import { validateTemporalStringOffsets } from "../temporal-offset-validation.js";
import { createSandboxTemporalPlainYearMonth, hostTemporalPlainYearMonthFields, isSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields, type TemporalPlainYearMonthFields } from "../temporal-plain-year-month.js";
import { isSandboxTemporalPlainMonthDay } from "../temporal-plain-month-day.js";
import { isSandboxTemporalPlainDate } from "../temporal-plain-date.js";
import { isSandboxTemporalPlainDateTime } from "../temporal-plain-date-time.js";
import { isSandboxTemporalPlainTime } from "../temporal-plain-time.js";
import { isSandboxTemporalZonedDateTime } from "../temporal-zoned-date-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalCalendarIdentifier } from "./temporal-calendar-identifier.js";

export async function readTemporalPlainYearMonth(input: SandboxValue, options: SandboxValue, budget: Budget, context?: SandboxCallContext, baseFields?: TemporalPlainYearMonthFields) {
  const normalized: Record<string, string | number> = Object.create(null);
  let fields: TemporalPlainYearMonthFields | undefined;
  let current: SandboxValue;
  let parsedSource: string | undefined;
  const release = retainValues(budget, () => [input, options, normalized, fields, current, parsedSource, baseFields]);
  try {
    if (baseFields !== undefined) {
      if (input === null || typeof input !== "object" || isSandboxTemporalPlainYearMonth(input) || isSandboxTemporalPlainMonthDay(input) || isSandboxTemporalPlainDate(input) || isSandboxTemporalPlainDateTime(input) || isSandboxTemporalPlainTime(input) || isSandboxTemporalZonedDateTime(input))
        throw new TypeError("PlainYearMonth with requires a partial date object.");
      for (const name of ["calendar", "timeZone"]) {
        current = await sandboxGetProperty(input, name, input, budget, context);
        if (current !== undefined) throw new TypeError("Partial date objects cannot specify calendar or timeZone.");
      }
    }
    if (isSandboxTemporalPlainYearMonth(input)) fields = temporalPlainYearMonthFields(input);
    else if (typeof input === "string") {
      budget.visitNode(input.length);
      validateTemporalStringOffsets(input);
      parsedSource = input;
      const digits = input.slice(1, 7);
      if ((input[0] === "+" || input[0] === "-") && digits.length === 6 &&
          [...digits].every(char => char >= "0" && char <= "9") && input.slice(0, 7) !== "-000000") {
        const year = Number(input.slice(0, 7));
        const representative = 2000 + ((year % 400) + 400) % 400;
        // Validate grammar/calendar before guest options, but defer actual
        // representable-range checks until after those options.
        parsedSource = budget.allocateString(`+${String(representative).padStart(6, "0")}${input.slice(7)}`);
      }
      Backend.PlainYearMonth.from(parsedSource);
    } else {
      if (input === null || typeof input !== "object") throw new TypeError("PlainYearMonth input must be a string or object.");
      current = baseFields !== undefined ? undefined : isSandboxTemporalPlainMonthDay(input) || isSandboxTemporalPlainDate(input) || isSandboxTemporalPlainDateTime(input) || isSandboxTemporalZonedDateTime(input)
          ? input : await sandboxGetProperty(input, "calendar", input, budget, context);
      const calendarId = baseFields?.calendar ?? readTemporalCalendarIdentifier(current === undefined ? "iso8601" : current, budget);
      if (baseFields === undefined) normalized.calendar = calendarId;
      const calendar = new Backend.PlainDate(2000, 1, 1, calendarId);
      for (const key of [...(calendar.era === undefined ? [] : ["era", "eraYear"]), "month", "monthCode", "year"]) {
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
          if (!Number.isFinite(number) || (key === "month" && number <= 0))
            throw new RangeError(`Invalid PlainYearMonth ${key}.`);
          normalized[key] = number === 0 ? 0 : number;
        }
      }
    }
    if (baseFields !== undefined && Object.keys(normalized).length === 0)
      throw new TypeError("PlainYearMonth with requires at least one year-month field.");
    if (options !== undefined && (options === null || typeof options !== "object")) throw new TypeError("PlainYearMonth options must be an object.");
    current = options === undefined ? undefined : await sandboxGetProperty(options, "overflow", options, budget, context);
    const overflow = current === undefined ? "constrain" : await sandboxString(current, budget, context);
    if (overflow !== "constrain" && overflow !== "reject") throw new RangeError("Invalid Temporal overflow option.");
    if (fields === undefined) {
      const value = baseFields === undefined
        ? Backend.PlainYearMonth.from(typeof input === "string" ? input : normalized as Backend.DateLikeObject & Record<string, string | number>, { overflow })
        : new Backend.PlainYearMonth(baseFields.isoYear, baseFields.isoMonth, baseFields.calendar, baseFields.isoDay).with(normalized, { overflow });
      fields = hostTemporalPlainYearMonthFields(value)!;
    }
    return createSandboxTemporalPlainYearMonth(fields);
  } finally { release(); }
}
