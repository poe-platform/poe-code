import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeIntegerBitMethod(receiver: Extract<RuntimeValue, { kind: "int" | "bool" }>, name: "bit_length" | "bit_count", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `int.${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `int.${name}() takes no arguments (${positional.length} given)`);
      const value = receiver.kind === "int" ? receiver.value : receiver.value ? 1n : 0n;
      return values.integer(integerBitMetric(value, name, meter));
    }
  });
}
