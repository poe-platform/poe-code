import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { formatObject, type FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Public positional-only format(value, format_spec='') adapter. Explicit
 * capabilities override invocation formatting; standalone calls use native
 * formatting with unresolved guest representation left to an explicit policy.
 * Argument validation precedes protocol dispatch and uses public TypeError
 * diagnostics, not the internal formatting API's invalid-spec SystemError. */
export function createFormatBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: FormatContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "format",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "format() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "format expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `format expected at most 2 arguments, got ${positional.length}`);
      const formatting = context ?? invocation?.formatting ?? createRuntimeFormatContext(values, meter, {
        defaultRepr() { throw new Error("format() requires a representation policy for this value"); }
      });
      meter.checkpoint();
      const spec = positional[1];
      if (positional.length === 2) {
        const storage = formatting.string(spec); meter.checkpoint();
        if (storage === undefined) {
          const name = spec.kind === "none" ? "None" : diagnosticTypeName(formatting.typeName(spec), meter, 50);
          throw new PythonRuntimeError("TypeError", `format() argument 2 must be str, not ${name}`);
        }
      }
      return formatObject(positional[0], spec, formatting, meter);
    }
  });
}
