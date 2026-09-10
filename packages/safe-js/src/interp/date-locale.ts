import type { Budget } from "./budget.js";
import { canonicalizeIntlOffsetZone } from "./intl-offset-zone.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "./intl-options.js";
import { retainValues } from "./resources.js";
import { sandboxNumber, sandboxString } from "./string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

const NativeDateTimeFormat = Intl.DateTimeFormat;

// ECMA-402 CreateDateTimeFormat: resolution options, zone, components, styles.
// Read and validate each property before touching the next guest property.
const dateTimeOptions: ReadonlyArray<readonly [string, IntlOptionType | "number" | "zone"]> = [
  ["localeMatcher", ["lookup", "best fit"]],
  ["calendar", "unicodeType"],
  ["numberingSystem", "unicodeType"],
  ["hour12", "boolean"],
  ["hourCycle", ["h11", "h12", "h23", "h24"]],
  ["timeZone", "zone"],
  ["weekday", ["narrow", "short", "long"]],
  ["era", ["narrow", "short", "long"]],
  ["year", ["2-digit", "numeric"]],
  ["month", ["2-digit", "numeric", "narrow", "short", "long"]],
  ["day", ["2-digit", "numeric"]],
  ["dayPeriod", ["narrow", "short", "long"]],
  ["hour", ["2-digit", "numeric"]],
  ["minute", ["2-digit", "numeric"]],
  ["second", ["2-digit", "numeric"]],
  ["fractionalSecondDigits", "number"],
  ["timeZoneName", ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]],
  ["formatMatcher", ["basic", "best fit"]],
  ["dateStyle", ["full", "long", "medium", "short"]],
  ["timeStyle", ["full", "long", "medium", "short"]]
];

export async function readDateTimeFormatOptions(
  input: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): Promise<Record<string, string | number | boolean>> {
  const options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [input, options]);
  try {
    const inputOptions = intlOptionsObject(input, budget);
    for (const [key, type] of dateTimeOptions) {
      const value = await readIntlProperty(inputOptions, key, budget, context);
      if (value === undefined) continue;
      if (type === "number") {
        const number = await sandboxNumber(value, budget, context);
        if (!Number.isFinite(number) || number < 1 || number > 3)
          throw new RangeError("fractionalSecondDigits must be between 1 and 3.");
        options[key] = Math.floor(number);
      } else if (type === "zone") {
        const text = await sandboxString(value, budget, context);
        budget.visitNode(text.length);
        // Validate before accessing later guest options, independently of
        // host ICU support for fixed-offset identifiers.
        const offset = canonicalizeIntlOffsetZone(text);
        if (offset === undefined) new NativeDateTimeFormat("en", { timeZone: text });
        options[key] = offset ?? text;
      } else options[key] = await convertIntlOption(value, key, type, budget, context);
    }
    return options;
  } finally { release(); }
}

export async function formatDateLocale(
  name: string,
  time: number,
  args: readonly SandboxValue[],
  budget: Budget,
  context?: SandboxCallContext
): Promise<string> {
  if (Number.isNaN(time)) return budget.allocateString("Invalid Date");
  let locales: string[] = [];
  let options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [locales, options]);
  try {
    locales = await canonicalizeGuestLocales(args[0], budget, context);
    options = await readDateTimeFormatOptions(args[1], budget, context);
    const date = name !== "toLocaleTimeString";
    const clock = name !== "toLocaleDateString";
    if (options.dateStyle !== undefined || options.timeStyle !== undefined) {
      if (!date && options.dateStyle !== undefined || !clock && options.timeStyle !== undefined)
        throw new TypeError("Date/time style is incompatible with this locale method.");
    } else {
      const hasDate = date && ["weekday", "year", "month", "day"].some(key => options[key] !== undefined);
      const hasTime = clock && ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"].some(key => options[key] !== undefined);
      if (!hasDate && !hasTime) {
        if (date) for (const key of ["year", "month", "day"]) options[key] = "numeric";
        if (clock) for (const key of ["hour", "minute", "second"]) options[key] = "numeric";
      }
    }
    const formatter = new NativeDateTimeFormat(locales, options as Intl.DateTimeFormatOptions);
    return budget.allocateString(formatter.format(time));
  } finally { release(); }
}
