import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "../temporal-plain-date-time.js";
import { isSandboxTemporalPlainDate, temporalPlainDateFields } from "../temporal-plain-date.js";
import { isSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields } from "../temporal-plain-month-day.js";
import { isSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields } from "../temporal-plain-year-month.js";
import { isSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../temporal-zoned-date-time.js";
import { parseTemporalCalendarString } from "../temporal-time-zone-string.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";

export async function readTemporalCalendarWithISODefault(value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<string> {
  if (isSandboxTemporalPlainDate(value) || isSandboxTemporalPlainDateTime(value) ||
      isSandboxTemporalPlainMonthDay(value) || isSandboxTemporalPlainYearMonth(value) ||
      isSandboxTemporalZonedDateTime(value)) return readTemporalCalendarIdentifier(value, budget);
  let calendar: SandboxValue;
  const release = retainValues(budget, () => [value, calendar]);
  try {
    calendar = await sandboxGetProperty(value, "calendar", value, budget, context);
    return calendar === undefined ? "iso8601" : readTemporalCalendarIdentifier(calendar, budget);
  } finally { release(); }
}

export function readTemporalCalendarIdentifier(value: SandboxValue, budget: Budget): string {
  if (isSandboxTemporalPlainYearMonth(value)) return temporalPlainYearMonthFields(value).calendar;
  if (isSandboxTemporalPlainMonthDay(value)) return temporalPlainMonthDayFields(value).calendar;
  if (isSandboxTemporalZonedDateTime(value)) return temporalZonedDateTimeFields(value).calendar;
  if (isSandboxTemporalPlainDateTime(value)) return temporalPlainDateTimeFields(value).calendar;
  if (isSandboxTemporalPlainDate(value)) return temporalPlainDateFields(value).calendar;
  if (typeof value !== "string") throw new TypeError("Calendar must be a string or calendar-bearing Temporal value.");
  budget.visitNode(value.length);
  const identifier = parseTemporalCalendarString(value);
  return budget.allocateString(new Backend.PlainDate(2000, 1, 1, identifier).calendarId);
}
