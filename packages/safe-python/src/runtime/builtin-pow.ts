import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { runtimePowerOperation, type RuntimePowerContext } from "./runtime-power-operation.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type { RuntimePowerContext as PowContext } from "./runtime-power-operation.js";

/** Explicit pow registration. Slot results are unrestricted; keyword binding
 * precedes all numeric work and normalizes omitted mod to the None singleton. */
export function createPowBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: RuntimePowerContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "pow", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    const count = positional.length + keywords.items.size;
    if (count > 3) throw new PythonRuntimeError("TypeError", `pow() takes at most 3 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
    meter.checkpoint(0, 56);
    const args: (RuntimeValue | undefined)[] = [positional[0], positional[1], positional[2]];
    let unexpected: string | undefined, duplicate: string | undefined;
    for (const [key, value] of keywords.items.snapshot()) {
      const payload = runtimeStringPayload(key);
      if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      const index = label === "base" ? 0 : label === "exp" ? 1 : label === "mod" ? 2 : -1;
      if (index < 0) unexpected ??= label;
      else if (positional.length > index) duplicate ??= `argument for pow() given by name ('${label}') and position (${index + 1})`;
      else if (args[index] === undefined) args[index] = value;
      else unexpected ??= label;
    }
    if (args[0] === undefined) throw new PythonRuntimeError("TypeError", "pow() missing required argument 'base' (pos 1)");
    if (args[1] === undefined) throw new PythonRuntimeError("TypeError", "pow() missing required argument 'exp' (pos 2)");
    if (duplicate !== undefined) throw new PythonRuntimeError("TypeError", duplicate);
    if (unexpected !== undefined) unexpectedBuiltinKeyword("pow", keywords, ["base", "exp", "mod"], values, meter, invocation);
    const base = args[0], exponent = args[1], modulus = args[2] ?? values.none;
    return runtimePowerOperation(base, exponent, modulus, values, meter, context ?? invocation?.power);
  } });
}
