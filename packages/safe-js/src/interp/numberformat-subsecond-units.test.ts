import { expect, it } from "vitest";
import { createPortableNumberFormatter, numberFormatterResult } from "./numberformat-portable.js";
import { numberFormatIntl } from "./numberformat-pluralrules.js";
import { run } from "../run.js";

const cases = ["en", "fr", "de", "ar", "ru", "ja"].flatMap(locale =>
  ["microsecond", "nanosecond", "meter-per-microsecond", "nanosecond-per-second"].flatMap(unit =>
    ["long", "short", "narrow"].map(unitDisplay => ({ locale, unit, unitDisplay })))).filter(
      ({ locale, unit, unitDisplay }) => !(locale === "de" && unit === "microsecond" && unitDisplay === "narrow"));

it.each([
  [1, [{ type: "integer", value: "1" }, { type: "unit", value: "μs" }]],
  [2, [{ type: "integer", value: "2" }, { type: "literal", value: " " }, { type: "unit", value: "μs" }]],
  [3.5, [{ type: "integer", value: "3" }, { type: "decimal", value: "," }, { type: "fraction", value: "5" }, { type: "literal", value: " " }, { type: "unit", value: "μs" }]],
  [-4, [{ type: "minusSign", value: "-" }, { type: "integer", value: "4" }, { type: "literal", value: " " }, { type: "unit", value: "μs" }]]
] as const)("preserves pinned CLDR 48 German narrow microsecond patterns for %s", (value, expected) => {
  const portable = createPortableNumberFormatter("de", { style: "unit", unit: "microsecond", unitDisplay: "narrow" });
  expect(numberFormatterResult(portable, "format", [value])).toBe(expected.map(part => part.value).join(""));
  expect(numberFormatterResult(portable, "formatToParts", [value])).toEqual(expected);
});

it.each(cases)("formats portable $locale $unit in $unitDisplay style", ({ locale, unit, unitDisplay }) => {
  const options = { style: "unit", unit, unitDisplay };
  const native = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions);
  const portable = createPortableNumberFormatter(locale, options);
  for (const value of [1, 2, 3.5, -4]) {
    expect(numberFormatterResult(portable, "format", [value])).toBe(native.format(value));
    expect(numberFormatterResult(portable, "formatToParts", [value])).toEqual(native.formatToParts(value));
  }
});

it.each([
  ["10000000000000000003", "few"],
  ["1.0000000000000000001", "other"]
])("retains exact Arabic plural operands: %s", (value, expected) => {
  expect(new numberFormatIntl.PluralRules("ar", { maximumFractionDigits: 20 }).select(value as unknown as number)).toBe(expected);
});

it.each(["is", "lv"])("retains long fractional operands for %s", locale => {
  const formatter = new numberFormatIntl.PluralRules(locale, { maximumFractionDigits: 20 });
  expect(formatter.select("0.1000000000000000001" as unknown as number)).toBe("one");
});

it("includes the new units exactly once in the sorted guest catalogue", async () => {
  expect(await run("const units=Intl.supportedValuesOf('unit');return [['microsecond','nanosecond'].every(unit=>units.filter(x=>x===unit).length===1),units.join(',')===units.slice().sort().join(',')]"))
    .toMatchObject({ ok: true, returnValue: [true, true] });
});

it.each([
  { style: "unit", unit: "microsecond", unitDisplay: "long", maximumFractionDigits: 0 },
  { style: "currency", currency: "RUB", currencyDisplay: "name", maximumFractionDigits: 0 }
])("preserves exact plural operands inside the private engine: %j", options => {
  const formatter = createPortableNumberFormatter("ru", options);
  const native = new Intl.NumberFormat("ru", options as Intl.NumberFormatOptions);
  const value = 10000000000000000001n;
  expect(Reflect.apply(formatter.format, undefined, [value])).toBe(native.format(value));
});
