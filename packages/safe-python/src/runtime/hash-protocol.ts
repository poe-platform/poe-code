import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { hashReal } from "./real-comparison.js";

export interface HashProtocolContext<Value> {
  /** Resolve inherited type-level __hash__, not instance attributes. Null and
   * undefined indicate disabled/absent slots; inherited identity slots must be
   * supplied explicitly. Other non-callable slots fail through invocation. */
  lookupHash(value: Value): (() => Value) | null | undefined;
  /** Pure payload extraction for int, bool and int subclasses; never __index__. */
  integer(value: Value): bigint | undefined;
  typeName(value: Value): string;
}

/** Convert a guest hash slot to signed 64-bit Python hash semantics. Oversized
 * integers use numeric hashing rather than truncation; -1 always becomes -2. */
export function protocolHash<Value>(value: Value, context: HashProtocolContext<Value>, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  const method = context.lookupHash(value); meter.checkpoint();
  if (method == null) throw new PythonRuntimeError("TypeError", `unhashable type: '${diagnosticTypeName(context.typeName(value), meter)}'`);
  const result = method(); meter.checkpoint();
  const integer = context.integer(result); meter.checkpoint();
  if (integer === undefined) throw new PythonRuntimeError("TypeError", "__hash__ method should return an integer");
  if (BigInt.asIntN(64, integer) === integer) return integer === -1n ? -2n : integer;
  const bits = integerBitMetric(integer, "bit_length", meter);
  meter.checkpoint(Math.ceil(bits / 32), 32);
  return hashReal(integer)!;
}
