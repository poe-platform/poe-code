export class JsonNumberError extends RangeError {}

/** 1100 significant decimal digits exceed the exact precision of every finite
 * binary64 midpoint, including 2^-1075. A sticky digit distinguishes either
 * side even when the token continues for arbitrarily many characters. */
const significantPrecision = 1100;

/** Apply an exact-integer policy to an already syntax-validated
 * JSON number. Additional decimal state and BigInts stay bounded independently
 * of incoming fragment size. Pass exactInteger=false for native binary64
 * rounding, including nonfinite results; the caller controls admission. */
export async function readJsonNumber(
  fragments: Iterable<string> | AsyncIterable<string>, cooperate: (units: number) => Promise<void>, exactInteger = true
): Promise<number> {
  let negative = false, fraction = false, inExponent = false, exponentNegative = false;
  let digits = 0, fractionDigits = 0, significantDigits = 0, exponent = 0;
  let prefix = "", sticky = false;
  for await (const fragment of fragments) {
    for (let start = 0; start < fragment.length; start += 4096) {
      const end = Math.min(fragment.length, start + 4096);
      for (let index = start; index < end; index++) {
        const char = fragment[index]!;
        if (char === "-") {if (inExponent) exponentNegative = true; else negative = true; continue;}
        if (char === "+") continue;
        if (char === ".") {fraction = true; continue;}
        if (char === "e" || char === "E") {inExponent = true; continue;}
        const digit = char.charCodeAt(0) - 48;
        if (digit < 0 || digit > 9) throw new JsonNumberError("Expected a JSON number");
        if (inExponent) {
          // A token cannot have enough mantissa digits to cancel an exponent
          // beyond the exact addressable input/storage range.
          exponent = Math.min(Number.MAX_SAFE_INTEGER, exponent * 10 + digit);
          continue;
        }
        digits++;
        if (fraction) fractionDigits++;
        if (digit || significantDigits) {
          significantDigits++;
          if (prefix.length < significantPrecision) prefix += char;
          else if (digit) sticky = true;
        }
      }
      await cooperate(end - start);
    }
  }
  if (exponentNegative) exponent = -exponent;
  const scale = exponent - fractionDigits;
  const significand = prefix + (sticky ? "1" : "");
  const value = prefix ? Number(`${negative ? "-" : ""}${significand}e${scale + significantDigits - significand.length}`) : negative ? -0 : 0;
  if (!exactInteger) return value;
  let exact = Number.isFinite(value) && digits > 0;
  if (exact && Number.isInteger(value)) {
    exact = Number.isSafeInteger(value) && digits + Number(negative) <= 1024 && Math.abs(scale) <= 1024;
    if (exact) {
      const coefficient = BigInt((negative ? "-" : "") + (prefix || "0"));
      const divisor = 10n ** BigInt(Math.abs(scale));
      exact = scale >= 0 ? coefficient * divisor === BigInt(value)
        : coefficient % divisor === 0n && coefficient / divisor === BigInt(value);
    }
  }
  if (!exact) throw new JsonNumberError("Number exceeds exact integer range or is rounded");
  return value;
}
