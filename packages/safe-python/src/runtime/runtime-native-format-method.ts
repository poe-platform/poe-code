import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { formatSlot, type FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext, hasNativeObjectFormat } from "./runtime-format.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Bound native formatter with shared argument validation and slot dispatch. */
export function createRuntimeNativeFormatMethod(receiver: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, formatting?: FormatContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const context = formatting ?? createRuntimeFormatContext(values, meter, { defaultRepr() { throw new UnsupportedExpressionError("attribute"); } });
  return values.builtinFunction({
    name: "__format__",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const type = hasNativeObjectFormat(receiver) ? "object" : receiver.kind === "bool" ? "int" : context.typeName(receiver); meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${type}.__format__() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${type}.__format__() takes exactly one argument (${positional.length} given)`);
      const spec = positional[0], storage = context.string(spec); meter.checkpoint();
      if (storage === undefined) {
        const name = spec.kind === "none" ? "None" : diagnosticTypeName(context.typeName(spec), meter, 50);
        throw new PythonRuntimeError("TypeError", `__format__() argument must be str, not ${name}`);
      }
      return formatSlot(receiver, spec, context, meter);
    }
  });
}
