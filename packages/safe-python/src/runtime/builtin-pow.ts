import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimePower } from "./runtime-power.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface PowContext {
  /** Complete execution-owned binary/ternary numeric dispatch, including native
   * slots, reflected methods and subtype priority. None denotes binary power.
   * Return this execution's NotImplemented only when all eligible slots decline.
   * Omission uses native slots only; this hook does not perform __index__ coercion. */
  power?(base: RuntimeValue, exponent: RuntimeValue, modulus: RuntimeValue): RuntimeValue;
  typeName?(value: RuntimeValue): string;
}

/** Explicit pow registration. Slot results are unrestricted; keyword binding
 * precedes all numeric work and normalizes omitted mod to the None singleton. */
export function createPowBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: PowContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "pow", invoke(positional, keywords, meter) {
    meter.checkpoint();
    const count = positional.length + keywords.items.size;
    if (count > 3) throw new PythonRuntimeError("TypeError", `pow() takes at most 3 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
    meter.checkpoint(0, 56);
    const args: (RuntimeValue | undefined)[] = [positional[0], positional[1], positional[2]];
    let unexpected: string | undefined, duplicate: string | undefined;
    for (const [key, value] of keywords.items.snapshot()) {
      if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      const index = label === "base" ? 0 : label === "exp" ? 1 : label === "mod" ? 2 : -1;
      if (index < 0) unexpected ??= label;
      else if (positional.length > index) duplicate ??= `argument for pow() given by name ('${label}') and position (${index + 1})`;
      else args[index] = value;
    }
    if (args[0] === undefined) throw new PythonRuntimeError("TypeError", "pow() missing required argument 'base' (pos 1)");
    if (args[1] === undefined) throw new PythonRuntimeError("TypeError", "pow() missing required argument 'exp' (pos 2)");
    if (duplicate !== undefined) throw new PythonRuntimeError("TypeError", duplicate);
    if (unexpected !== undefined) throw new PythonRuntimeError("TypeError", `pow() got an unexpected keyword argument '${unexpected}'`);
    const base = args[0], exponent = args[1], modulus = args[2] ?? values.none;
    const result = context.power === undefined ? runtimePower(base, exponent, modulus, values, meter) : context.power(base, exponent, modulus);
    meter.checkpoint();
    if (result !== values.notImplemented) return result;
    const names: string[] = [];
    meter.checkpoint(0, 56);
    for (let index = 0; index < (modulus.kind === "none" ? 2 : 3); index++) {
      const value = args[index]!;
      const name = context.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      names.push(`'${diagnosticTypeName(name, meter, 100)}'`);
    }
    throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for ** or pow(): ${names.join(modulus.kind === "none" ? " and " : ", ")}`);
  } });
}
