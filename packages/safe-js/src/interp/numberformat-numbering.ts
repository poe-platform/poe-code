import { NumberFormat } from "../intl-data/dist/numberformat-engine.js";

type LocaleData = Parameters<typeof NumberFormat.__addLocaleData>[0]["data"];
const NativeNumberFormat = Intl.NumberFormat;

export function localizeNumberParts<T extends { type: string; value: string }>(parts: T[], locale: string, options: Record<string, string | number | boolean>): T[] {
  parts = parts.flatMap(part => {
    if (part.type !== "minusSign" && part.type !== "plusSign") return [part];
    const separated: T[] = [];
    for (const char of part.value) {
      const type = ["\u061c", "\u200e", "\u200f"].includes(char) ? "literal" : part.type;
      const previous = separated.at(-1);
      if (previous?.type === type) previous.value += char;
      else separated.push({ ...part, type, value: char });
    }
    return separated;
  });
  const numberingSystem = options.numberingSystem as string;
  if (numberingSystem === "latn") return parts;
  const digitFormatter = new NativeNumberFormat(locale, { numberingSystem, useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, digit) => digitFormatter.formatToParts(digit).find(part => part.type === "integer")!.value);
  const sourceFormatter = new NumberFormat(locale, { numberingSystem, useGrouping: false });
  const sourceDigits = Array.from({ length: 10 }, (_, digit) => sourceFormatter.formatToParts(digit).find(part => part.type === "integer")!.value);
  const result: T[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.type === "exponentMinusSign") {
      const reference = new NativeNumberFormat(locale, { numberingSystem, notation: "scientific" }).formatToParts(0.001);
      const minus = reference.findIndex(value => value.type === "exponentMinusSign");
      let start = minus;
      let end = minus + 1;
      while (start > 0 && reference[start - 1]!.type === "literal") start--;
      while (end < reference.length && reference[end]!.type === "literal") end++;
      for (const value of reference.slice(start, end)) result.push({ ...part, type: value.type, value: value.value });
      continue;
    }
    if (part.type === "exponentInteger" || part.type === "fraction") {
      result.push({ ...part, value: [...part.value].map(char => {
        const digit = char >= "0" && char <= "9" ? Number(char) : sourceDigits.indexOf(char);
        return digit < 0 ? char : digits[digit]!;
      }).join("") });
      continue;
    }
    if (part.type !== "integer") { result.push(part); continue; }
    let integer = part.value;
    while (index + 1 < parts.length && ["integer", "group"].includes(parts[index + 1]!.type)) {
      const next = parts[++index]!;
      if (next.type === "integer") integer += next.value;
    }
    // Joining before iterating code points repairs surrogate pairs split by the
    // backend's UTF-16 grouping. Native ICU only groups the already-rounded integer.
    const ascii = [...integer].map(char => {
      const digit = sourceDigits.indexOf(char);
      return digit < 0 ? char : String(digit);
    }).join("");
    const grouping = options.useGrouping;
    const formatter = new NativeNumberFormat(locale, { numberingSystem, maximumFractionDigits: 0,
      useGrouping: grouping !== false, minimumIntegerDigits: Math.min(21, ascii.length) });
    let grouped = formatter.formatToParts(BigInt(ascii)).filter(value => value.type === "integer" || value.type === "group");
    if (grouping === "always" || grouping === "min2") {
      const reference = new NativeNumberFormat(locale, { numberingSystem, maximumFractionDigits: 0 }).formatToParts(123456789012345n);
      const widths = reference.filter(value => value.type === "integer").map(value => [...value.value].length);
      const primary = widths.at(-1)!;
      const secondary = widths.at(-2) ?? primary;
      const separator = reference.find(value => value.type === "group")?.value;
      const chars = [...ascii].map(digit => digits[Number(digit)]!);
      const chunks: string[] = [];
      if (separator !== undefined && chars.length >= primary + (grouping === "min2" ? 2 : 1)) {
        chunks.unshift(chars.splice(-primary).join(""));
        while (chars.length > secondary) chunks.unshift(chars.splice(-secondary).join(""));
      }
      chunks.unshift(chars.join(""));
      grouped = chunks.flatMap((value, chunk) => chunk === 0 ? [{ type: "integer" as const, value }]
        : [{ type: "group" as const, value: separator! }, { type: "integer" as const, value }]);
    }
    for (const value of grouped) result.push({ ...part, type: value.type, value: value.value });
  }
  return result;
}

export function addNumberingSystem(data: LocaleData, locale: string, numberingSystem: string): void {
  if (data.nu.includes(numberingSystem)) return;
  const base = data.numbers.nu[0]!;
  const numberOptions = { numberingSystem };
  const decimal = new NativeNumberFormat(locale, numberOptions);
  const parts = decimal.formatToParts(-12345.6);
  const symbol = (source: Intl.NumberFormatPart[], type: Intl.NumberFormatPartTypes, fallback: string) => source.find(part => part.type === type)?.value ?? fallback;
  const symbols = { ...data.numbers.symbols[base]! };
  symbols.decimal = symbol(parts, "decimal", symbols.decimal);
  symbols.group = symbol(parts, "group", symbols.group);
  symbols.minusSign = symbol(parts, "minusSign", symbols.minusSign);
  symbols.plusSign = symbol(new NativeNumberFormat(locale, { ...numberOptions, signDisplay: "always" }).formatToParts(1), "plusSign", symbols.plusSign);
  symbols.percentSign = symbol(new NativeNumberFormat(locale, { ...numberOptions, style: "percent" }).formatToParts(1), "percentSign", symbols.percentSign);
  symbols.exponential = symbol(new NativeNumberFormat(locale, { ...numberOptions, notation: "scientific" }).formatToParts(1), "exponentSeparator", symbols.exponential);
  symbols.nan = symbol(decimal.formatToParts(NaN), "nan", symbols.nan);
  symbols.infinity = symbol(decimal.formatToParts(Infinity), "infinity", symbols.infinity);

  const pattern = (template: string, options: Intl.NumberFormatOptions) => {
    const start = [...template].findIndex(char => char === "#" || char === "0");
    let end = start;
    while (end < template.length && "#0,.".includes(template[end]!)) end++;
    if (start < 0) throw new TypeError("Invalid numeric locale pattern.");
    const numeric = template.slice(start, end);
    const formatter = new NativeNumberFormat(locale, { ...options, numberingSystem });
    return [12345.6, -12345.6].map(value => {
      let seenNumber = false;
      return formatter.formatToParts(value).map(part => {
        if (["integer", "group", "decimal", "fraction"].includes(part.type)) {
          if (seenNumber) return "";
          seenNumber = true;
          return numeric;
        }
        if (part.type === "currency") return "¤";
        if (part.type === "percentSign") return "%";
        if (part.type === "minusSign") return "-";
        if (part.type === "plusSign") return "+";
        return part.value;
      }).join("");
    }).join(";");
  };
  const baseDecimal = data.numbers.decimal[base]!;
  const baseCurrency = data.numbers.currency[base]!;
  data.numbers.symbols[numberingSystem] = symbols;
  data.numbers.decimal[numberingSystem] = { ...baseDecimal, standard: pattern(baseDecimal.standard, {}) };
  data.numbers.currency[numberingSystem] = {
    ...baseCurrency,
    standard: pattern(baseCurrency.standard, { style: "currency", currency: "USD" }),
    accounting: pattern(baseCurrency.accounting, { style: "currency", currency: "USD", currencySign: "accounting" })
  };
  data.numbers.percent[numberingSystem] = pattern(data.numbers.percent[base]!, { style: "percent" });
  data.nu.push(numberingSystem);
  data.numbers.nu.push(numberingSystem);
}
