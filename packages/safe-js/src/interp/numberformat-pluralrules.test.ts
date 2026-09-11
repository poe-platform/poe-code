import { expect, it } from "vitest";
import { numberFormatIntl } from "./numberformat-pluralrules.js";

it.each([21, 100])("supports %i fraction digits in the private plural engine", maximumFractionDigits => {
  const value = new numberFormatIntl.PluralRules("en", { maximumFractionDigits });
  expect(value.resolvedOptions().maximumFractionDigits).toBe(maximumFractionDigits);
  expect(value.select(1)).toBe("one");
  expect(value.select(1.25)).toBe("other");
});

it("does not replace host Intl or its constructors", () => {
  const native = Intl.PluralRules;
  new numberFormatIntl.PluralRules("ru", { maximumFractionDigits: 100 });
  expect(Intl.PluralRules).toBe(native);
  expect(numberFormatIntl).not.toBe(Intl);
  expect(numberFormatIntl.PluralRules).not.toBe(Intl.PluralRules);
  expect(numberFormatIntl.Locale).toBe(Intl.Locale);
});

it.each([
  {},
  { maximumFractionDigits: 0, roundingMode: "floor" },
  { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingIncrement: 5 },
  { roundingPriority: "morePrecision", minimumFractionDigits: 2, maximumSignificantDigits: 3 },
  { roundingPriority: "lessPrecision", minimumFractionDigits: 2, maximumSignificantDigits: 3 },
  { trailingZeroDisplay: "stripIfInteger" }
])("reports the resolved rounding configuration: %j", options => {
  const fields = ["roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay"];
  const actual = new numberFormatIntl.PluralRules("en", options).resolvedOptions();
  const expected = new Intl.PluralRules("en", options).resolvedOptions();
  for (const field of fields)
    expect(Reflect.get(actual, field), field).toBe(Reflect.get(expected, field));
  expect(Object.keys(actual).slice(-4)).toEqual(fields);
});

it.each(["ar", "ru", "en", "sl", "ak", "fr"])("preserves fractional plural operands for %s", locale => {
  for (const options of [{}, { minimumFractionDigits: 3 }, { maximumFractionDigits: 2 }]) {
    const actual = new numberFormatIntl.PluralRules(locale, options);
    const expected = new Intl.PluralRules(locale, options);
    for (const value of [1, 1.1, 1.01, 1.001, 2.2, 0.01, -1.1, 3.14, 0.5])
      expect(actual.select(value), JSON.stringify({ locale, options, value })).toBe(expected.select(value));
  }
});

// CLDR defaults absent category pairs to the end category. French other/one
// is absent; preserve that documented fallback rather than Node's other result.
it.each([
  { locale: "en", toOne: "other" }, { locale: "fr", toOne: "one" },
  { locale: "ar", toOne: "other" }, { locale: "ru", toOne: "one" },
  { locale: "sl", toOne: "few" }
].flatMap(({ locale, toOne }) => [
  { start: Infinity, end: Infinity, expected: "other" },
  { start: -Infinity, end: Infinity, expected: "other" },
  { start: Infinity, end: 1, expected: toOne },
  { start: 1, end: Infinity, expected: "other" },
  { start: -Infinity, end: 1, expected: toOne },
  { start: 1, end: -Infinity, expected: "other" }
].map(values => ({ locale, ...values }))))("selects plural ranges with infinite endpoints: $locale/$start/$end", ({ locale, start, end, expected }) => {
  const actual = new numberFormatIntl.PluralRules(locale);
  expect(actual.selectRange(start, end)).toBe(expected);
});

it.each([[NaN, 1], [1, NaN], [NaN, Infinity], [-Infinity, NaN]])(
  "continues rejecting NaN endpoints: %s/%s", (start, end) => {
    expect(() => new numberFormatIntl.PluralRules("en").selectRange(start, end)).toThrow(RangeError);
  }
);
