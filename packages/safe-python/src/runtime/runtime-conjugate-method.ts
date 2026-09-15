import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeConjugateMethod(receiver: Extract<RuntimeValue, { kind: "int" | "bool" | "float" | "complex" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "conjugate",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const type = receiver.kind === "bool" ? "int" : receiver.kind;
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${type}.conjugate() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${type}.conjugate() takes no arguments (${positional.length} given)`);
      if (receiver.kind === "complex") return values.complex(receiver.real, -receiver.imaginary);
      if (receiver.kind === "bool") return values.integer(receiver.value ? 1n : 0n);
      return receiver;
    }
  });
}
