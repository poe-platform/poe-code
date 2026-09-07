import type { Budget } from "./budget.js";
import { canonicalizeGuestLocales, convertIntlOption, intlOptionsObject, readIntlProperty, type IntlOptionType } from "./intl-options.js";
import { retainValues } from "./resources.js";
import { sandboxNumber, sandboxString } from "./string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "./values.js";

const NativeNumberFormat = Intl.NumberFormat;
const roundingIncrements = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

export async function formatNumberLocale(value: number | bigint, args: readonly SandboxValue[], budget: Budget, context?: SandboxCallContext): Promise<string> {
  let locales: string[] = [];
  const options: Record<string, string | number | boolean> = Object.create(null);
  const digits: Record<string, SandboxValue> = Object.create(null);
  const release = retainValues(budget, () => [value, locales, options, digits]);
  const allocation = {};
  try {
    locales = await canonicalizeGuestLocales(args[0], budget, context);
    const input = intlOptionsObject(args[1], budget);
    const readString = async (key: string, type?: IntlOptionType): Promise<string | undefined> => {
      const raw = await readIntlProperty(input, key, budget, context);
      if (raw === undefined) return undefined;
      const text = type === undefined ? await sandboxString(raw, budget, context)
        : await convertIntlOption(raw, key, type, budget, context) as string;
      if (type === undefined) budget.visitNode(text.length);
      options[key] = text;
      return text;
    };
    const numberOption = async (raw: SandboxValue, key: string, minimum: number, maximum: number, fallback?: number): Promise<number | undefined> => {
      if (raw === undefined) return fallback;
      const number = await sandboxNumber(raw, budget, context);
      if (!Number.isFinite(number) || number < minimum || number > maximum)
        throw new RangeError(`Invalid ${key} option.`);
      return Math.floor(number);
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
    } else new NativeNumberFormat("en", { style: "unit", unit });
    await readString("unitDisplay", ["short", "narrow", "long"]);
    const notation = await readString("notation", ["standard", "scientific", "engineering", "compact"]) ?? "standard";

    let minimumDefault = 0;
    let maximumDefault = style === "percent" ? 0 : 3;
    if (style === "currency" && notation === "standard") {
      const currencyDefaults = new NativeNumberFormat("en", { style: "currency", currency }).resolvedOptions();
      minimumDefault = currencyDefaults.minimumFractionDigits!;
      maximumDefault = currencyDefaults.maximumFractionDigits!;
    }
    options.minimumIntegerDigits = (await numberOption(await readIntlProperty(input, "minimumIntegerDigits", budget, context), "minimumIntegerDigits", 1, 21, 1))!;
    for (const key of ["minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits"])
      digits[key] = await readIntlProperty(input, key, budget, context);
    const increment = (await numberOption(await readIntlProperty(input, "roundingIncrement", budget, context), "roundingIncrement", 1, 5000, 1))!;
    if (!roundingIncrements.includes(increment)) throw new RangeError("Invalid roundingIncrement option.");
    options.roundingIncrement = increment;
    await readString("roundingMode", ["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"]);
    const priority = await readString("roundingPriority", ["auto", "morePrecision", "lessPrecision"]) ?? "auto";
    await readString("trailingZeroDisplay", ["auto", "stripIfInteger"]);

    if (increment !== 1) maximumDefault = minimumDefault;
    const hasSignificant = digits.minimumSignificantDigits !== undefined || digits.maximumSignificantDigits !== undefined;
    const hasFraction = digits.minimumFractionDigits !== undefined || digits.maximumFractionDigits !== undefined;
    const needSignificant = priority !== "auto" || hasSignificant;
    const needFraction = priority !== "auto" || !(hasSignificant || !hasFraction && notation === "compact");
    if (needSignificant) {
      const minimum = (await numberOption(digits.minimumSignificantDigits, "minimumSignificantDigits", 1, 21, 1))!;
      options.minimumSignificantDigits = minimum;
      options.maximumSignificantDigits = (await numberOption(digits.maximumSignificantDigits, "maximumSignificantDigits", minimum, 21, 21))!;
    }
    if (needFraction) {
      let minimum = await numberOption(digits.minimumFractionDigits, "minimumFractionDigits", 0, 100);
      let maximum = await numberOption(digits.maximumFractionDigits, "maximumFractionDigits", 0, 100);
      if (minimum === undefined && maximum === undefined) {
        minimum = minimumDefault;
        maximum = maximumDefault;
      } else if (minimum === undefined) minimum = Math.min(minimumDefault, maximum!);
      else if (maximum === undefined) maximum = Math.max(maximumDefault, minimum);
      if (minimum > maximum!) throw new RangeError("minimumFractionDigits exceeds maximumFractionDigits.");
      options.minimumFractionDigits = minimum;
      options.maximumFractionDigits = maximum!;
    }
    // Validate rounding combinations before any later guest option access.
    new NativeNumberFormat(locales, options as Intl.NumberFormatOptions);
    await readString("compactDisplay", ["short", "long"]);
    const grouping = await readIntlProperty(input, "useGrouping", budget, context);
    if (grouping !== undefined) options.useGrouping = grouping === true ? true : !grouping ? false
      : await convertIntlOption(grouping, "useGrouping", ["min2", "auto", "always", "true", "false"], budget, context);
    await readString("signDisplay", ["auto", "never", "always", "exceptZero", "negative"]);

    const size = typeof value === "bigint" ? value.toString(16).length * 4 : 64;
    budget.visitNode(size);
    budget.setRetainedDataUsage(allocation, size);
    const formatter = new NativeNumberFormat(locales, options as Intl.NumberFormatOptions);
    return budget.allocateString(formatter.format(value));
  } finally {
    budget.setRetainedDataUsage(allocation, 0);
    release();
  }
}
