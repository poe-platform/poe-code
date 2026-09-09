import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerSquareRoot } from "./integer-square-root.js";
import { floatAsIntegerRatio } from "./numeric-conversion.js";

/** Round the exact Euclidean magnitude once, including subnormal results.
 * Binary64 inputs bound aligned operands to 2098 bits. The square root itself
 * operates on at most 106 bits; exact midpoint comparison retains discarded
 * bits instead of relying on host hypot or a rounded sum of squares. This can
 * differ by one ULP from CPython complex abs, which uses platform C hypot. */
export function complexMagnitude(real: number, imaginary: number, meter: ExecutionMeter): number {
  meter.checkpoint();
  const a = Math.abs(real), b = Math.abs(imaginary);
  if (a === Infinity || b === Infinity) return Infinity;
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === 0) return b;
  if (b === 0) return a;
  const left = floatAsIntegerRatio(a, meter), right = floatAsIntegerRatio(b, meter);
  const leftScale = integerBitMetric(left.denominator, "bit_length", meter) - 1;
  const rightScale = integerBitMetric(right.denominator, "bit_length", meter) - 1;
  const scale = Math.max(leftScale, rightScale);
  const bits = Math.max(
    integerBitMetric(left.numerator, "bit_length", meter) + scale - leftScale,
    integerBitMetric(right.numerator, "bit_length", meter) + scale - rightScale,
  );
  const words = Math.ceil(bits / 64), bytes = Math.ceil((2 * bits + 2) / 8);
  meter.checkpoint(2 * words * words, 256 + 5 * bytes);
  const x = left.numerator << BigInt(scale - leftScale);
  const y = right.numerator << BigInt(scale - rightScale);
  const square = x * x + y * y;
  const rootBits = Math.ceil(integerBitMetric(square, "bit_length", meter) / 2);
  const unitExponent = Math.max(rootBits - 1 - scale - 52, -1074);
  const shift = unitExponent + scale;
  meter.checkpoint(words, 128 + 2 * bytes);
  const scaledSquare = shift >= 0 ? square >> BigInt(2 * shift) : square << BigInt(-2 * shift);
  let significand = integerSquareRoot(scaledSquare, meter);
  meter.checkpoint(words, 256 + 4 * bytes);
  const midpoint = (2n * significand + 1n) ** 2n;
  const lower = shift >= 0 ? 4n * square : 4n * scaledSquare;
  const upper = shift >= 0 ? midpoint << BigInt(2 * shift) : midpoint;
  if (lower > upper || (lower === upper && (significand & 1n) !== 0n)) significand++;
  meter.checkpoint();
  const result = Number(significand) * 2 ** unitExponent;
  if (!Number.isFinite(result)) throw new PythonRuntimeError("OverflowError", "absolute value too large");
  return result;
}
