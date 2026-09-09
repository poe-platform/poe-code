import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeIsIntegerMethod(receiver: Extract<RuntimeValue, { kind: "int" | "bool" | "float" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "is_integer",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const type = receiver.kind === "float" ? "float" : "int";
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${type}.is_integer() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${type}.is_integer() takes no arguments (${positional.length} given)`);
      return values.boolean(receiver.kind !== "float" || Number.isInteger(receiver.value));
    }
  });
}
