import type { Budget } from "./budget.js";
import { createNumberFormatter, numberFormatterOptions, numberFormatterResult } from "./numberformat-backend.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "./intl-options.js";
import { retainValues } from "./resources.js";
import { sandboxString } from "./string-coercion.js";
import { readIntlDigitOptions } from "./intl-digit-options.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

export async function readNumberFormatOptions(inputValue: SandboxValue, locales: string[], budget: Budget, context?: SandboxCallContext): Promise<Record<string, string | number | boolean>> {
  const options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [inputValue, locales, options]);
  try {
    const input = intlOptionsObject(inputValue, budget);
    const readString = async (key: string, type?: IntlOptionType): Promise<string | undefined> => {
      const raw = await readIntlProperty(input, key, budget, context);
      if (raw === undefined) return undefined;
      const text = type === undefined ? await sandboxString(raw, budget, context)
        : await convertIntlOption(raw, key, type, budget, context) as string;
      if (type === undefined) budget.visitNode(text.length);
      options[key] = text;
      return text;
    };

    await readString("localeMatcher", ["lookup", "best fit"]);
    await readString("numberingSystem", "unicodeType");
    const style = await readString("style", ["decimal", "percent", "currency", "unit"]) ?? "decimal";
    const currency = await readString("currency");
    if (currency === undefined) {
      if (style === "currency") throw new TypeError("Currency formatting requires a currency.");
    } else if (currency.length !== 3 || ![...currency].every(char => char >= "A" && char <= "Z" || char >= "a" && char <= "z"))
      throw new RangeError("Invalid currency code.");
    await readString("currencyDisplay", ["code", "symbol", "narrowSymbol", "name"]);
    await readString("currencySign", ["standard", "accounting"]);
    const unit = await readString("unit");
    if (unit === undefined) {
      if (style === "unit") throw new TypeError("Unit formatting requires a unit.");
    } else createNumberFormatter("en", { style: "unit", unit });
    await readString("unitDisplay", ["short", "narrow", "long"]);
    const notation = await readString("notation", ["standard", "scientific", "engineering", "compact"]) ?? "standard";

    let minimumDefault = 0;
    let maximumDefault = style === "percent" ? 0 : 3;
    if (style === "currency" && notation === "standard") {
      const currencyDefaults = numberFormatterOptions(createNumberFormatter("en", { style: "currency", currency: currency! }));
      minimumDefault = currencyDefaults.minimumFractionDigits as number;
      maximumDefault = currencyDefaults.maximumFractionDigits as number;
    }
    Object.assign(options, await readIntlDigitOptions(input, { minimum: minimumDefault, maximum: maximumDefault, notation }, budget, context));
    // Validate rounding combinations before any later guest option access.
    createNumberFormatter(locales, options);
    await readString("compactDisplay", ["short", "long"]);
    const grouping = await readIntlProperty(input, "useGrouping", budget, context);
    if (grouping !== undefined) options.useGrouping = grouping === true ? true : !grouping ? false
      : await convertIntlOption(grouping, "useGrouping", ["min2", "auto", "always", "true", "false"], budget, context);
    await readString("signDisplay", ["auto", "never", "always", "exceptZero", "negative"]);
    return options;
  } finally { release(); }
}

export async function formatNumberLocale(value: number | bigint, args: readonly SandboxValue[], budget: Budget, context?: SandboxCallContext): Promise<string> {
  let locales: string[] = [];
  let options: Record<string, string | number | boolean> = Object.create(null);
  const release = retainValues(budget, () => [value, locales, options]);
  const allocation = {};
  try {
    locales = await canonicalizeGuestLocales(args[0], budget, context);
    options = await readNumberFormatOptions(args[1], locales, budget, context);
    const size = typeof value === "bigint" ? value.toString(16).length * 4 : 64;
    budget.visitNode(size);
    budget.setRetainedDataUsage(allocation, size);
    const formatter = createNumberFormatter(locales, options);
    return budget.allocateString(numberFormatterResult(formatter, "format", [value]) as string);
  } finally {
    budget.setRetainedDataUsage(allocation, 0);
    release();
  }
}
