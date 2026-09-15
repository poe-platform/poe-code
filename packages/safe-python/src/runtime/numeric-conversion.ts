import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

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
export function floatAsIntegerRatio(value: number, meter?: ExecutionMeter): { numerator: bigint; denominator: bigint } {
  meter?.checkpoint();
  if (Number.isNaN(value)) throw new PythonRuntimeError("ValueError", "cannot convert NaN to integer ratio");
  if (!Number.isFinite(value)) throw new PythonRuntimeError("OverflowError", "cannot convert Infinity to integer ratio");
  meter?.checkpoint(0, 32);
  if (value === 0) return { numerator: 0n, denominator: 1n };
  // Buffer/view and bounded 64-bit decoding intermediates. Complete host
  // BigInt object-overhead accounting remains representation-level work.
  meter?.checkpoint(1, 72 + 8 * 8);
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
    meter?.checkpoint(1, 8);
    numerator >>= 1n;
    exponent++;
  }
  if (value < 0) { meter?.checkpoint(1, 8); numerator = -numerator; }
  meter?.checkpoint(1, exponent < 0 ? Math.ceil((-exponent + 1) / 8) : Math.ceil((53 + exponent) / 8));
  return exponent < 0
    ? { numerator, denominator: 1n << BigInt(-exponent) }
    : { numerator: numerator << BigInt(exponent), denominator: 1n };
}
