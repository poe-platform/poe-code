import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { suggestName } from "./name-suggestion.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { selectExtremum } from "./extremum.js";

export interface ExtremumCallContext<Value> extends IterationContext<Value> {
  isNone(value: Value): boolean;
  callKey(key: Value, value: Value): Value;
  compare(operation: "min" | "max", candidate: Value, best: Value): boolean;
}

/** Bind expanded min/max calls, using guest iteration for one positional value
 * and the positional values themselves otherwise. Arity precedes keyword
 * validation, which precedes default conflicts and iterator acquisition. Key
 * callability stays lazy. Concrete builtin registration, guest rich comparison
 * and complete native allocation accounting remain external.
 */
export function extremumCall<Value>(operation: "min" | "max", positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: ExtremumCallContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${operation} expected at least 1 argument, got 0`);
  if (keywords.size > 2) throw new PythonRuntimeError("TypeError", `${operation}() takes at most 2 keyword arguments (${keywords.size} given)`);
  for (const name of keywords.keys()) {
    meter.checkpoint();
    if (name === "key" || name === "default") continue;
    const suggestion = suggestName(name, ["key", "default"], meter);
    const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
    throw new PythonRuntimeError("TypeError", `${operation}() got an unexpected keyword argument '${name}'${hint}`);
  }
  if (positional.length > 1 && keywords.has("default")) throw new PythonRuntimeError("TypeError", `Cannot specify a default for ${operation}() with multiple positional arguments`);
  meter.checkpoint(1, 128);
  const source = positional.length === 1 ? new ProtocolIterator(positional[0], context, meter) : positional[Symbol.iterator]();
  const key = keywords.get("key") as Value;
  const useKey = keywords.has("key") && !context.isNone(key);
  const fallback = keywords.has("default") ? { value: keywords.get("default") as Value } : undefined;
  return selectExtremum(operation, source, {
    key(value) { return useKey ? context.callKey(key, value) : value; },
    compare: context.compare.bind(context)
  }, meter, fallback);
}
