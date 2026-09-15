import { constantRepeat } from "./constant-repeat.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Native concatenation shortcuts apply only to exact tuple operands. Never
 * publish an owned subclass's backing value through an identity shortcut. */
export function runtimeTupleConcat(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  const a = runtimeTuplePayload(left), b = runtimeTuplePayload(right);
  if (a === undefined || b === undefined) return values.notImplemented;
  if (a.items.length === 0 && right.kind === "tuple") return right;
  if (b.items.length === 0 && left.kind === "tuple") return left;
  return values.tuple(a.items.length + b.items.length, index => index < a.items.length ? a.items[index] : b.items[index - a.items.length]);
}

/** Repetition retains exact tuple identity, but subclass one-copy results are
 * fresh exact tuples. Empty results use the runtime's canonical empty tuple. */
export function runtimeTupleRepeat(source: RuntimeValue, count: bigint, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  const payload = runtimeTuplePayload(source);
  if (payload === undefined) throw Error("tuple repetition requires tuple storage");
  const result = constantRepeat(payload, values.integer(count), values, meter);
  return source.kind === "instance" && result === payload && payload.items.length !== 0 ? values.tuple(payload.items) : result;
}
