import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";

/** Integer three-argument pow, including modular inverses for negative exponents.
 * Products are reduced at each step; no unmodulated exponential is allocated.
 * Host numeric utilities may omit the meter; guest adapters must supply it.
 * Payload bounds reserve arithmetic intermediates before each host operation.
 * Host bigint operations remain indivisible; input size inspection inherits
 * integerBitMetric's post-conversion string accounting limitation.
 */
export function integerModularPower(base: bigint, exponent: bigint, modulus: bigint, meter?: ExecutionMeter): bigint {
  meter?.checkpoint();
  if (modulus === 0n) throw new PythonRuntimeError("ValueError", "pow() 3rd argument cannot be 0");
  if (modulus === 1n || modulus === -1n) return 0n;
  const modulusBytes = meter === undefined ? 0 : Math.ceil(integerBitMetric(modulus, "bit_length", meter) / 8);
  const baseBytes = meter === undefined ? 0 : Math.ceil(integerBitMetric(base, "bit_length", meter) / 8);
  let exponentBits = meter === undefined ? 0 : integerBitMetric(exponent, "bit_length", meter);
  meter?.checkpoint(0, 96 + baseBytes + modulusBytes * 3);
  const magnitude = modulus < 0n ? -modulus : modulus;
  base %= magnitude;
  if (base < 0n) base += magnitude;
  if (exponent < 0n) {
    base = modularInverse(base, magnitude, modulusBytes, meter);
    meter?.checkpoint(0, 32 + Math.ceil(exponentBits / 8));
    exponent = -exponent;
  }
  let result = 1n;
  while (exponent !== 0n) {
    meter?.checkpoint(1, 32);
    // Product has at most twice the modulus width; its residue has one width.
    if ((exponent & 1n) !== 0n) {
      meter?.checkpoint(0, 64 + modulusBytes * 3);
      result = result * base % magnitude;
    }
    meter?.checkpoint(0, 32 + Math.ceil(exponentBits / 8));
    exponent >>= 1n;
    exponentBits = Math.max(0, exponentBits - 1);
    if (exponent !== 0n) {
      meter?.checkpoint(0, 64 + modulusBytes * 3);
      base = base * base % magnitude;
    }
  }
  if (modulus < 0n && result !== 0n) {
    meter?.checkpoint(0, 32 + modulusBytes);
    return result - magnitude;
  }
  meter?.checkpoint(0);
  return result;
}

/** Extended Euclid on nonnegative residues; only the base coefficient is needed. */
function modularInverse(base: bigint, modulus: bigint, modulusBytes: number, meter?: ExecutionMeter): bigint {
  let previous = modulus, remainder = base;
  let previousCoefficient = 0n, coefficient = 1n;
  while (remainder !== 0n) {
    // Euclidean residues, quotients and coefficients are modulus-bounded;
    // reserve double-width coefficient multiplication/subtraction as well.
    meter?.checkpoint(1, 160 + modulusBytes * 8);
    const quotient = previous / remainder;
    const nextRemainder = previous % remainder;
    const nextCoefficient = previousCoefficient - quotient * coefficient;
    previous = remainder; remainder = nextRemainder;
    previousCoefficient = coefficient; coefficient = nextCoefficient;
  }
  if (previous !== 1n) throw new PythonRuntimeError("ValueError", "base is not invertible for the given modulus");
  meter?.checkpoint(0, 64 + modulusBytes * 2);
  const inverse = previousCoefficient % modulus;
  return inverse < 0n ? inverse + modulus : inverse;
}
