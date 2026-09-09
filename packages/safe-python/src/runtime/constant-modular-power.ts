import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerModularPower } from "./modular-power.js";

/** Three-argument power for exact bool/int operands. Other kinds decline so
 * the caller can perform ternary reflected dispatch and report type errors.
 * A None modulus belongs to two-argument power, not this modular kernel.
 * Loops, arithmetic payload bounds and result records are metered; individual
 * host bigint operations cannot be interrupted internally.
 */
export function constantModularPower(base: ConstantValue, exponent: ConstantValue, modulus: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (base.kind !== "int" && base.kind !== "bool") return values.notImplemented;
  if (exponent.kind !== "int" && exponent.kind !== "bool") return values.notImplemented;
  if (modulus.kind !== "int" && modulus.kind !== "bool") return values.notImplemented;
  const a = base.kind === "int" ? base.value : base.value ? 1n : 0n;
  const b = exponent.kind === "int" ? exponent.value : exponent.value ? 1n : 0n;
  const c = modulus.kind === "int" ? modulus.value : modulus.value ? 1n : 0n;
  return values.integer(integerModularPower(a, b, c, meter));
}
