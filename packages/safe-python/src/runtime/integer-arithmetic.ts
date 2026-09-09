import { PythonNumericError } from "./numeric-error.js";

/** Exact floor quotient and remainder, whose sign follows the divisor. */
export function integerDivmod(a: bigint, b: bigint): { quotient: bigint; remainder: bigint } {
  if (b === 0n) throw new PythonNumericError("ZeroDivisionError", "integer division or modulo by zero");
  let quotient = a / b;
  let remainder = a % b;
  if (remainder !== 0n && (remainder < 0n) !== (b < 0n)) {
    quotient -= 1n;
    remainder += b;
  }
  return { quotient, remainder };
}

/** Round the exact ratio to binary64, nearest with ties to even.
 * Converting operands separately loses precision and can turn finite ratios
 * into infinity/infinity. Only the final rounded significand becomes a number.
 */
export function integerTrueDivide(a: bigint, b: bigint): number {
  if (b === 0n) throw new PythonNumericError("ZeroDivisionError", "division by zero");
  const negative = (a < 0n) !== (b < 0n);
  let numerator = a < 0n ? -a : a;
  let denominator = b < 0n ? -b : b;
  if (numerator === 0n) return negative ? -0 : 0;
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent > 1024) throw new PythonNumericError("OverflowError", "integer division result too large for a float");
  if (exponent < -1075) return negative ? -0 : 0;
  // Bit-length difference estimates floor(log2(a/b)) to within one bit.
  if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) : (numerator << BigInt(-exponent)) < denominator) exponent--;
  // Normal values retain 53 significant bits; subnormals share a fixed quantum.
  const quantum = Math.max(exponent - 52, -1074);
  if (quantum < 0) numerator <<= BigInt(-quantum);
  else denominator <<= BigInt(quantum);
  let significand = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && (significand & 1n) !== 0n)) significand++;
  const result = Number(significand) * 2 ** quantum;
  if (!Number.isFinite(result)) throw new PythonNumericError("OverflowError", "integer division result too large for a float");
  return negative ? -result : result;
}
