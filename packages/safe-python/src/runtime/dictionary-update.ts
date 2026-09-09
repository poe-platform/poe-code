import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface PairUpdateContext<Value> {
  /** Exact list/tuple storage only; subclasses use the iterable path. */
  sequence(value: Value): readonly Value[] | undefined;
  iterate(value: Value): Iterator<Value>;
  /** Prepare list-style materialization: the second iterator lookup and length
   * hint protocol belong here. Any preallocation is metered by the context. */
  prepare(iterator: Iterator<Value>): Iterator<Value>;
  /** Classify guest TypeError only, never fatal execution-limit signals. */
  isTypeError(error: unknown): boolean;
  set(key: Value, value: Value): void;
}

/** Update from an already-adapted outer iterable. Each row is fully materialized
 * before shape validation and insertion; earlier successful rows persist after
 * failure. This differs from assignment unpacking, which can stop after a third
 * item. No implicit iterator close occurs. Mapping/keys dispatch, keyword updates
 * and the guest method's None return belong to the caller. Retained temporary
 * row slots are charged; full host object/iterator overhead remains unfinished.
 */
export function updateDictionaryPairs<Value>(source: Iterator<Value>, context: PairUpdateContext<Value>, meter: ExecutionMeter): void {
  let index = 0;
  while (true) {
    meter.checkpoint();
    const entry = source.next();
    meter.checkpoint();
    if (entry.done) return;
    let row = context.sequence(entry.value);
    if (row === undefined) {
      let iterator: Iterator<Value>;
      try { iterator = context.iterate(entry.value); }
      catch (error) {
        if (context.isTypeError(error)) throw new PythonRuntimeError("TypeError", "object is not iterable");
        throw error;
      }
      meter.checkpoint();
      iterator = context.prepare(iterator);
      meter.checkpoint(0, 32);
      const items: Value[] = [];
      while (true) {
        meter.checkpoint();
        const item = iterator.next();
        meter.checkpoint();
        if (item.done) break;
        meter.checkpoint(0, 8);
        items.push(item.value);
      }
      row = items;
    }
    meter.checkpoint();
    if (row.length !== 2) throw new PythonRuntimeError("ValueError", `dictionary update sequence element #${index} has length ${row.length}; 2 is required`);
    context.set(row[0], row[1]);
    index++;
  }
}
