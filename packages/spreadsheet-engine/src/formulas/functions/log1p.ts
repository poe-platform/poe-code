import type { FunctionHost } from "./types.js";

/** Evaluate log(1+x) without rounding away the addition or series residual.
 * Binary reduction bounds the atanh ratio below1/3;192-bit fixed arithmetic
 * retains guard bits for the final binary64 conversion. Iteration is bounded
 * and charged through the caller's work/cancellation contract. */
export function preciseLog1p(x: number, host: Pick<FunctionHost, "tick">): number {
  if (x <= -1 || Number.isNaN(x)) return NaN;
  if (!Number.isFinite(x) || Math.abs(x) < 2 ** -55) return x;
  host.tick();
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0), exponent = Number(bits >> 52n) - 1075;
  const mantissa = ((bits & ((1n << 52n) - 1n)) | (1n << 52n)) * (x < 0 ? -1n : 1n);
  // Keep1+x exact before normalization, including the low part of large x.
  const value = exponent < 0 ? (1n << BigInt(-exponent)) + mantissa : (mantissa << BigInt(exponent)) + 1n;
  const length = value.toString(2).length, power = length - 1 + Math.min(exponent, 0);
  const precision = 192, unit = 1n << BigInt(precision), shift = precision - length + 1;
  const normalized = shift < 0 ? value >> BigInt(-shift) : value << BigInt(shift);
  const ratio = (normalized - unit) * unit / (normalized + unit), square = ratio * ratio / unit;
  let term = ratio, sum = ratio;
  for (let odd = 3; odd < 257; odd += 2) {
    host.tick(); term = term * square / unit;
    if (term === 0n) break;
    sum += term / BigInt(odd);
  }
  // floor(log(2)*2^192), independently generated at220 decimal digits.
  const logTwo = 0xb17217f7d1cf79abc9e3b39803f2f6af40f343267298b62dn;
  return Number(2n * sum + BigInt(power) * logTwo) / 2 ** precision;
}
