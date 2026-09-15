import { complexBinary } from "./complex-binary.js";
import type { ConstantValue, ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerToFloat } from "./numeric-conversion.js";

/** Exact native numeric pairs with at least one complex operand. Small integral
 * exponents use complex repeated squaring; other exponents use the principal
 * logarithm. Host transcendental rounding remains platform-dependent. */
export function complexPower(left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (left.kind !== "complex" && right.kind !== "complex") return values.notImplemented;
  if (left.kind !== "complex" && left.kind !== "float" && left.kind !== "int" && left.kind !== "bool") return values.notImplemented;
  if (right.kind !== "complex" && right.kind !== "float" && right.kind !== "int" && right.kind !== "bool") return values.notImplemented;
  if (left.kind === "int") integerBitMetric(left.value, "bit_length", meter);
  const a = left.kind === "complex" ? left.real : left.kind === "int" ? integerToFloat(left.value) : left.kind === "bool" ? Number(left.value) : left.value;
  const b = left.kind === "complex" ? left.imaginary : 0;
  if (right.kind === "int") integerBitMetric(right.value, "bit_length", meter);
  const c = right.kind === "complex" ? right.real : right.kind === "int" ? integerToFloat(right.value) : right.kind === "bool" ? Number(right.value) : right.value;
  const d = right.kind === "complex" ? right.imaginary : 0;
  if (c === 0 && d === 0) return values.complex(1, 0);
  if (a === 0 && b === 0 && (c < 0 || d !== 0)) throw new PythonRuntimeError("ZeroDivisionError", "zero to a negative or complex power");
  let real: number, imaginary: number;
  if (d === 0 && Number.isInteger(c) && Math.abs(c) <= 100) {
    let result: ConstantValue = values.complex(1, 0), power: ConstantValue = values.complex(a, b);
    const count = Math.abs(c);
    for (let mask = 1; mask <= count; mask *= 2) {
      meter.checkpoint();
      if (count & mask) result = complexBinary("*", result, power, values, meter);
      power = complexBinary("*", power, power, values, meter);
    }
    if (c < 0) {
      if (result.kind === "complex" && result.real === 0 && result.imaginary === 0) throw new PythonRuntimeError("ZeroDivisionError", "zero to a negative or complex power");
      result = complexBinary("/", values.complex(1, 0), result, values, meter);
    }
    if (result.kind !== "complex") throw new Error("complex power kernel declined native operands");
    real = result.real; imaginary = result.imaginary;
  } else if (a === 0 && b === 0) {
    real = 0; imaginary = 0;
  } else {
    meter.checkpoint(16);
    const magnitude = Math.hypot(a, b), angle = Math.atan2(b, a);
    let length = magnitude === 1 ? 1 : magnitude ** c;
    let phase = angle * c;
    if (d !== 0) { length *= Math.exp(-angle * d); phase += d * Math.log(magnitude); }
    real = length * Math.cos(phase); imaginary = length * Math.sin(phase);
  }
  if (Math.abs(real) === Infinity || Math.abs(imaginary) === Infinity) throw new PythonRuntimeError("OverflowError", "complex exponentiation");
  return values.complex(real, imaginary);
}
