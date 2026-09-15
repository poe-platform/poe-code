import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { FilterIterator, type FilterIterationContext } from "./filter-iterator.js";

export interface FilterIterableContext<Value> extends IterationContext<Value>, FilterIterationContext<Value> {}

/** Bind an expanded call to the exact builtin filter(function, iterable, /).
 * Keywords are rejected before positional arity; iterable acquisition is eager
 * but consumption and predicate calls are lazy. Call assembly owns duplicate/
 * non-string keyword checks; guest type registration and wrapping remain external.
 */
export function filterIterable<Value>(positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: FilterIterableContext<Value>, meter: ExecutionMeter): FilterIterator<Value> {
  meter.checkpoint();
  if (keywords.size !== 0) throw new PythonRuntimeError("TypeError", "filter() takes no keyword arguments");
  if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `filter expected 2 arguments, got ${positional.length}`);
  const source = new ProtocolIterator(positional[1], context, meter);
  return new FilterIterator(positional[0], source, context, meter);
}
