import type { ExecutionMeter } from "./execution-budget.js";
import { floatAsIntegerRatio } from "./numeric-conversion.js";
import { integerTrueDivide } from "./integer-arithmetic.js";
import { PythonRuntimeError } from "./error.js";

/** Internal IEEE binary64 fused multiply-add, with one final rounding. Unlike
 * Python's public math.fma wrapper, hardware-style invalid/overflow results are
 * NaN/infinity, not guest exceptions. Exact finite arithmetic uses bounded-size
 * rational intermediates; their full temporary bigint heap accounting is pending.
 */
export function floatFma(a: number, b: number, c: number, meter: ExecutionMeter): number {
  meter.checkpoint();
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a * b + c;
  if (!Number.isFinite(c)) return c;
  if (a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  meter.checkpoint(3, 24);
  const x = floatAsIntegerRatio(a), y = floatAsIntegerRatio(b), z = floatAsIntegerRatio(c);
  const productDenominator = x.denominator * y.denominator;
  const numerator = x.numerator * y.numerator * z.denominator + z.numerator * productDenominator;
  const denominator = productDenominator * z.denominator;
  try { return integerTrueDivide(numerator, denominator); }
  catch (error) {
    if (error instanceof PythonRuntimeError && error.name === "OverflowError") return numerator < 0n ? -Infinity : Infinity;
    throw error;
  }
}
