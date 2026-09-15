import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatAsIntegerRatio } from "./numeric-conversion.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeIntegerRatioMethod(receiver: Extract<RuntimeValue, { kind: "int" | "bool" | "float" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "as_integer_ratio",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const type = receiver.kind === "float" ? "float" : "int";
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${type}.as_integer_ratio() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${type}.as_integer_ratio() takes no arguments (${positional.length} given)`);
      if (receiver.kind === "float") {
        const ratio = floatAsIntegerRatio(receiver.value, meter);
        return values.tuple(2, index => values.integer(index === 0 ? ratio.numerator : ratio.denominator));
      }
      return values.tuple(2, index => index === 0 && receiver.kind === "int" ? receiver : values.integer(index === 0 && !receiver.value ? 0n : 1n));
    }
  });
}
