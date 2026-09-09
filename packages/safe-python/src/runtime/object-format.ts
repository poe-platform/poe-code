import type { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";

/** Inherited object.__format__ after its argument has been validated as str.
 * Nonempty specs fail before str/representation lookup. Do not format the
 * resulting string again: guest str-result identity is preserved. */
export function objectFormat<Value>(value: Value, spec: CodePointString, context: RepresentationContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  if (spec.length !== 0) throw new PythonRuntimeError("TypeError", `unsupported format string passed to ${diagnosticTypeName(context.typeName(value), meter)}.__format__`);
  return representationObject(value, "str", context, meter);
}
