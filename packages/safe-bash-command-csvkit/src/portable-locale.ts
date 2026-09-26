import type { LocaleServices } from "./contracts.js";
import { CsvkitBlocked } from "./errors.js";

/** C locale has no grouping separator and always uses a decimal point. */
export const portableLocale: LocaleServices = Object.freeze<LocaleServices>({
  profile: "C",
  timezone: "UTC",
  formatNumber(value, _locale, format) {
    const precisionText = format.slice(2, -1);
    const precision = Number(precisionText);
    if (!format.startsWith("%.") || !format.endsWith("f") || !precisionText ||
        !Array.from(precisionText).every(character => character >= "0" && character <= "9") ||
        !Number.isSafeInteger(precision) || precision > 100)
      throw new CsvkitBlocked("portable locale supports %.Nf decimal formatting; bind locale for other formats");
    const number = Number(value);
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
