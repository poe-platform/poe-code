import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeSetAccess, subtractRuntimeSet, symmetricDifferenceUpdateRuntimeSet, updateRuntimeSet } from "./runtime-set.js";
import { isRuntimeSetView, type RuntimeValue, type RuntimeValues, type SetValue } from "./runtime-values.js";

/** Exact dict-key/item view numeric slots, including reflected iterable inputs.
 * The caller resolves mapping-proxy forwarding and guarantees one set-like
 * view. Values views can be iterable operands but do not own these slots. */
export function runtimeDictionaryViewBinary(operator: "|" | "&" | "-" | "^", left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): SetValue {
  meter.checkpoint();
  const view = isRuntimeSetView(left) ? left : isRuntimeSetView(right) ? right : undefined;
  if (view === undefined) throw new Error("dictionary-view algebra requires a set-like view");
  if (operator === "^" && left.kind === "dict_items" && right.kind === "dict_items") {
    const remaining = left.value.items.copy(), result = values.set(remaining.emptyCopy());
    meter.checkpoint(1, 64);
    const missing = remaining.subtractMatchingItems(right.value.items,
      (a, b) => runtimeComparison("==", a, b, values, meter).value,
      (key, value) => runtimeSetAccess(result, values.tuple([key, value]), "add", values, meter));
    if (missing !== undefined) throw new PythonKeyError(missing.key, meter);
    updateRuntimeSet(result, values.dictionaryView(values.dictionary(remaining), "dict_items"), values, meter);
    return result;
  }
  if (operator === "&") {
    if (!isRuntimeSetView(left)) { const original = left; left = right; right = original; }
    if (!isRuntimeSetView(left)) throw new Error("intersection requires a view receiver");
    const size = left.value.items.size;
    if (right.kind === "set" && size <= right.items.size) {
      meter.checkpoint(1, 32);
      return values.set(right.items.intersectKeysFrom(() => runtimeIterate(left, values, meter), values.none));
    }
    if (isRuntimeSetView(right) && right.value.items.size > size) { const original = left; left = right; right = original; }
    const result = values.set(view.value.items.emptyCopy()), iterator = runtimeIterate(right, values, meter);
    while (true) {
      meter.checkpoint();
      const item = iterator.next();
      meter.checkpoint();
      if (item.done) return result;
      if (runtimeMembership("in", item.value, left, values, meter).value) runtimeSetAccess(result, item.value, "add", values, meter);
    }
  }
  const result = values.set(view.value.items.emptyCopy());
  // Only conversion of the left keys view gets the exact-dictionary fast path.
  updateRuntimeSet(result, left.kind === "dict_keys" ? left.value : left, values, meter);
  if (operator === "|") updateRuntimeSet(result, right, values, meter);
  else if (operator === "-") subtractRuntimeSet(result, right, values, meter);
  else symmetricDifferenceUpdateRuntimeSet(result, right, values, meter);
  return result;
}
