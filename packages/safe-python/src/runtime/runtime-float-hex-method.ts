import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatHex } from "./float-hex.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeFloatHexMethod(receiver: Extract<RuntimeValue, { kind: "float" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "hex",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "float.hex() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `float.hex() takes no arguments (${positional.length} given)`);
      return values.string(floatHex(receiver.value, meter));
    }
  });
}
