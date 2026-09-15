import type { ConstantValue, ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerToFloat } from "./numeric-conversion.js";

/** Real-pair power with at least one exact float. Integer-only power and complex
 * operands belong to other kernels. Negative fractional powers use the principal
 * complex branch. Platform transcendental rounding can differ from CPython's
 * libm; special values and errors are handled independently of host pow.
 */
export function floatPower(left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (left.kind !== "float" && right.kind !== "float") return values.notImplemented;
  if (left.kind !== "float" && left.kind !== "int" && left.kind !== "bool") return values.notImplemented;
  if (right.kind !== "float" && right.kind !== "int" && right.kind !== "bool") return values.notImplemented;
  if (left.kind === "int") integerBitMetric(left.value, "bit_length", meter);
  const base = left.kind === "float" ? left.value : left.kind === "bool" ? (left.value ? 1 : 0) : integerToFloat(left.value);
  if (right.kind === "int") integerBitMetric(right.value, "bit_length", meter);
  const exponent = right.kind === "float" ? right.value : right.kind === "bool" ? (right.value ? 1 : 0) : integerToFloat(right.value);
  meter.checkpoint();
  if (exponent === 0) return values.float(1);
  if (Number.isNaN(base)) return values.float(base);
  if (Number.isNaN(exponent)) return values.float(base === 1 ? 1 : exponent);
  const magnitude = Math.abs(base);
  if (!Number.isFinite(exponent)) return values.float(magnitude === 1 ? 1 : (exponent > 0) === (magnitude > 1) ? Infinity : 0);
  const odd = Math.abs(exponent) % 2 === 1;
  if (!Number.isFinite(base)) return values.float(exponent > 0 ? (odd ? base : Infinity) : (odd && base < 0 ? -0 : 0));
  if (base === 0) {
    if (exponent < 0) throw new PythonRuntimeError("ZeroDivisionError", "zero to a negative power");
    return values.float(odd ? base : 0);
  }
  meter.checkpoint(8);
  const result = magnitude ** exponent;
  if (base < 0 && !Number.isInteger(exponent)) {
    if (!Number.isFinite(result)) throw new PythonRuntimeError("OverflowError", "complex exponentiation");
    const phase = Math.PI * exponent;
    return values.complex(result * Math.cos(phase), result * Math.sin(phase));
  }
  if (!Number.isFinite(result)) throw new PythonRuntimeError("OverflowError", "(34, 'Result too large')");
  return values.float(base < 0 && odd ? -result : result);
}
