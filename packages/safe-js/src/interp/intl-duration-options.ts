import type { Budget } from "./budget.js";
import { convertIntlOption, intlOptionsObject, readIntlProperty } from "./intl-options.js";
import { resolveDurationLocale } from "./intl-duration-locale.js";
import { sandboxNumber } from "./string-coercion.js";
import { retainValues } from "./resources.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

export async function readDurationOptions(value: SandboxValue, locales: string[], budget: Budget, context?: SandboxCallContext) {
  if (value !== undefined && (value === null || typeof value !== "object")) throw new TypeError("DurationFormat options must be an object.");
  const input = intlOptionsObject(value, budget);
  const converted: Record<string, string> = {};
  const units: Record<string, { style: string; display: string }> = {};
  let raw: SandboxValue;
  const release = retainValues(budget, () => [input, locales, converted, units, raw]);
  try {
    for (const [key, type] of [["localeMatcher", ["lookup", "best fit"]], ["numberingSystem", "unicodeType"]] as const) {
      raw = await readIntlProperty(input, key, budget, context);
      if (raw !== undefined) converted[key] = await convertIntlOption(raw, key, type, budget, context) as string;
    }
    const locale = resolveDurationLocale(locales, { localeMatcher: converted.localeMatcher as "lookup" | "best fit" | undefined, numberingSystem: converted.numberingSystem });
    raw = await readIntlProperty(input, "style", budget, context);
    const style = raw === undefined ? "short" : await convertIntlOption(raw, "style", ["long", "short", "narrow", "digital"], budget, context) as string;
    let previous = "";
    for (const unit of ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds", "microseconds", "nanoseconds"]) {
      units[unit] = await readDurationUnitOptions(input, unit, style, previous, budget, context);
      if (["hours", "minutes", "seconds", "milliseconds", "microseconds"].includes(unit)) previous = units[unit]!.style;
    }
    raw = await readIntlProperty(input, "fractionalDigits", budget, context);
    let fractionalDigits: number | undefined;
    if (raw !== undefined) {
      const number = await sandboxNumber(raw, budget, context);
      if (Number.isNaN(number) || number < 0 || number > 9) throw new RangeError("Invalid duration fractionalDigits.");
      fractionalDigits = Math.floor(number);
    }
    return { ...locale, style, units, fractionalDigits };
  } finally { release(); }
}

export async function readDurationUnitOptions(input: SandboxValue, unit: string, base: string, previous: string, budget: Budget, context?: SandboxCallContext) {
  const subsecond = ["milliseconds", "microseconds", "nanoseconds"].includes(unit);
  const clock = ["hours", "minutes", "seconds"].includes(unit);
  const styles = ["long", "short", "narrow", ...(clock || subsecond ? ["numeric"] : []), ...(clock ? ["2-digit"] : [])];
  let raw: SandboxValue;
  let style: string | undefined;
  const release = retainValues(budget, () => [input, raw, style]);
  try {
    raw = await readIntlProperty(input, unit, budget, context);
    style = raw === undefined ? undefined : await convertIntlOption(raw, unit, styles, budget, context) as string;
    let defaultDisplay = "always";
    if (style === undefined) {
      if (base === "digital") {
        style = clock || subsecond ? "numeric" : "short";
        if (!clock) defaultDisplay = "auto";
      } else if (["numeric", "2-digit", "fractional"].includes(previous)) {
        style = "numeric";
        if (unit !== "minutes" && unit !== "seconds") defaultDisplay = "auto";
      } else {
        style = base;
        defaultDisplay = "auto";
      }
    }
    if (style === "numeric" && subsecond) {
      style = "fractional";
      defaultDisplay = "auto";
    }
    raw = await readIntlProperty(input, `${unit}Display`, budget, context);
    const display = raw === undefined ? defaultDisplay
      : await convertIntlOption(raw, `${unit}Display`, ["always", "auto"], budget, context) as string;
    if (display === "always" && style === "fractional" ||
        previous === "fractional" && style !== "fractional" ||
        ["numeric", "2-digit"].includes(previous) && !["numeric", "2-digit", "fractional"].includes(style))
      throw new RangeError("Incompatible duration unit style or display.");
    if (["minutes", "seconds"].includes(unit) && ["numeric", "2-digit"].includes(previous)) style = "2-digit";
    return { style, display };
  } finally { release(); }
}
