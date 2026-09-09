import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeStringCaseMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "upper" | "casefold" | "lower", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no arguments (${positional.length} given)`);
      if (receiver.value.length === 0) return receiver;
      return values.stringPoints(receiver.value.transformCase(name, meter));
    }
  });
}
