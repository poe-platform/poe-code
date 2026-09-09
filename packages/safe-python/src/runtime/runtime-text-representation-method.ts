import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact text/bytes slots only; guest subclass dispatch and method-wrapper
 * introspection are separate from these explicitly bound native capabilities. */
export function createRuntimeTextRepresentationMethod(receiver: Extract<RuntimeValue, { kind: "str" | "bytes" }>, name: "__str__" | "__repr__", values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (receiver.kind === "str" && name === "__str__") return receiver;
      const text = receiver.kind === "str" ? receiver.value.repr(false, meter) : CodePointString.fromBytesRepr(receiver.value, meter);
      return values.stringPoints(text);
    }
  });
}
