import { PythonRuntimeError } from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Bind native substring searches to Unicode code-point storage. No UTF-16
 * indexing, host regular expressions or receiver/needle copies are used. */
export function createRuntimeStringSearchMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "find" | "rfind" | "index" | "rindex" | "count", values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `${name} expected at most 3 arguments, got ${positional.length}`);
      const needle = positional[0];
      const payload=runtimeStringPayload(needle);
      if (payload===undefined) {
        const type = needle.kind === "none" ? "None" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind==="instance"?needle.type.value.diagnosticName:needle.kind;
        throw new PythonRuntimeError("TypeError", `${name}() argument 1 must be str, not ${diagnosticTypeName(type,meter,50)}`);
      }
      const start = runtimeSearchBound(positional[1], 0n, meter, true, context), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, true, context);
      const mode = name === "index" ? "find" : name === "rindex" ? "rfind" : name;
      const index = receiver.value.search(payload.value, mode, start, stop, meter);
      if (index === -1 && (name === "index" || name === "rindex")) throw new PythonRuntimeError("ValueError", "substring not found");
      return values.integer(index);
    }
  });
}
