import { dispatchBinaryOperation } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import type { RuntimeNumericContext } from "./runtime-numeric-slots.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Numeric families without sequence fallbacks. Addition, multiplication and
 * binary/ternary power retain their specialized operation boundaries. */
export function runtimeNumericOperation(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeNumericContext = {}, augmented = false): RuntimeValue {
  meter.checkpoint();
  const result = context.numeric === undefined ? runtimeBinary(operator, left, right, values, meter) : dispatchBinaryOperation(context.numeric, meter);
  meter.checkpoint();
  if (result !== values.notImplemented) return result;
  const a = diagnosticTypeName(context.typeName?.(left) ?? (left.kind === "none" ? "NoneType" : left.kind === "not-implemented" ? "NotImplementedType" : left.kind), meter, 100);
  const b = diagnosticTypeName(context.typeName?.(right) ?? (right.kind === "none" ? "NoneType" : right.kind === "not-implemented" ? "NotImplementedType" : right.kind), meter, 100);
  throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for ${operator}${augmented ? "=" : ""}: '${a}' and '${b}'`);
}
