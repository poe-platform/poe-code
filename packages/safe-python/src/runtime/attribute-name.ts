import { runtimeStringPayload } from "./runtime-string-payload.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

export interface AttributeNameContext {
  /** Pure classification for guest str subclasses; no coercion or slot calls. */
  isString?(value: RuntimeValue): boolean;
  typeName?(value: RuntimeValue): string;
}

/** Validate without converting the name, preserving guest identity/code points. */
export function validateAttributeName(value: RuntimeValue, context: AttributeNameContext, meter: ExecutionMeter): void {
  const string = runtimeStringPayload(value) !== undefined || context.isString?.(value) === true;
  meter.checkpoint();
  if (string) return;
  const type = context.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
  throw new PythonRuntimeError("TypeError", `attribute name must be string, not '${diagnosticTypeName(type, meter)}'`);
}
