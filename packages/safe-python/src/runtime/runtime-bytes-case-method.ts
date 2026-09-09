import { PythonRuntimeError } from "./error.js";
import type { BytesCaseTransformation } from "./immutable-bytes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesCaseMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: BytesCaseTransformation, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no arguments (${positional.length} given)`);
      if (receiver.value.length === 0) return receiver;
      return values.bytes(receiver.value.transformCase(name, meter));
    }
  });
}
