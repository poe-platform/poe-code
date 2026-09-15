import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { floatAsIntegerRatio } from "./numeric-conversion.js";

/** Unsigned finite binary64 fixed-point digits, rounded once with ties to even.
 * Signs, nonfinite spellings, alternate form and field padding belong to the
 * field renderer. Binary64 fractions terminate by decimal place 1,074; larger
 * requested precisions append zeros without growing the arithmetic operands.
 */
export function floatFixedDigits(value: number, precision: bigint, meter: ExecutionMeter): string {
  meter.checkpoint();
  if (!Number.isFinite(value) || precision < 0n) throw new RangeError("fixed digits require a finite value and nonnegative precision");
  // At most 309 integral digits, plus a rounding carry and decimal separator.
  const outputBound = precision + 311n;
  if (outputBound > 0xffffffffn) exhaustAllocation(meter);
  const places = Number(precision), arithmeticPlaces = Math.min(places, 1074);
  // Reserve output, padding and concatenation/slicing temporaries before any
  // host allocation proportional to the requested precision.
  meter.checkpoint(Number(outputBound), 128 + Number(outputBound) * 8);
  const { numerator, denominator } = floatAsIntegerRatio(Math.abs(value), meter);
  // Ten has fewer than four binary digits. These bounded reserves cover the
  // power, product, quotient, remainder and rounding intermediates.
  const integerBytes = 160 + Math.ceil(arithmeticPlaces / 2);
  meter.checkpoint(arithmeticPlaces + 1, 8 * integerBytes);
  const scaled = numerator * 10n ** BigInt(arithmeticPlaces);
  let rounded = scaled / denominator;
  const remainder = scaled % denominator, twice = remainder * 2n;
  if (twice > denominator || twice === denominator && (rounded & 1n) !== 0n) rounded++;
  meter.checkpoint(1, 32 + (arithmeticPlaces + 310) * 2);
  const digits = rounded.toString(10);
  meter.checkpoint();
  if (places === 0) return digits;
  const padded = digits.padStart(arithmeticPlaces + 1, "0");
  const split = padded.length - arithmeticPlaces;
  const result = padded.slice(0, split) + "." + padded.slice(split) + "0".repeat(places - arithmeticPlaces);
  meter.checkpoint();
  return result;
}
