import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { indexObject, type IntegerIndexContext } from "./index-protocol.js";
import { createRange, type IntegerProgression } from "./integer-sequence.js";

/** Bind expanded range calls and convert explicit values through the guest
 * index protocol, left to right. Exact bigint attributes feed the existing
 * progression arithmetic without materialization or machine-width clipping.
 * Call assembly owns duplicate/non-string keywords; guest range registration,
 * object wrapping and bigint payload/CPU accounting remain external. An optional
 * retention callback receives validated index objects in argument order, before
 * their identity is erased by extracting bigint payloads.
 */
export function constructRange<Value>(positional: readonly Value[], keywords: { readonly size: number }, context: IntegerIndexContext<Value>, meter: ExecutionMeter, retainIndex?: (position: number, value: Value) => void): IntegerProgression {
  meter.checkpoint();
  if (keywords.size !== 0) throw new PythonRuntimeError("TypeError", "range() takes no keyword arguments");
  const count = positional.length;
  if (count === 0) throw new PythonRuntimeError("TypeError", "range expected at least 1 argument, got 0");
  if (count > 3) throw new PythonRuntimeError("TypeError", `range expected at most 3 arguments, got ${count}`);
  const convert = (position: number): bigint => {
    const value = indexObject(positional[position], context, meter);
    retainIndex?.(position, value); meter.checkpoint();
    return context.integer(value) as bigint;
  };
  const first = convert(0);
  const start = count === 1 ? 0n : first;
  const stop = count === 1 ? first : convert(1);
  const step = count === 3 ? convert(2) : 1n;
  meter.checkpoint(1, 64);
  return createRange(start, stop, step);
}
