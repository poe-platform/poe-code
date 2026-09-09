import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesStripMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "strip" | "lstrip" | "rstrip", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `${name} expected at most 1 argument, got ${positional.length}`);
      const chars = positional[0];
      if (chars !== undefined && chars.kind !== "none" && chars.kind !== "bytes") {
        const type = chars.kind === "not-implemented" ? "NotImplementedType" : chars.kind;
        throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
      }
      const result = receiver.value.strip(name, chars?.kind === "bytes" ? chars.value : null, meter);
      return result === receiver.value ? receiver : values.bytes(result);
    }
  });
}
