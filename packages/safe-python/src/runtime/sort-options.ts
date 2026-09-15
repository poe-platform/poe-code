import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { suggestName } from "./name-suggestion.js";
import type { StableSortContext } from "./stable-sort.js";

export interface SortOptionContext<Value> {
  isNone(value: Value): boolean;
  truth(value: Value): boolean;
  callKey(key: Value, value: Value): Value;
  less(left: Value, right: Value): boolean;
}

/** Bind list.sort's already-expanded arguments, also used after sorted finishes
 * consuming its input. Total count errors precede positional-only rejection;
 * keyword validation precedes reverse truth conversion. Key callability is not
 * checked here: empty sorts never invoke it. The caller supplies guest truth,
 * call and reflected comparison dispatch, and handles duplicate/non-string
 * keyword keys during call assembly. Result/context heap charges are logical.
 */
export function bindSortOptions<Value>(positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: SortOptionContext<Value>, meter: ExecutionMeter): StableSortContext<Value, Value> {
  meter.checkpoint();
  const total = positional.length + keywords.size;
  if (total > 2) throw new PythonRuntimeError("TypeError", `sort() takes at most 2 ${positional.length ? "" : "keyword "}arguments (${total} given)`);
  if (positional.length) throw new PythonRuntimeError("TypeError", "sort() takes no positional arguments");
  for (const name of keywords.keys()) {
    meter.checkpoint();
    if (name === "key" || name === "reverse") continue;
    const suggestion = suggestName(name, ["key", "reverse"], meter);
    const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
    throw new PythonRuntimeError("TypeError", `sort() got an unexpected keyword argument '${name}'${hint}`);
  }
  const key = keywords.get("key");
  const useKey = keywords.has("key") && !context.isNone(key!);
  const reverse = keywords.has("reverse") ? context.truth(keywords.get("reverse")!) : false;
  meter.checkpoint(1, 96);
  return Object.freeze({
    key(value: Value): Value { return useKey ? context.callKey(key!, value) : value; },
    less: context.less.bind(context),
    reverse
  });
}
