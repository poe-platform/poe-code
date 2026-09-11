import { DurationFormat } from "@formatjs/intl-durationformat";

const NativeNumberFormat = Intl.NumberFormat;
const NativeLocale = Intl.Locale;
const patterns = new Map(Object.entries(DurationFormat.localeData).map(([locale, data]) => {
  if (data === undefined) throw new TypeError(`Missing duration data for ${locale}.`);
  return [locale, Object.freeze({ ...data.digitalFormat })] as const;
}));

export function resolveDurationLocale(locales: string[], options: { localeMatcher?: "lookup" | "best fit"; numberingSystem?: string }) {
  const { locale, numberingSystem } = new NativeNumberFormat(locales, options).resolvedOptions();
  const tag = new NativeLocale(locale);
  let selected = tag.baseName;
  if (!patterns.has(selected)) selected = tag.minimize().baseName;
  while (!patterns.has(selected) && selected.includes("-")) selected = selected.slice(0, selected.lastIndexOf("-"));
  const pattern = patterns.get(selected);
  if (pattern === undefined) throw new RangeError(`Missing DurationFormat locale data for ${locale}.`);
  const separator = pattern[numberingSystem] ?? pattern.default;
  if (separator === undefined) throw new TypeError("Missing duration separator.");
  return { locale, numberingSystem, separator };
}
