import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface ExtremumContext<Value, Key> {
  /** The bound key call, or identity when no key was supplied. */
  key(value: Value): Key;
  /** Candidate-first strict less-than for min, greater-than for max, including
   * guest reflected dispatch and truth conversion of comparison results. */
  compare(operation: "min" | "max", candidate: Key, best: Key): boolean;
}

/** Stable first-tie min/max selection from an already adapted iterator. Only
 * the current best item/key is retained; every input is keyed exactly once.
 * Defaults are returned untouched only for an empty source. Source adapters
 * own StopIteration translation; key/comparison failures propagate unchanged.
 * Call binding, iterable acquisition and guest allocation policies are external.
 */
export function selectExtremum<Value, Key>(operation: "min" | "max", source: Iterator<Value>, context: ExtremumContext<Value, Key>, meter: ExecutionMeter, fallback?: { readonly value: Value }): Value {
  meter.checkpoint();
  const first = source.next();
  meter.checkpoint();
  if (first.done) {
    if (fallback !== undefined) return fallback.value;
    throw new PythonRuntimeError("ValueError", `${operation}() iterable argument is empty`);
  }
  let best = first.value, bestKey = context.key(best);
  meter.checkpoint();
  while (true) {
    meter.checkpoint();
    const item = source.next();
    meter.checkpoint();
    if (item.done) return best;
    const key = context.key(item.value);
    meter.checkpoint();
    const replace = context.compare(operation, key, bestKey);
    meter.checkpoint();
    if (replace) { best = item.value; bestKey = key; }
  }
}
