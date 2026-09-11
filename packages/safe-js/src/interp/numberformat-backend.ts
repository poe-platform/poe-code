import type { PortableFormatter, Options } from "./numberformat-portable.js";
import * as portableBackend from "./numberformat-portable.js";
import type { SandboxValue } from "./values.js";

const NativeNumberFormat = Intl.NumberFormat;
const modernNative = new NativeNumberFormat("en", { maximumFractionDigits: 0, ...{ roundingMode: "floor" } }).format(1.9) === "1" &&
  typeof Object.getOwnPropertyDescriptor(NativeNumberFormat.prototype, "formatRange")?.value === "function";
const portableFormatters = new WeakSet<object>();
type Formatter = Intl.NumberFormat | PortableFormatter;

export function createNumberFormatter(locales: string | string[], options: Options): Formatter {
  if (modernNative && options.style !== "unit" && !(options.style === "currency" && options.currencyDisplay === "name"))
    return new NativeNumberFormat(locales, options as Intl.NumberFormatOptions);
  const formatter = portableBackend.createPortableNumberFormatter(locales, options);
  portableFormatters.add(formatter);
  return formatter;
}

export function numberFormatterOptions(formatter: Formatter): Options {
  return portableFormatters.has(formatter) ? portableBackend.numberFormatterOptions(formatter as PortableFormatter) : { ...formatter.resolvedOptions() } as Options;
}

export function numberFormatterResult(formatter: Formatter, method: "format" | "formatToParts" | "formatRange" | "formatRangeToParts", values: Array<string | number | bigint>): SandboxValue {
  return portableFormatters.has(formatter) ? portableBackend.numberFormatterResult(formatter as PortableFormatter, method, values)
    : Reflect.apply(Reflect.get(formatter, method), formatter, values);
}
