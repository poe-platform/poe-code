import { PythonRuntimeError } from "./error.js";

/** Convert with binary64 rounding, but do not silently turn large integers into infinity. */
export function integerToFloat(value: bigint): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new PythonRuntimeError("OverflowError", "int too large to convert to float");
  return result;
}

/** Truncate towards zero while preserving all integral bits of a finite float. */
export function floatToInteger(value: number): bigint {
  if (Number.isNaN(value)) throw new PythonRuntimeError("ValueError", "cannot convert float NaN to integer");
  if (!Number.isFinite(value)) throw new PythonRuntimeError("OverflowError", "cannot convert float infinity to integer");
  return BigInt(Math.trunc(value));
}

/** Decode binary64 directly into a reduced ratio with a positive denominator. */
export function floatAsIntegerRatio(value: number): { numerator: bigint; denominator: bigint } {
  if (Number.isNaN(value)) throw new PythonRuntimeError("ValueError", "cannot convert NaN to integer ratio");
  if (!Number.isFinite(value)) throw new PythonRuntimeError("OverflowError", "cannot convert Infinity to integer ratio");
  if (value === 0) return { numerator: 0n, denominator: 1n };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const storedExponent = Number((bits >> 52n) & 0x7ffn);
  let numerator = bits & ((1n << 52n) - 1n);
  let exponent = -1074;
  if (storedExponent !== 0) {
    numerator |= 1n << 52n;
    exponent = storedExponent - 1023 - 52;
  }
  // The only common factors can be powers of two; at most 52 are removed.
  while (exponent < 0 && (numerator & 1n) === 0n) {
    numerator >>= 1n;
    exponent++;
  }
  if (value < 0) numerator = -numerator;
  return exponent < 0
    ? { numerator, denominator: 1n << BigInt(-exponent) }
    : { numerator: numerator << BigInt(exponent), denominator: 1n };
}
