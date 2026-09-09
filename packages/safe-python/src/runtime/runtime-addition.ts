import { dispatchBinaryOperation, type BinaryDispatch } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface AdditionContext {
  /** Numeric slots prepared for this operand pair, excluding sequence concat.
   * The sentinel must be this execution's NotImplemented singleton. */
  numeric?: BinaryDispatch<RuntimeValue>;
  typeName?(value: RuntimeValue): string;
}

/** Complete ordinary addition for exact native values, or supplied numeric
 * negotiation followed by native sequence fallback. Sequence failures must not
 * preempt reflected numeric methods. Guest sequence storage/buffer exporters
 * require further adapters; this never performs in-place addition. */
export function runtimeAddition(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: AdditionContext = {}): RuntimeValue {
  meter.checkpoint();
  const result = context.numeric === undefined ? runtimeBinary("+", left, right, values, meter) : dispatchBinaryOperation(context.numeric, meter);
  meter.checkpoint();
  if (result !== values.notImplemented) return result;
  const sequence = left.kind === "list" || left.kind === "tuple" || left.kind === "str" || left.kind === "bytes";
  if (sequence && left.kind === right.kind) return runtimeBinary("+", left, right, values, meter);
  const rightName = context.typeName?.(right) ?? (right.kind === "none" ? "NoneType" : right.kind === "not-implemented" ? "NotImplementedType" : right.kind);
  const b = diagnosticTypeName(rightName, meter, sequence && left.kind !== "bytes" ? 200 : 100);
  if (left.kind === "bytes") throw new PythonRuntimeError("TypeError", `can't concat ${b} to bytes`);
  if (sequence) throw new PythonRuntimeError("TypeError", `can only concatenate ${left.kind} (not "${b}") to ${left.kind}`);
  const leftName = context.typeName?.(left) ?? (left.kind === "none" ? "NoneType" : left.kind === "not-implemented" ? "NotImplementedType" : left.kind);
  throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for +: '${diagnosticTypeName(leftName, meter, 100)}' and '${b}'`);
}
