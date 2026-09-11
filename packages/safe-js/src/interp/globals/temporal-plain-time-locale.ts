import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { readDateTimeFormatOptions } from "../date-locale.js";
import { canonicalizeGuestLocales } from "../intl-options.js";
import { retainValues } from "../resources.js";
import type { TemporalPlainTimeFields } from "../temporal-plain-time.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

const NativeDateTimeFormat = Intl.DateTimeFormat;

export async function formatTemporalPlainTimeLocale(fields: TemporalPlainTimeFields, args: readonly SandboxValue[], budget: Budget, context?: SandboxCallContext) {
  let locales: string[] = [];
  let options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [fields, ...args, locales, options]);
  try {
    locales = await canonicalizeGuestLocales(args[0], budget, context);
    options = await readDateTimeFormatOptions(args[1], budget, context);
    // PlainTime keeps its wall-clock fields, independently of the validated
    // zone. Do not pass an ignored offset to older host formatters that cannot
    // represent it. Keep timeZoneName until style/component validation below.
    delete options.timeZone;
    // Validate style/component conflicts before removing irrelevant fields.
    // Only normalized primitives cross into the host formatter.
    new NativeDateTimeFormat(locales, options as Intl.DateTimeFormatOptions);
    if (options.dateStyle !== undefined) throw new TypeError("PlainTime does not support dateStyle.");
    const hasTime = ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"].some(key => options[key] !== undefined);
    const hasDate = ["weekday", "year", "month", "day"].some(key => options[key] !== undefined);
    if (options.timeStyle === undefined && hasDate && !hasTime)
      throw new TypeError("PlainTime formatting requires time components.");
    // GetDateTimeFormat with inherit=relevant selects time components even
    // from a mixed date/time request. The backend otherwise rejects that mix.
    for (const key of ["weekday", "era", "year", "month", "day"]) delete options[key];
    return budget.allocateString(Backend.PlainTime.from(fields).toLocaleString(locales, options as Intl.DateTimeFormatOptions));
  } finally { release(); }
}
