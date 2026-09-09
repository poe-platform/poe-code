import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesReplaceMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "replace",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.replace() takes no keyword arguments");
      if (positional.length < 2) throw new PythonRuntimeError("TypeError", `replace expected at least 2 arguments, got ${positional.length}`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `replace expected at most 3 arguments, got ${positional.length}`);
      const old = replacementBytesArgument(positional[0]), replacement = replacementBytesArgument(positional[1]);
      const count = positional[2] === undefined ? -1n : runtimeSizeIndex(positional[2], meter);
      const result = receiver.value.replace(old.value, replacement.value, count, meter);
      return result === receiver.value ? receiver : values.bytes(result, result.length === 0 ? "canonical" : "fresh");
    }
  });
}

function replacementBytesArgument(value: RuntimeValue): Extract<RuntimeValue, { kind: "bytes" }> {
  if (value.kind === "bytes") return value;
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}
