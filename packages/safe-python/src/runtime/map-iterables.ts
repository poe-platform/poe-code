import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { MapIterator, type MapIterationContext } from "./map-iterator.js";
import { bindStrictOption } from "./strict-option.js";

export interface MapIterableContext<Value> extends IterationContext<Value>, MapIterationContext<Value> {
  truth(value: Value): boolean;
}

/** Bind expanded map(function, iterable, ..., strict=False). Keyword validation
 * and strict truth conversion occur before the minimum positional count check.
 * Input iterators are acquired eagerly left to right, without reading items or
 * testing function callability. Duplicate/non-string keyword checks belong to
 * call assembly; guest builtin registration and iterator wrapping remain open.
 */
export function mapIterables<Value>(positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: MapIterableContext<Value>, meter: ExecutionMeter): MapIterator<Value> {
  const strict = bindStrictOption("map", keywords, context, meter);
  if (positional.length < 2) throw new PythonRuntimeError("TypeError", "map() must have at least two arguments.");
  const count = positional.length - 1;
  meter.checkpoint(1, 32 + count * 8);
  const inputs = new Array<Iterator<Value>>(count);
  for (let i = 0; i < count; i++) {
    meter.checkpoint();
    inputs[i] = new ProtocolIterator(positional[i + 1], context, meter);
  }
  return new MapIterator(positional[0], inputs, strict, context, meter);
}
