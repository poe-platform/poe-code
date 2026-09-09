import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { suggestName } from "./name-suggestion.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { ZipIterator } from "./zip-iterator.js";

export interface ZipIterableContext<Value, Result> extends IterationContext<Value> {
  truth(value: Value): boolean;
  tuple(values: readonly Value[]): Result;
}

/** Bind an expanded zip call and eagerly acquire input iterators. Strict keyword
 * validation/truth conversion precedes iterable callbacks; iterator creation is
 * left to right and never pulls a value. No length hints are requested. Guest
 * call assembly owns duplicate/non-string keywords, and builtin registration,
 * iterator object wrapping and full native allocation accounting remain open.
 */
export function zipIterables<Value, Result>(inputs: readonly Value[], keywords: ReadonlyMap<string, Value>, context: ZipIterableContext<Value, Result>, meter: ExecutionMeter): ZipIterator<Value, Result> {
  meter.checkpoint();
  if (keywords.size > 1) throw new PythonRuntimeError("TypeError", `zip() takes at most 1 keyword argument (${keywords.size} given)`);
  for (const name of keywords.keys()) {
    meter.checkpoint();
    if (name === "strict") continue;
    const suggestion = suggestName(name, ["strict"], meter);
    const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
    throw new PythonRuntimeError("TypeError", `zip() got an unexpected keyword argument '${name}'${hint}`);
  }
  const strict = keywords.has("strict") ? context.truth(keywords.get("strict")!) : false;
  meter.checkpoint();
  const length = inputs.length;
  meter.checkpoint(0, 64 + length * 8);
  const iterators = new Array<Iterator<Value>>(length);
  for (let i = 0; i < length; i++) {
    meter.checkpoint();
    iterators[i] = new ProtocolIterator(inputs[i], context, meter);
  }
  return new ZipIterator(iterators, strict, context.tuple.bind(context), meter);
}
