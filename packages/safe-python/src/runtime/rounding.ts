import { floatAsIntegerRatio, floatToInteger } from "./numeric-conversion.js";
import { integerTrueDivide } from "./integer-arithmetic.js";
import { PythonNumericError } from "./numeric-error.js";

/** Exact nearest integer with ties to even; denominator must be positive. */
function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < 0n ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twiceRemainder = (magnitude % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) !== 0n)) quotient++;
  return numerator < 0n ? -quotient : quotient;
}

export function integerRound(value: bigint, digits = 0n): bigint {
  if (digits >= 0n || value === 0n) return value;
  const magnitude = value < 0n ? -value : value;
  // More discarded decimal places than input digits always rounds to zero.
  if (-digits > BigInt(magnitude.toString().length)) return 0n;
  const factor = 10n ** -digits;
  return roundRatio(value, factor) * factor;
}

export function floatRound(value: number): bigint;
export function floatRound(value: number, digits: bigint): number;
export function floatRound(value: number, digits?: bigint): bigint | number {
  if (digits === undefined) {
    if (!Number.isFinite(value)) return floatToInteger(value);
    const { numerator, denominator } = floatAsIntegerRatio(value);
    return roundRatio(numerator, denominator);
  }
  if (!Number.isFinite(value) || value === 0 || digits > 323n) return value;
  const zero = value < 0 ? -0 : 0;
  if (digits < -308n) return zero;
  const { numerator, denominator } = floatAsIntegerRatio(value);
  const factor = 10n ** (digits < 0n ? -digits : digits);
  // Scale the exact ratio, avoiding a preliminary binary float rounding step.
  const rounded = digits >= 0n
    ? roundRatio(numerator * factor, denominator)
    : roundRatio(numerator, denominator * factor);
  if (rounded === 0n) return zero;
  const result = digits >= 0n ? integerTrueDivide(rounded, factor) : Number(rounded * factor);
  if (!Number.isFinite(result)) throw new PythonNumericError("OverflowError", "rounded value too large to represent");
  return result;
}
