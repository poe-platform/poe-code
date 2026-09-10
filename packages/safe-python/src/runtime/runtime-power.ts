import { constantModularPower } from "./constant-modular-power.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerToFloat } from "./numeric-conversion.js";
import { runtimeBinary } from "./runtime-binary.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact native power slots. None means ordinary binary power. A real modulus
 * tries the distinct native slots in base/exponent/modulus order; guest subtype
 * negotiation belongs to the execution's object-protocol adapter. */
export function runtimePower(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (modulus.kind === "none") return runtimeBinary("**", base, exponent, values, meter);
  if ((base.kind === "int" || base.kind === "bool") && (exponent.kind === "int" || exponent.kind === "bool") && (modulus.kind === "int" || modulus.kind === "bool")) return constantModularPower(base, exponent, modulus, values, meter);
  meter.checkpoint(0, 56);
  const operands = [base, exponent, modulus];
  for (let index = 0; index < operands.length; index++) {
    meter.checkpoint();
    const kind = operands[index].kind;
    if (index > 0 && operands[0].kind === kind || index > 1 && operands[1].kind === kind) continue;
    const result = runtimePowerSlot(operands[index], base, exponent, modulus, values, meter);
    if (result !== values.notImplemented) return result;
  }
  return values.notImplemented;
}

/** Invoke only the selected native slot, so a later modulus slot cannot preempt
 * a guest forward/reflected method. The original operand order is preserved. */
export function runtimePowerSlot(receiver: RuntimeValue, base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (modulus.kind === "none") return runtimeBinary("**", base, exponent, values, meter);
  if (receiver.kind === "int" || receiver.kind === "bool") {
    if ((base.kind === "int" || base.kind === "bool") && (exponent.kind === "int" || exponent.kind === "bool") && (modulus.kind === "int" || modulus.kind === "bool")) return constantModularPower(base, exponent, modulus, values, meter);
  }
  if (receiver.kind === "float") throw new PythonRuntimeError("TypeError", "pow() 3rd argument not allowed unless all arguments are integers");
  if (receiver.kind === "complex") {
    let supported = true;
    for (let position = 0; position < 2; position++) {
      const value = position === 0 ? base : exponent;
      if (value.kind === "int") {
        integerBitMetric(value.value, "bit_length", meter);
        integerToFloat(value.value);
      } else if (value.kind !== "bool" && value.kind !== "float" && value.kind !== "complex") { supported = false; break; }
    }
    if (supported) throw new PythonRuntimeError("ValueError", "complex modulo");
  }
  return values.notImplemented;
}
