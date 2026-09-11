import { expect, it, vi } from "vitest";
import { createPortableNumberFormatter, numberFormatterResult } from "./numberformat-portable.js";
import { run } from "../run.js";

it("keeps portable unit words with their matching spacing patterns", () => {
  const native = Intl.NumberFormat.prototype.formatToParts;
  const spy = vi.spyOn(Intl.NumberFormat.prototype, "formatToParts").mockImplementation(function (value) {
    const parts = Reflect.apply(native, this, [value]);
    const options = this.resolvedOptions();
    if (options.style === "unit" && options.unit === "hour" && options.unitDisplay === "narrow")
      return [{ type: "integer", value: "1" }, { type: "literal", value: " " }, { type: "unit", value: "Std." }];
    return parts;
  });
  try {
    const formatter = createPortableNumberFormatter("de", { style: "unit", unit: "hour", unitDisplay: "narrow" });
    expect(numberFormatterResult(formatter, "format", [1])).toBe("1h");
  } finally { spy.mockRestore(); }
});

it.each([
  [{ style: "unit", unit: "hour", unitDisplay: "long" }, "10,000,000,000,000,000,001 hours"],
  [{ style: "currency", currency: "USD", currencyDisplay: "name", maximumFractionDigits: 0 }, "10,000,000,000,000,000,001 US dollars"]
] as const)("preserves exact plural selection for %j", async (options, expected) => {
  expect(await run(`return new Intl.NumberFormat('en',${JSON.stringify(options)}).format(10000000000000000001n)`))
    .toMatchObject({ ok: true, returnValue: expected });
});
