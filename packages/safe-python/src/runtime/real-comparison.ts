import { floatAsIntegerRatio } from "./numeric-conversion.js";
import { integerModularPower } from "./modular-power.js";

// A fixed 64-bit Python numeric-hash model, independent of host pointer width.
export const numericHashModulus = (1n << 61n) - 1n;
export const numericInfinityHash = 314159n;

/** Exact real ordering; undefined means unordered (NaN), not equality. */
export function compareReal(a: bigint | number, b: bigint | number): -1 | 0 | 1 | undefined {
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  // JS relational comparison of bigint with number compares mathematical values;
  // explicitly converting the bigint to number would lose low bits or overflow.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Shared integer/float value hash. NaN requires guest object-identity hashing. */
export function hashReal(value: bigint | number): bigint | undefined {
  let hash: bigint;
  if (typeof value === "bigint") {
    hash = value % numericHashModulus;
  } else {
    if (Number.isNaN(value)) return undefined;
    if (!Number.isFinite(value)) return value < 0 ? -numericInfinityHash : numericInfinityHash;
    const { numerator, denominator } = floatAsIntegerRatio(value);
    // A binary64 denominator is a power of two and invertible modulo this prime.
    const inverse = denominator === 1n ? 1n : integerModularPower(denominator, -1n, numericHashModulus);
    hash = (numerator % numericHashModulus) * inverse % numericHashModulus;
  }
  return hash === -1n ? -2n : hash;
}
