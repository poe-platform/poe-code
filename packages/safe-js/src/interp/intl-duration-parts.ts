import { BigDecimal } from "@formatjs/bigdecimal";
import { createPortableNumberFormatter, numberFormatterResult, type Options } from "./numberformat-portable.js";
import type { readDurationRecord } from "./intl-duration-record.js";

export type DurationPart = { type: string; value: string; unit?: string };
export type DurationFormatSettings = {
  locale: string; numberingSystem: string; style: string; fractionalDigits?: number;
  units: Record<string, { style: string; display: string }>;
};
const NativeListFormat = Intl.ListFormat;

export function formatDurationParts(settings: DurationFormatSettings, duration: Awaited<ReturnType<typeof readDurationRecord>>, separator: string): DurationPart[] {
  const units = Object.keys(duration) as Array<keyof typeof duration>;
  const lists: DurationPart[][] = [];
  const negative = Object.values(duration).some(value => value < 0);
  let first = true;
  const amount = (index: number) => {
    let value = new BigDecimal(BigInt(duration[units[index]!]).toString());
    for (let next = index + 1; next < units.length && settings.units[units[next]!]!.style === "fractional"; next++)
      value = value.plus(new BigDecimal(BigInt(duration[units[next]!]).toString()).div(new BigDecimal(1000).pow(next - index)));
    return value;
  };
  const numberParts = (index: number, value: BigDecimal, numeric: boolean): DurationPart[] => {
    const unit = units[index]!;
    const style = settings.units[unit]!.style;
    const options: Options = { numberingSystem: settings.numberingSystem, signDisplay: first ? "auto" : "never" };
    if (numeric) {
      options.useGrouping = false;
      if (style === "2-digit") options.minimumIntegerDigits = 2;
    } else {
      options.style = "unit";
      options.unit = unit.slice(0, -1);
      options.unitDisplay = style;
    }
    if (settings.units[units[index + 1] ?? ""]?.style === "fractional") {
      options.minimumFractionDigits = settings.fractionalDigits ?? 0;
      options.maximumFractionDigits = settings.fractionalDigits ?? 9;
      options.roundingMode = "trunc";
    }
    const input = first && negative && value.isZero() ? -0 : value.toString();
    first = false;
    const formatter = createPortableNumberFormatter(settings.locale, options);
    const parts = numberFormatterResult(formatter, "formatToParts", [input]) as Array<{ type: string; value: string }>;
    return parts.map(part => ({ ...part, unit: unit.slice(0, -1) }));
  };
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!;
    const option = settings.units[unit]!;
    if (option.style === "fractional") break;
    if (["numeric", "2-digit"].includes(option.style)) {
      const hours = index <= 4 && (duration.hours !== 0 || settings.units.hours!.display === "always");
      const secondsValue = amount(6);
      const seconds = !secondsValue.isZero() || settings.units.seconds!.display === "always";
      const minutes = index <= 5 && (duration.minutes !== 0 || settings.units.minutes!.display === "always" || hours && seconds);
      const parts: DurationPart[] = [];
      for (const [clockIndex, displayed] of [[4, hours], [5, minutes], [6, seconds]] as const) {
        if (!displayed) continue;
        if (parts.length) parts.push({ type: "literal", value: separator });
        parts.push(...numberParts(clockIndex, clockIndex === 6 ? secondsValue : amount(clockIndex), true));
      }
      if (parts.length) lists.push(parts);
      break;
    }
    const value = amount(index);
    if (!value.isZero() || option.display === "always") lists.push(numberParts(index, value, false));
    if (settings.units[units[index + 1] ?? ""]?.style === "fractional") break;
  }
  const list = new NativeListFormat(settings.locale, { type: "unit", style: settings.style === "digital" ? "short" : settings.style as "long" | "short" | "narrow" });
  let index = 0;
  return list.formatToParts(lists.map(parts => parts.map(part => part.value).join("")))
    .flatMap(part => part.type === "element" ? lists[index++]! : [{ type: "literal", value: part.value }]);
}
