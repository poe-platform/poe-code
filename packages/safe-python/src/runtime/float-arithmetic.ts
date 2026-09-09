import { PythonNumericError } from "./numeric-error.js";

export function floatTrueDivide(a: number, b: number): number {
  if (b === 0) throw new PythonNumericError("ZeroDivisionError", "division by zero");
  return a / b;
}

/** Derive the quotient from the remainder, not by flooring rounded true division.
 * Rounding can make those disagree near integral ratios (for example 1 / 0.1).
 */
export function floatDivmod(a: number, b: number): { quotient: number; remainder: number } {
  if (b === 0) throw new PythonNumericError("ZeroDivisionError", "division by zero");
  let remainder = a % b;
  let division = (a - remainder) / b;
  if (remainder !== 0) {
    if ((remainder < 0) !== (b < 0)) {
      remainder += b;
      division -= 1;
    }
  } else {
    remainder = b < 0 ? -0 : 0;
  }
  let quotient: number;
  if (division !== 0) {
    quotient = Math.floor(division);
    // Removing the remainder can introduce a small rounding error in division.
    if (division - quotient > 0.5) quotient += 1;
  } else {
    const ratio = a / b;
    quotient = ratio < 0 || Object.is(ratio, -0) ? -0 : 0;
  }
  return { quotient, remainder };
}
