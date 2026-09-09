import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ParallelIterator } from "./parallel-iterator.js";
import type { CompletionIterator, CompletionResult } from "./iterator-completion.js";

export interface MapIterationContext<Value> {
  call(callable: Value, arguments_: readonly Value[]): Value;
  /** Guest StopIteration/subclasses only, never fatal execution-limit signals. */
  isStopIteration(error: unknown): boolean;
}

/** Map over prepared iterators using shared zip-style row consumption and
 * strict mismatch checking. Callability is tested only by invoking a complete
 * row. Mapping-function StopIteration becomes a done result for this call but
 * does not impose sticky exhaustion. Caller owns guest argument binding and
 * eager iterable preparation; guest object wrapping remains
 * external. Argument rows are host buffers, not intermediate guest tuples.
 */
export class MapIterator<Value> extends ParallelIterator<Value, Value> {
  constructor(callable: Value, sources: readonly CompletionIterator<Value>[], strict: boolean, private readonly context: MapIterationContext<Value>, private readonly mapMeter: ExecutionMeter) {
    mapMeter.checkpoint();
    if (sources.length === 0) throw new PythonRuntimeError("TypeError", "map() must have at least two arguments.");
    mapMeter.checkpoint(0, 32);
    super(sources, strict, context.call.bind(context, callable), mapMeter, "map");
  }

  override next(): CompletionResult<Value> {
    try { return super.next(); }
    catch (error) {
      this.mapMeter.checkpoint();
      const ended = this.context.isStopIteration(error); this.mapMeter.checkpoint();
      if (!ended) throw error;
      this.mapMeter.checkpoint(0, 32);
      return { done: true, value: undefined, exception: { value: error } };
    }
  }
}
