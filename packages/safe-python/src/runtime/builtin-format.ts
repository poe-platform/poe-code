import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { formatObject, type FormatContext } from "./format-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Public positional-only format(value, format_spec='') adapter. Register in
 * the execution's builtin namespace with its shared formatting capabilities.
 * Argument validation precedes protocol dispatch and uses public TypeError
 * diagnostics, not the internal formatting API's invalid-spec SystemError. */
export function createFormatBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: FormatContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "format",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "format() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "format expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `format expected at most 2 arguments, got ${positional.length}`);
      const spec = positional[1];
      if (positional.length === 2) {
        const storage = context.string(spec); meter.checkpoint();
        if (storage === undefined) {
          const name = spec.kind === "none" ? "None" : diagnosticTypeName(context.typeName(spec), meter, 50);
          throw new PythonRuntimeError("TypeError", `format() argument 2 must be str, not ${name}`);
        }
      }
      return formatObject(positional[0], spec, context, meter);
    }
  });
}
