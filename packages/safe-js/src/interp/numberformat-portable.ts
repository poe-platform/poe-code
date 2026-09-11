import { NumberFormat as PortableNumberFormat } from "../intl-data/dist/numberformat-engine.js";
import { localeData } from "../intl-data/dist/numberformat.js";
import type { SandboxValue } from "./values.js";
import { addNumberingSystem, localizeNumberParts } from "./numberformat-numbering.js";

export type Options = Record<string, string | number | boolean>;
export type PortableFormatter = InstanceType<typeof PortableNumberFormat>;
type Formatter = PortableFormatter;
type Part = { type: string; value: string; source: "startRange" | "endRange" | "shared" };
const NativeNumberFormat = Intl.NumberFormat;
const portableLocales = new WeakMap<Formatter, string>();

export function createPortableNumberFormatter(locales: string | string[], options: Options): Formatter {
  const resolution = new NativeNumberFormat(locales, {
    localeMatcher: options.localeMatcher as "lookup" | "best fit" | undefined,
    numberingSystem: options.numberingSystem as string | undefined
  }).resolvedOptions();
  const locale = new Intl.Locale(resolution.locale);
  let selected = locale.baseName;
  if (!Object.hasOwn(localeData, selected)) selected = locale.minimize().baseName;
  while (!Object.hasOwn(localeData, selected) && selected.includes("-")) selected = selected.slice(0, selected.lastIndexOf("-"));
  if (!Object.hasOwn(localeData, selected)) throw new RangeError(`Missing NumberFormat locale data for ${resolution.locale}.`);
  if (!PortableNumberFormat.availableLocales.has(selected)) PortableNumberFormat.__addLocaleData(localeData[selected]!());
  addNumberingSystem(PortableNumberFormat.localeData[selected]!, resolution.locale, resolution.numberingSystem);
  const formatter = new PortableNumberFormat(resolution.locale, { ...options, numberingSystem: resolution.numberingSystem });
  portableLocales.set(formatter, resolution.locale);
  return formatter;
}

export function numberFormatterOptions(formatter: Formatter): Options {
  const { roundingPriority, trailingZeroDisplay, ...resolved } = formatter.resolvedOptions() as unknown as Options;
  const options = { ...resolved, roundingPriority, trailingZeroDisplay } as Options;
  const locale = portableLocales.get(formatter);
  if (locale !== undefined) options.locale = locale;
  return options;
}

export function numberFormatterResult(formatter: Formatter, method: "format" | "formatToParts" | "formatRange" | "formatRangeToParts", values: Array<string | number | bigint>): SandboxValue {
  values = values.map(value => {
    if (typeof value !== "string") return value;
    const number = Number(value);
    return !Number.isFinite(number) || number === 0 ? number : value;
  });
  const options = numberFormatterOptions(formatter);
  if (method === "format" || method === "formatToParts") {
    const raw = Reflect.apply(formatter.formatToParts, formatter, values) as Array<{type: string; value: string}>;
    const parts = localizeNumberParts(raw, options.locale as string, options);
    return method === "format" ? parts.map(part => part.value).join("") : parts;
  }
  const raw = Reflect.apply(Reflect.get(formatter, "formatRangeToParts"), formatter, values) as Part[];
  const parts = raw.map(({ type, value, source }) => ({ type, value, source }));
  const approximation = parts.findIndex(part => part.type === "approximatelySign");
  if (approximation >= 0) parts.unshift(...parts.splice(approximation, 1));
  else {
    const first = Reflect.apply(formatter.formatToParts, formatter, [values[0]]) as Array<{type: string; value: string}>;
    const second = Reflect.apply(formatter.formatToParts, formatter, [values[1]]) as Array<{type: string; value: string}>;
    if ([first, second].some(endpoint => !endpoint.some(part => ["integer", "nan", "infinity"].includes(part.type)))) {
      // A unit-only pattern can encode the quantity itself (e.g. Arabic one or
      // two). It is not a redundant affix that range collapsing may discard.
      const separator = parts.find(part => part.source === "shared" && part.type === "literal");
      if (separator === undefined) throw new TypeError("Missing number range separator.");
      const localized = [
        ...localizeNumberParts(first, options.locale as string, options).map(part => ({ ...part, source: "startRange" })),
        separator,
        ...localizeNumberParts(second, options.locale as string, options).map(part => ({ ...part, source: "endRange" }))
      ];
      return method === "formatRange" ? localized.map(part => part.value).join("") : localized;
    }
    const start = parts.filter(part => part.source === "startRange");
    const end = parts.filter(part => part.source === "endRange");
    const removedStart = first.length - start.length;
    const removedEnd = second.length - end.length;
    // The backend collapses a start suffix or an end prefix but leaves the
    // surviving counterpart's original attribution. Mark only those parts.
    if (removedStart > 0) for (let index = Math.max(0, end.length - removedStart); index < end.length; index++) end[index]!.source = "shared";
    if (removedEnd > 0) for (let index = 0; index < Math.min(removedEnd, start.length); index++) start[index]!.source = "shared";
  }
  const localized = localizeNumberParts(parts, options.locale as string, options);
  return method === "formatRange" ? localized.map(part => part.value).join("") : localized;
}
