import type { ConstantValue, ConstantValues } from "./constant-values.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { integerToFloat } from "./numeric-conversion.js";
import { PythonRuntimeError } from "./error.js";

/** Exact bool/int exponentiation. Negative exponents use Python's float
 * conversion order, including its loss of integer parity beyond binary64.
 * Host floating pow rounding may differ from a particular CPython platform.
 * Positive powers use metered repeated squaring and reserve an upper bound on
 * each product payload before multiplication. Bit-length strings, exponent
 * shifts and size-dependent host CPU costs still need complete accounting.
 */
export function integerPower(left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (left.kind !== "int" && left.kind !== "bool") return values.notImplemented;
  if (right.kind !== "int" && right.kind !== "bool") return values.notImplemented;
  let base = left.kind === "int" ? left.value : left.value ? 1n : 0n;
  let exponent = right.kind === "int" ? right.value : right.value ? 1n : 0n;
  if (exponent < 0n) {
    const a = integerToFloat(base), b = integerToFloat(exponent);
    if (a === 0) throw new PythonRuntimeError("ZeroDivisionError", "zero to a negative power");
    return values.float(a ** b);
  }
  if (exponent === 0n) return values.integer(1n);
  if (base === 0n || base === 1n || exponent === 1n) return values.integer(base);
  if (base === -1n) return values.integer((exponent & 1n) === 0n ? 1n : -1n);
  // |base| >= 2 needs at least exponent+1 bits. Reject unrepresentable
  // budget requests before walking an arbitrarily large exponent.
  if ((exponent + 8n) / 8n > BigInt(Number.MAX_SAFE_INTEGER)) exhaustAllocation(meter);
  let result = 1n;
  while (exponent !== 0n) {
    meter.checkpoint();
    if ((exponent & 1n) !== 0n) result = multiply(result, base, meter);
    exponent >>= 1n;
    if (exponent !== 0n) base = multiply(base, base, meter);
  }
  return values.integer(result);
}

function multiply(left: bigint, right: bigint, meter: ExecutionMeter): bigint {
  const bits = left.toString(2).length + right.toString(2).length;
  meter.checkpoint(1, Math.ceil(bits / 8));
  try { return left * right; }
  catch (error) {
    if (error instanceof RangeError) exhaustAllocation(meter);
    throw error;
  }
}
