import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { DictionaryViewValue, RuntimeValue } from "./runtime-values.js";

/** Capture the cursor now, but construct item tuples and read values on next(). */
export function iterateRuntimeDictionaryView(view: DictionaryViewValue, values: ConstantValues, meter: ExecutionMeter, reverse = false): Iterator<RuntimeValue> {
  meter.checkpoint(1, 64);
  const project = (key: RuntimeValue, value: RuntimeValue): RuntimeValue => {
    meter.checkpoint();
    return view.kind === "dict_keys" ? key : view.kind === "dict_values" ? value : values.tuple<RuntimeValue>([key, value]);
  };
  return reverse ? view.value.items.reversed(project) : view.value.items.iterate(project);
}

/** Yield equality work to the caller's depth-limited evaluator instead of
 * recursively invoking it here. Item membership hashes only the tuple's key.
 */
export function* containsRuntimeDictionaryView(view: DictionaryViewValue, needle: RuntimeValue, meter: ExecutionMeter): Generator<readonly [RuntimeValue, RuntimeValue], boolean, boolean> {
  meter.checkpoint(1, 64);
  if (view.kind === "dict_keys") return runtimeDictionaryAccess(view.value, needle, "contains", meter);
  if (view.kind === "dict_items") {
    if (needle.kind !== "tuple" || needle.items.length !== 2) return false;
    const found = runtimeDictionaryAccess(view.value, needle.items[0], "lookup", meter);
    if (found === undefined) return false;
    const item = needle.items[1];
    if (found.value === item) return true;
    meter.checkpoint(0, 32);
    return yield [found.value, item];
  }
  const iterator = view.value.items.iterate((_key, value) => value);
  for (let item = iterator.next(); !item.done; item = iterator.next()) {
    meter.checkpoint();
    if (item.value === needle) return true;
    meter.checkpoint(0, 32);
    if (yield [item.value, needle]) return true;
  }
  return false;
}

/** Set-like view comparison. Values views and non-view sets are dispatched
 * separately. Membership permits unhashable item values and cross-kind views.
 */
export function* compareRuntimeDictionaryViews(operator: string, left: DictionaryViewValue, right: DictionaryViewValue, values: ConstantValues, meter: ExecutionMeter): Generator<readonly [RuntimeValue, RuntimeValue], boolean, boolean> {
  meter.checkpoint(1, 64);
  const aSize = left.value.items.size, bSize = right.value.items.size;
  if ((operator === "==" || operator === "!=") && aSize !== bSize) return operator === "!=";
  if ((operator === "<" && aSize >= bSize) || (operator === "<=" && aSize > bSize) ||
      (operator === ">" && aSize <= bSize) || (operator === ">=" && aSize < bSize)) return false;
  const reverse = operator === ">" || operator === ">=", source = reverse ? right : left, target = reverse ? left : right;
  const iterator = iterateRuntimeDictionaryView(source, values, meter);
  for (let item = iterator.next(); !item.done; item = iterator.next()) {
    meter.checkpoint();
    if (!(yield* containsRuntimeDictionaryView(target, item.value, meter))) return operator === "!=";
  }
  return operator !== "!=";
}
