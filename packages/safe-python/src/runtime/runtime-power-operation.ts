import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimePower } from "./runtime-power.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimePowerContext {
  /** Complete execution-owned binary/ternary numeric dispatch, including native
   * slots, reflected methods and subtype priority. None denotes binary power.
   * Return this execution's NotImplemented only when all eligible slots decline.
   * Omission uses native slots only; this hook does not perform __index__ coercion. */
  power?(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue): RuntimeValue;
  typeName?(value: RuntimeValue): string;
}

/** Shared operator/builtin power semantics. Native kernels remain separately
 * callable by object-protocol adapters that need a declining native slot. */
export function runtimePowerOperation(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimePowerContext = {}, augmented = false): RuntimeValue {
  meter.checkpoint();
  const result = context.power === undefined ? runtimePower(base, exponent, modulus, values, meter) : context.power(base, exponent, modulus);
  meter.checkpoint();
  if (result !== values.notImplemented) return result;
  meter.checkpoint(0, 112);
  const operands = [base, exponent, modulus], names: string[] = [];
  for (let index = 0; index < (modulus.kind === "none" ? 2 : 3); index++) {
    const value = operands[index];
    const name = context.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    names.push(`'${diagnosticTypeName(name, meter, 100)}'`);
  }
  throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for ${augmented ? "**=" : "** or pow()"}: ${names.join(modulus.kind === "none" ? " and " : ", ")}`);
}
