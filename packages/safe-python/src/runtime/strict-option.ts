import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { suggestName } from "./name-suggestion.js";

/** Shared expanded strict-only keyword binding for parallel-input builtins.
 * Validation precedes guest truth conversion; callers determine subsequent
 * positional arity checks and iterator acquisition order.
 */
export function bindStrictOption<Value>(operation: "zip" | "map", keywords: ReadonlyMap<string, Value>, context: { truth(value: Value): boolean }, meter: ExecutionMeter): boolean {
  meter.checkpoint();
  if (keywords.size > 1) throw new PythonRuntimeError("TypeError", `${operation}() takes at most 1 keyword argument (${keywords.size} given)`);
  for (const name of keywords.keys()) {
    meter.checkpoint();
    if (name === "strict") continue;
    const suggestion = suggestName(name, ["strict"], meter);
    const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
    throw new PythonRuntimeError("TypeError", `${operation}() got an unexpected keyword argument '${name}'${hint}`);
  }
  const strict = keywords.has("strict") ? context.truth(keywords.get("strict")!) : false;
  meter.checkpoint();
  return strict;
}
