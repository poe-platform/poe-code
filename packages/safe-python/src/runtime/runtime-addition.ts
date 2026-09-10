import { dispatchBinaryOperation } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { RuntimeNumericContext } from "./runtime-numeric-slots.js";

export type AdditionContext = RuntimeNumericContext;

/** Complete ordinary addition for exact native values, or supplied numeric
 * negotiation followed by native sequence fallback. Sequence failures must not
 * preempt reflected numeric methods. Byte buffer concatenation follows numeric
 * negotiation. Augmented left-list fallback extends in place, preserving partial
 * progress on iterator errors; ordinary addition never mutates either operand. */
export function runtimeAddition(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: AdditionContext = {}, augmented = false, buffers?: RuntimeBufferContext, iteration?: Partial<Pick<ExpressionContext<RuntimeValue>, "iterate">>): RuntimeValue {
  meter.checkpoint();
  const result = context.numeric === undefined
    ? augmented && left.kind === "list" ? values.notImplemented : runtimeBinary("+", left, right, values, meter)
    : dispatchBinaryOperation(context.numeric, meter);
  meter.checkpoint();
  if (result !== values.notImplemented) return result;
  const nativeLeft = context.sequenceFallbacks?.left === false ? undefined : runtimeListPayload(left);
  if (augmented && nativeLeft !== undefined) {
    if (right.kind === "list") nativeLeft.items.extend(right.items);
    else nativeLeft.items.extendIterator(iteration?.iterate === undefined ? runtimeIterate(right, values, meter) : iteration.iterate(right, undefined, true));
    return left;
  }
  if (nativeLeft !== undefined) {
    const payload = runtimeListPayload(right);
    if (payload !== undefined) return values.list(nativeLeft.items.concat(payload.items));
  }
  const sequence = nativeLeft !== undefined || left.kind === "tuple" || left.kind === "str" || left.kind === "bytes";
  if (sequence && nativeLeft === undefined && left.kind === right.kind) return runtimeBinary("+", left, right, values, meter);
  if (left.kind === "bytes" && buffers !== undefined) {
    let lease: RuntimeBufferLease | undefined;
    try {
      try { lease = buffers.acquireSimple(right); }
      catch (error) { meter.checkpoint(); if (!(error instanceof PythonRuntimeError)) throw error; }
      meter.checkpoint();
      if (lease !== undefined) {
        const storage = lease.copy(); meter.checkpoint();
        const joined = left.value.concat(storage, meter);
        return joined === left.value ? left : values.bytes(joined, joined.length === 0 ? "canonical" : "fresh");
      }
    } finally {
      lease?.release(); meter.checkpoint();
    }
  }
  const rightName = context.typeName?.(right) ?? (left.kind === "bytes" ? buffers?.typeName?.(right) : undefined) ?? (right.kind === "none" ? "NoneType" : right.kind === "not-implemented" ? "NotImplementedType" : right.kind);
  const b = diagnosticTypeName(rightName, meter, sequence && left.kind !== "bytes" ? 200 : 100);
  if (left.kind === "bytes") throw new PythonRuntimeError("TypeError", `can't concat ${b} to bytes`);
  if (sequence) throw new PythonRuntimeError("TypeError", `can only concatenate ${nativeLeft === undefined ? left.kind : "list"} (not "${b}") to ${nativeLeft === undefined ? left.kind : "list"}`);
  const leftName = context.typeName?.(left) ?? (left.kind === "none" ? "NoneType" : left.kind === "not-implemented" ? "NotImplementedType" : left.kind);
  throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for ${augmented ? "+=" : "+"}: '${diagnosticTypeName(leftName, meter, 100)}' and '${b}'`);
}
