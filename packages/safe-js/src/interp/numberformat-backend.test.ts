import { expect, it, vi } from "vitest";
import { createPortableNumberFormatter, numberFormatterOptions, numberFormatterResult } from "./numberformat-portable.js";

vi.mock("../intl-data/dist/numberformat.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { extractNumberFormatData } = await import("../../scripts/numberformat-data.mjs");
  const require = createRequire(import.meta.url);
  return { localeData: Object.fromEntries(["en", "de", "ja", "fr", "ru", "ar"].map(locale => {
    const filename = require.resolve(`@formatjs/intl-numberformat/locale-data/${locale}.js`);
    const value = extractNumberFormatData(readFileSync(filename, "utf8"), filename);
    return [locale, () => value];
  })) };
});

it("preserves exact BigInt plural selection for localized unit names", () => {
  const options = { style: "unit", unit: "meter", unitDisplay: "long" };
  const value = 10000000000000000001n;
  expect(numberFormatterResult(createPortableNumberFormatter(["ru"], options), "format", [value]))
    .toBe(new Intl.NumberFormat("ru", options as Intl.NumberFormatOptions).format(value));
});

it("retains Arabic fractional quantities in unit formatting and ranges", () => {
  const options = { style: "unit", unit: "meter" };
  const formatter = createPortableNumberFormatter("ar", options);
  const native = new Intl.NumberFormat("ar", options as Intl.NumberFormatOptions);
  for (const value of [1.1, 1.2, 3.14])
    expect(numberFormatterResult(formatter, "format", [value])).toBe(native.format(value));
  expect(numberFormatterResult(formatter, "formatRange", [1.1, 1.2])).toBe(native.formatRange(1.1, 1.2));
});

it.each([[1, 5], [5, 1]])("does not collapse an entire unit-only Arabic range endpoint: %j", (first, second) => {
  const options = { style: "unit", unit: "meter" };
  const formatter = createPortableNumberFormatter("ar", options);
  const native = new Intl.NumberFormat("ar", options as Intl.NumberFormatOptions);
  const parts = numberFormatterResult(formatter, "formatRangeToParts", [first, second]) as Array<{type: string; value: string; source: string}>;
  // Arabic one is expressed by the unit itself. Removing that unit removes the
  // whole endpoint, unlike merely collapsing a repeated suffix after a number.
  expect(parts.filter(part => part.source === "startRange").map(({type,value}) => ({type,value}))).toEqual(native.formatToParts(first));
  expect(parts.filter(part => part.source === "endRange").map(({type,value}) => ({type,value}))).toEqual(native.formatToParts(second));
});

it.each([21, 100])("formats %i fractional digits through the private plural engine", digits => {
  const formatter = createPortableNumberFormatter(["en"], { minimumFractionDigits: digits, maximumFractionDigits: digits });
  expect(numberFormatterResult(formatter, "format", [1.25])).toBe("1.25" + "0".repeat(digits - 2));
});

it.each([
  [{ maximumFractionDigits: 0, roundingMode: "floor" }, 1.9, "1"],
  [{ useGrouping: false }, "123456789012345678901234567890", "123456789012345678901234567890"],
  [{ minimumFractionDigits: 2, trailingZeroDisplay: "stripIfInteger" }, 1, "1"],
  [{ useGrouping: "min2" }, 1234, "1234"]
])("formats current numeric options without native v3 support: %j", (options, input, expected) => {
  const formatter = createPortableNumberFormatter(["en"], options);
  expect(numberFormatterResult(formatter, "format", [input])).toBe(expected);
});

it("prefixes the approximation sign and returns only standard part fields", () => {
  const formatter = createPortableNumberFormatter(["en"], { maximumFractionDigits: 0 });
  expect(numberFormatterResult(formatter, "formatRange", [1.1, 1.2])).toBe("~1");
  expect(numberFormatterResult(formatter, "formatRangeToParts", [1.1, 1.2])).toEqual([
    { type: "approximatelySign", value: "~", source: "shared" },
    { type: "integer", value: "1", source: "shared" }
  ]);
});

it("attributes a collapsed currency suffix to the entire range", () => {
  const formatter = createPortableNumberFormatter(["de"], { style: "currency", currency: "EUR" });
  const parts = numberFormatterResult(formatter, "formatRangeToParts", [1, 5]) as Array<{type: string; value: string; source: string}>;
  expect(parts.filter(part => part.type === "currency")).toEqual([{ type: "currency", value: "€", source: "shared" }]);
  expect(parts.every(part => Object.keys(part).join(",") === "type,value,source")).toBe(true);
});

it("loads multiple locales without changing host Intl", () => {
  const native = Intl.NumberFormat;
  for (const [locale, options, input] of [
    ["de", { style: "currency", currency: "EUR" }, 1234.5],
    ["ja", { style: "currency", currency: "JPY" }, 1234.5],
    ["fr", { style: "unit", unit: "meter", unitDisplay: "long" }, 2]
  ] as const) {
    expect(numberFormatterResult(createPortableNumberFormatter([locale], options), "format", [input]))
      .toBe(new Intl.NumberFormat(locale, options).format(input));
  }
  expect(Intl.NumberFormat).toBe(native);
});

it.each(["1e400", "9".repeat(400)])("applies StringIntlMV overflow before decimal expansion", input => {
  const formatter = createPortableNumberFormatter(["en"], {});
  expect(numberFormatterResult(formatter, "format", [input])).toBe("∞");
});

it("preserves the standard resolvedOptions property order", () => {
  expect(Object.keys(numberFormatterOptions(createPortableNumberFormatter(["en"], {}))))
    .toEqual(Object.keys(new Intl.NumberFormat("en").resolvedOptions()));
});

it.each(["0x20000000000001", "0b10001", "0o17", "  1234.5  ", "-1e-400"])("converts StringNumericLiteral inputs: %s", input => {
  expect(numberFormatterResult(createPortableNumberFormatter(["en"], { useGrouping: false }), "format", [input]))
    .toBe(new Intl.NumberFormat("en", { useGrouping: false }).format(input as unknown as number));
});

it.each(["arab", "deva", "mathbold", "lepc", "vaii"])("honors a supported non-default numbering system: %s", numberingSystem => {
  const options = { numberingSystem };
  const formatter = createPortableNumberFormatter(["en"], options);
  expect(numberFormatterOptions(formatter).numberingSystem).toBe(numberingSystem);
  expect(numberFormatterResult(formatter, "format", [1234.5]))
    .toBe(new Intl.NumberFormat("en", options).format(1234.5));
});

it.each(["arab", "arabext", "deva", "mathbold", "lepc", "vaii"])("preserves non-default numbering-system patterns across styles: %s", numberingSystem => {
  for (const style of [
    {}, { style: "currency", currency: "USD" }, { style: "currency", currency: "USD", currencySign: "accounting" },
    { style: "percent" }, { style: "unit", unit: "meter", unitDisplay: "long" }, { notation: "scientific" }
  ]) {
    const options = { ...style, numberingSystem };
    const formatter = createPortableNumberFormatter(["en"], options);
    const native = new Intl.NumberFormat("en", options as Intl.NumberFormatOptions);
    for (const input of [-1234.5, 1234.5, 0, -0, -0.00123])
      expect(numberFormatterResult(formatter, "format", [input]), JSON.stringify({ options, input }))
        .toBe(native.format(input));
  }
});
