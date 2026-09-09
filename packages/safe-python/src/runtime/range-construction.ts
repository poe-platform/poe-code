import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { createRange, type IntegerProgression } from "./integer-sequence.js";

/** Bind expanded range calls and convert explicit values through the guest
 * index protocol, left to right. Exact bigint attributes feed the existing
 * progression arithmetic without materialization or machine-width clipping.
 * Call assembly owns duplicate/non-string keywords; guest range registration,
 * object wrapping and bigint payload/CPU accounting remain external.
 */
export function constructRange<Value>(positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: IntegerIndexContext<Value>, meter: ExecutionMeter): IntegerProgression {
  meter.checkpoint();
  if (keywords.size !== 0) throw new PythonRuntimeError("TypeError", "range() takes no keyword arguments");
  const count = positional.length;
  if (count === 0) throw new PythonRuntimeError("TypeError", "range expected at least 1 argument, got 0");
  if (count > 3) throw new PythonRuntimeError("TypeError", `range expected at most 3 arguments, got ${count}`);
  const first = integerIndex(positional[0], context, meter);
  const start = count === 1 ? 0n : first;
  const stop = count === 1 ? first : integerIndex(positional[1], context, meter);
  const step = count === 3 ? integerIndex(positional[2], context, meter) : 1n;
  meter.checkpoint(1, 64);
  return createRange(start, stop, step);
}
