import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Integer three-argument pow, including modular inverses for negative exponents.
 * Products are reduced at each step; no unmodulated exponential is allocated.
 * Host numeric utilities may omit the meter; guest adapters must supply it.
 * Checkpoints bound loop iterations, not bigint payload sizes or host CPU time.
 */
export function integerModularPower(base: bigint, exponent: bigint, modulus: bigint, meter?: ExecutionMeter): bigint {
  meter?.checkpoint();
  if (modulus === 0n) throw new PythonRuntimeError("ValueError", "pow() 3rd argument cannot be 0");
  const magnitude = modulus < 0n ? -modulus : modulus;
  if (magnitude === 1n) return 0n;
  base %= magnitude;
  if (base < 0n) base += magnitude;
  if (exponent < 0n) {
    base = modularInverse(base, magnitude, meter);
    exponent = -exponent;
  }
  let result = 1n;
  while (exponent !== 0n) {
    meter?.checkpoint();
    if ((exponent & 1n) !== 0n) result = result * base % magnitude;
    exponent >>= 1n;
    if (exponent !== 0n) base = base * base % magnitude;
  }
  return modulus < 0n && result !== 0n ? result - magnitude : result;
}

/** Extended Euclid on nonnegative residues; only the base coefficient is needed. */
function modularInverse(base: bigint, modulus: bigint, meter?: ExecutionMeter): bigint {
  let previous = modulus, remainder = base;
  let previousCoefficient = 0n, coefficient = 1n;
  while (remainder !== 0n) {
    meter?.checkpoint();
    const quotient = previous / remainder;
    [previous, remainder] = [remainder, previous % remainder];
    [previousCoefficient, coefficient] = [coefficient, previousCoefficient - quotient * coefficient];
  }
  if (previous !== 1n) throw new PythonRuntimeError("ValueError", "base is not invertible for the given modulus");
  const inverse = previousCoefficient % modulus;
  return inverse < 0n ? inverse + modulus : inverse;
}
