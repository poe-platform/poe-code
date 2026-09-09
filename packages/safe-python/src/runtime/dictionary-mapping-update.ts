import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { collectIterator } from "./iterator-collection.js";
import { updateDictionaryPairs, type PairUpdateContext } from "./dictionary-update.js";

export interface DictionaryUpdateContext<Value> extends PairUpdateContext<Value> {
  /** Perform optional attribute lookup, swallowing only guest AttributeError.
   * Presence, not callability or truthiness, selects the mapping branch. */
  hasKeys(value: Value): boolean;
  /** Look up keys again and call it: do not reuse the first lookup's value. */
  callKeys(value: Value): Value;
  typeName(value: Value): string;
  getItem(mapping: Value, key: Value): Value;
}

/** Generic dict.update source dispatch, after any exact-dict optimized path.
 * Materialize arbitrary keys iterables before fetching values. Exact list keys
 * remain live during retrieval; exact tuple copying can be elided. Mapping
 * mutations overwrite, preserve earlier successes on failure, and fetch each
 * repeated key anew. Keyword updates and the guest method's None return are
 * separate. This is not duplicate-rejecting call-keyword or class-header merging.
 */
export function updateDictionary<Value>(source: Value, context: DictionaryUpdateContext<Value>, meter: ExecutionMeter): void {
  meter.checkpoint();
  const mapping = context.hasKeys(source);
  meter.checkpoint();
  if (!mapping) {
    updateDictionaryPairs(context.iterate(source), context, meter);
    return;
  }
  const keysValue = context.callKeys(source);
  meter.checkpoint();
  let keys = context.sequence(keysValue);
  if (keys === undefined) {
    let iterator: Iterator<Value>;
    try { iterator = context.iterate(keysValue); }
    catch (error) {
      if (context.isTypeError(error)) throw new PythonRuntimeError("TypeError", `${context.typeName(source)}.keys() returned a non-iterable (type ${context.typeName(keysValue)})`);
      throw error;
    }
    meter.checkpoint();
    keys = collectIterator(context.prepare(iterator), meter);
  }
  for (const key of keys) {
    meter.checkpoint();
    const value = context.getItem(source, key);
    meter.checkpoint();
    context.set(key, value);
  }
  meter.checkpoint();
}
