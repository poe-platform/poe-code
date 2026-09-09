import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatFromHex } from "./float-from-hex.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Exact float class operation; subclass construction remains object-model work. */
export function createRuntimeFloatFromhexMethod(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromhex",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "float.fromhex() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `float.fromhex() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      if (source.kind !== "str") throw new PythonRuntimeError("TypeError", "bad argument type for built-in operation");
      return values.float(floatFromHex(source.value, meter));
    }
  });
}
