import { expect, it } from "vitest";
import { createPortableNumberFormatter, numberFormatterResult } from "./numberformat-portable.js";

it.each(["ar", "fa", "he"].flatMap(locale => ["auto", "always"].map(signDisplay => ({ locale, signDisplay }))))("separates $locale bidirectional literals from signs ($signDisplay)", ({ locale, signDisplay }) => {
  const options = { style: "unit", unit: "meter", signDisplay };
  const portable = createPortableNumberFormatter(locale, options);
  const native = new Intl.NumberFormat(locale, options as Intl.NumberFormatOptions);
  for (const value of [-4, 4])
    expect(numberFormatterResult(portable, "formatToParts", [value])).toEqual(native.formatToParts(value));
});
