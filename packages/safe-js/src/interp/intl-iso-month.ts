import type { SandboxValue } from "./values.js";

const NativeDateTimeFormat = Intl.DateTimeFormat;
const resolvedOptions = NativeDateTimeFormat.prototype.resolvedOptions;
const format = Object.getOwnPropertyDescriptor(NativeDateTimeFormat.prototype, "format")!.get!;
const methods = {
  formatToParts: NativeDateTimeFormat.prototype.formatToParts,
  formatRange: NativeDateTimeFormat.prototype.formatRange,
  formatRangeToParts: NativeDateTimeFormat.prototype.formatRangeToParts
};

/** Recover ICU's empty ISO standalone-long-month pattern, using its Gregorian month data. */
export function recoverMissingIsoMonth<T extends SandboxValue>(result: T, locales: string | string[],
  options: Record<string, string | number | boolean>, method: "format" | keyof typeof methods,
  epochs: () => number[]): T {
  if (result !== "" && !(Array.isArray(result) && result.length === 0)) return result;
  const resolved = Reflect.apply(resolvedOptions, new NativeDateTimeFormat(locales, options), []);
  if (resolved.calendar !== "iso8601" || resolved.month !== "long" ||
    Object.keys(resolved).some(key => !["locale", "calendar", "numberingSystem", "timeZone", "month"].includes(key))) return result;
  // ISO and Gregorian months coincide. Limit replacement to the broken empty
  // month-only pattern; do not replace ISO calendar, week rules or other fields.
  const fallback = new NativeDateTimeFormat(resolved.locale, { calendar: "gregory", month: "long",
    numberingSystem: resolved.numberingSystem, timeZone: resolved.timeZone });
  const values = epochs();
  return (method === "format" ? Reflect.apply(format, fallback, [])(values[0]) :
    Reflect.apply(methods[method], fallback, values)) as T;
}
