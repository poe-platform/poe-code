import type { LocaleServices } from "./contracts.js";
import { Decimal } from "./types/decimal.js";
import { CsvkitBlocked } from "./errors.js";

/** C printf formats are ungrouped; decimal patterns opt into comma grouping. */
export const portableLocale: LocaleServices = Object.freeze<LocaleServices>({
  profile: "C",
  timezone: "UTC",
  formatNumber(value, _locale, format, grouping) {
    if (format === "#,##0.###") {
      const decimal = Decimal.parse(value);
      if (decimal.special) return decimal.toString();
      let coefficient = decimal.coefficient;
      const shift = decimal.exponent + 3;
      if (shift >= 0) coefficient *= 10n ** BigInt(shift);
      else if (-shift > coefficient.toString().length) coefficient = 0n;
      else {
        const divisor = 10n ** BigInt(-shift);
        const remainder = coefficient % divisor;
        coefficient /= divisor;
        if (remainder * 2n > divisor || remainder * 2n === divisor && coefficient % 2n !== 0n) coefficient++;
      }
      const digits = coefficient.toString().padStart(4, "0");
      const whole = digits.slice(0, -3);
      let fraction = digits.slice(-3);
      while (fraction.endsWith("0")) fraction = fraction.slice(0, -1);
      let integer = "";
      for (let index = 0; index < whole.length; index++) {
        if (grouping && index && (whole.length - index) % 3 === 0) integer += ",";
        integer += whole[index];
      }
      return (decimal.negative ? "-" : "") + integer + (fraction ? "." + fraction : "");
    }
    const number = Number(value);
    if (format === "%d" || format === "%i") {
      if (!Number.isFinite(number)) throw new CsvkitBlocked("non-finite integer formatting");
      return BigInt(Math.trunc(number)).toString();
    }
    if (format === "%f") format = "%.6f";
    const precisionText = format.slice(2, -1);
    const precision = Number(precisionText);
    if (!format.startsWith("%.") || !format.endsWith("f") || !precisionText ||
        !Array.from(precisionText).every(character => character >= "0" && character <= "9") ||
        !Number.isSafeInteger(precision))
      throw new CsvkitBlocked("portable locale supports %.Nf decimal formatting; bind locale for other formats");
    if (!Number.isFinite(number)) return Number.isNaN(number) ? "nan" : number < 0 ? "-inf" : "inf";
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setFloat64(0, Math.abs(number));
    const bits = bytes.getBigUint64(0);
    const encodedExponent = Number(bits >> 52n);
    const significand = (bits & ((1n << 52n) - 1n)) + (encodedExponent ? 1n << 52n : 0n);
    const exponent = encodedExponent ? encodedExponent - 1075 : -1074;
    let scaled = significand * 10n ** BigInt(precision);
    if (exponent >= 0) scaled <<= BigInt(exponent);
    else {
      const divisor = 1n << BigInt(-exponent);
      const remainder = scaled % divisor;
      scaled /= divisor;
      if (remainder * 2n > divisor || remainder * 2n === divisor && scaled % 2n !== 0n) scaled++;
    }
    const digits = scaled.toString().padStart(precision + 1, "0");
    const fixed = precision ? digits.slice(0, -precision) + "." + digits.slice(-precision) : digits;
    return (number < 0 || Object.is(number, -0) ? "-" : "") + fixed;
  }
});
